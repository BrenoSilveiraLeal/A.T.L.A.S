import "server-only";

import Decimal from "decimal.js";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketHistory, MarketQuote } from "@/providers/types";
import { autopilotDecision, corporateActionSuspected, ruleVersion, STEADY_RULE } from "@/core/autopilot";
import { paperReferencePrice } from "@/core/paper";
import { b3Session } from "@/core/b3-calendar";
import { applyPaperCorporateActions } from "./corporate-actions";
import { loadBars } from "./market-bars";
import { adjustStoredBars } from "@/core/strategies";
import { saoPauloClock } from "@/core/b3-calendar";
import { minimumSellPrice } from "@/core/live";
import { bossRelease } from "./boss";
import { cachedCompanyHealth } from "./company-health";
import type { CorporateEvent } from "@/core/corporate-actions";
import type { ContextAction } from "@/core/context";

// Owner's minimum order (R$ 40): one share of the cheapest team stocks.
const MIN_ORDER_VALUE = STEADY_RULE.minOrder;

const STOP_LOSS_PCT = 8;
// Owner's rule: sell only after +60% over the average price and an 8% turn from the top.
const SELL_TARGET_PCT = STEADY_RULE.targetPct, SELL_TURN_PCT = STEADY_RULE.turnPct;
const accountSchema = z.object({
  cash: z.coerce.string(), reserved_cash: z.coerce.string(), max_order_value: z.coerce.string(),
  max_exposure: z.coerce.string(), fee_bps: z.number(), slippage_bps: z.number(),
  paused: z.boolean(), autopilot: z.boolean(), fee_lot: z.coerce.number().optional(), fee_fraction: z.coerce.number().optional(),
}).loose();

function rows<T>(result: { data: T | null; error: unknown }): T {
  if (result.error || result.data === null) throw new Error("PAPER_AUTOPILOT_DATABASE");
  return result.data;
}
function maybe<T>(result: { data: T | null; error: unknown }): T | null {
  if (result.error) throw new Error("PAPER_AUTOPILOT_DATABASE");
  return result.data;
}

/**
 * Runs after an agent's analysis is committed. Always records the agent's virtual life
 * when a paper account exists; settles, proposes and approves only with autopilot on.
 * jobId is the proposal idempotency key, so a retried job never opens a second order.
 */
export async function runPaperAutopilot(db: SupabaseClient, input: {
  owner: string; jobId: string; agentId: string; assetId: string; ticker: string;
  quote: MarketQuote; history: MarketHistory;
  context?: { action: ContextAction; summary: string };
}) {
  const { owner, agentId, assetId, quote } = input;
  const found = maybe(await db.from("paper_accounts").select("*").eq("owner_id", owner).maybeSingle());
  if (!found) return { status: "NO_PAPER_ACCOUNT" as const };
  let account = accountSchema.parse(found);
  const price = paperReferencePrice(quote.price);
  // Official dividends and stock events first, so marking never sees a fake gain or loss.
  let events = { applied: 0, knownDates: [] as string[], stockEvents: [] as CorporateEvent[], unavailable: true };
  try { events = await applyPaperCorporateActions(db, owner, assetId, input.ticker, price); } catch { /* guard below still protects */ }
  let filled = 0;
  if (account.autopilot && !account.paused) {
    const settled = rows(await db.rpc("paper_settle_quote", { p_owner_id: owner, p_asset_id: assetId, p_price: price,
      p_source: quote.source, p_quote_timestamp: quote.dataTimestamp }));
    filled = z.object({ filled: z.number() }).loose().parse(settled).filled;
  }
  // A suspected split/grouping would fake a gain or loss on the virtual position: pause instead.
  const corporateAction = corporateActionSuspected(input.history, quote.price, events.knownDates);
  if (corporateAction) return { filled, corporateActions: events.applied, status: "CORPORATE_ACTION_SUSPECTED" as const, reason: corporateAction };
  const vitals = z.object({ lifePct: z.coerce.number(), eliminated: z.boolean() }).loose().parse(rows(
    await db.rpc("paper_mark_agent", { p_owner_id: owner, p_agent_id: agentId, p_price: price,
      p_source: quote.source, p_quote_timestamp: quote.dataTimestamp })));
  if (vitals.eliminated) return { filled, corporateActions: events.applied, status: "ELIMINATED" as const, lifePct: vitals.lifePct };
  if (!account.autopilot || account.paused) return { filled, corporateActions: events.applied, status: "MARKED" as const, lifePct: vitals.lifePct };
  // The owner can switch the autopilot off for one agent; it is still marked and settled.
  const agentSwitch = maybe(await db.from("agents").select("autopilot").eq("owner_id", owner).eq("id", agentId).maybeSingle()) as { autopilot?: boolean } | null;
  if (agentSwitch && agentSwitch.autopilot === false) return { filled, corporateActions: events.applied, status: "AGENT_AUTOPILOT_OFF" as const, lifePct: vitals.lifePct };
  // New orders only inside the B3 safe window; outside it the agent is still marked and settled.
  const session = b3Session(new Date());
  if (session.status !== "OPEN") return { filled, corporateActions: events.applied, status: "MARKET_CLOSED" as const, reason: session.reason, lifePct: vitals.lifePct };

  // Re-read after settlement: fills change cash, reservations and positions.
  account = accountSchema.parse(rows(await db.from("paper_accounts").select("*").eq("owner_id", owner).single()));
  const [agent, asset, position, openOrders, allPositions] = await Promise.all([
    db.from("agents").select("budget").eq("owner_id", owner).eq("id", agentId).single(),
    db.from("assets").select("lot_size,tick_size").eq("owner_id", owner).eq("id", assetId).single(),
    db.from("paper_positions").select("quantity,average_cost").eq("owner_id", owner).eq("agent_id", agentId).eq("asset_id", assetId).maybeSingle(),
    db.from("paper_orders").select("agent_id,reserved_cash").eq("owner_id", owner).eq("status", "OPEN"),
    db.from("paper_positions").select("quantity,average_cost").eq("owner_id", owner),
  ]);
  const held = maybe(position) ?? { quantity: 0, average_cost: "0" };
  const open = rows(openOrders);
  const D = Decimal;
  const basis = new D(held.quantity).times(String(held.average_cost));
  const reserved = new D(account.reserved_cash);
  const exposure = rows(allPositions).reduce((sum, p) => sum.plus(new D(p.quantity).times(String(p.average_cost))), new D(0));
  const availableCash = D.min(new D(account.cash).minus(reserved), new D(account.max_exposure).minus(exposure).minus(reserved));
  const trailing = await trailingInputs(db, owner, agentId, assetId, input.ticker, held.quantity, events.stockEvents).catch(() => undefined);
  // A company in danger (court protection, negative equity, repeated losses) gets no new money.
  const health = (await cachedCompanyHealth(db, owner).catch(() => null))?.[input.ticker];
  const context = health?.level === "PERIGO" && input.context?.action !== "EXIT"
    ? { action: "BLOCK_BUY" as const, summary: `saúde da empresa em perigo: ${health.reasons[0]}` } : input.context;
  const steady = { peak: trailing?.peak ?? null, targetPct: SELL_TARGET_PCT, turnPct: SELL_TURN_PCT };
  const decision = autopilotDecision({
    ticker: input.ticker, quote, history: input.history, now: new Date().toISOString(),
    position: { quantity: held.quantity, averageCost: String(held.average_cost) },
    hasOpenOrder: open.some((o) => o.agent_id === agentId),
    // The boss compares the six stocks and releases the pot to the best ones in their buy zone.
    budgetRoom: (await bossRelease(db, owner, agentId, availableCash.toNumber(), { [input.ticker]: Number(quote.price) })).toFixed(2),
    maxOrderValue: account.max_order_value, availableCash: availableCash.toFixed(2),
    lotSize: rows(asset).lot_size, tickSize: String(rows(asset).tick_size),
    feeBps: account.fee_bps, slippageBps: account.slippage_bps, stopLossPct: STOP_LOSS_PCT,
    // Below a round lot only the fractional brokerage (R$ 0,99) applies; both legs only when 100 shares fit.
    fixedFee: Number(account.fee_fraction ?? 0) + (Number(quote.price) * 100 <= Number(rows(agent).budget) ? Number(account.fee_lot ?? 0) : 0),
    minOrderValue: MIN_ORDER_VALUE,
    minSellPrice: held.quantity > 0 ? minimumSellPrice(basis.toNumber(), held.quantity) : undefined,
    context,
    // Owner's rule: buy near the 6-month low, sell near the 6-month high (never at a loss).
    range: trailing ? { closes: trailing.closes } : undefined,
    steady: trailing ? undefined : steady,
  });
  if (decision.action === "HOLD") return { filled, corporateActions: events.applied, status: "HOLD" as const, reason: decision.reason, lifePct: vitals.lifePct };
  const proposal = z.object({ id: z.uuid() }).loose().parse(rows(await db.rpc("paper_create_proposal", {
    p_owner_id: owner, p_agent_id: agentId, p_side: decision.action, p_quantity: decision.quantity,
    p_limit_price: decision.limitPrice, p_reference_price: decision.referencePrice,
    p_quote_source: quote.source, p_quote_timestamp: quote.dataTimestamp,
    p_history_source: input.history.source, p_history_retrieved_at: input.history.retrievedAt,
    p_strategy_version: ruleVersion(trailing ? { range: { closes: trailing.closes } } : { steady }), p_reasoning: decision.reason, p_indicators: decision.indicators,
    p_idempotency_key: input.jobId,
  })));
  const review = z.object({ status: z.string() }).loose().parse(rows(
    await db.rpc("paper_review_proposal", { p_owner_id: owner, p_proposal_id: proposal.id, p_approve: true })));
  return { filled, corporateActions: events.applied, status: review.status === "OPEN" ? "ORDER_OPENED" as const : "RISK_REJECTED" as const,
    side: decision.action, quantity: decision.quantity, limitPrice: decision.limitPrice, lifePct: vitals.lifePct };
}

/**
 * Inputs for the trailing-stop rule from the long adjusted history: highest close since
 * the current position was opened, highest close of the prior 20 sessions and whether the
 * agent ever held the asset. Undefined (SMA rule fallback) when history is too short.
 */
async function trailingInputs(db: SupabaseClient, owner: string, agentId: string, assetId: string, ticker: string,
  heldQuantity: number, stockEvents: readonly CorporateEvent[]) {
  const today = saoPauloClock(new Date()).date;
  // The owner's rule can hold for years: the top since entry needs the long history (DB max 1000 rows).
  const stored = (await loadBars(db, ticker, 1000)).filter((b) => b.trade_date < today);
  if (stored.length < 20) return undefined;
  const adjusted = adjustStoredBars(stored, stockEvents).map((b, i) => ({ date: stored[i].trade_date, close: Number(b.close) }));
  // Only fills of the current book count: a restart closes the old positions.
  const restart = maybe(await db.from("paper_book_restarts").select("started_at").eq("owner_id", owner)
    .order("started_at", { ascending: false }).limit(1).maybeSingle()) as { started_at: string } | null;
  const fills = maybe(await db.from("paper_fills").select("side,quantity,filled_at").eq("owner_id", owner).eq("agent_id", agentId)
    .eq("asset_id", assetId).gt("filled_at", restart?.started_at ?? "1970-01-01T00:00:00Z")
    .order("filled_at", { ascending: true })) as { side: string; quantity: number; filled_at: string }[] | null;
  let quantity = 0, entryDate: string | null = null;
  for (const fill of fills ?? []) {
    const before = quantity;
    quantity += fill.side === "BUY" ? fill.quantity : -fill.quantity;
    if (before === 0 && quantity > 0) entryDate = saoPauloClock(new Date(fill.filled_at)).date;
  }
  const sinceEntry = heldQuantity > 0 && entryDate ? adjusted.filter((b) => b.date >= entryDate!) : [];
  return {
    peak: sinceEntry.length ? Math.max(...sinceEntry.map((b) => b.close)).toFixed(2) : null,
    priorHigh: Math.max(...adjusted.slice(-20).map((b) => b.close)).toFixed(2),
    everHeld: (fills ?? []).length > 0,
    trailPct: 15,
    closes: adjusted.map((b) => b.close),
  };
}

