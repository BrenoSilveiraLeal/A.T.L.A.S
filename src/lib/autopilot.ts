import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketHistory, MarketQuote } from "@/providers/types";
import { AUTOPILOT_VERSION, autopilotDecision } from "@/core/autopilot";
import { paperReferencePrice } from "@/core/paper";

const STOP_LOSS_PCT = 8;
const accountSchema = z.object({
  cash: z.coerce.string(), reserved_cash: z.coerce.string(), max_order_value: z.coerce.string(),
  max_exposure: z.coerce.string(), fee_bps: z.number(), slippage_bps: z.number(),
  paused: z.boolean(), autopilot: z.boolean(),
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
}) {
  const { owner, agentId, assetId, quote } = input;
  const found = maybe(await db.from("paper_accounts").select("*").eq("owner_id", owner).maybeSingle());
  if (!found) return { status: "NO_PAPER_ACCOUNT" as const };
  let account = accountSchema.parse(found);
  const price = paperReferencePrice(quote.price);
  if (account.autopilot && !account.paused) {
    rows(await db.rpc("paper_settle_quote", { p_owner_id: owner, p_asset_id: assetId, p_price: price,
      p_source: quote.source, p_quote_timestamp: quote.dataTimestamp }));
  }
  const vitals = z.object({ lifePct: z.coerce.number(), eliminated: z.boolean() }).loose().parse(rows(
    await db.rpc("paper_mark_agent", { p_owner_id: owner, p_agent_id: agentId, p_price: price,
      p_source: quote.source, p_quote_timestamp: quote.dataTimestamp })));
  if (vitals.eliminated) return { status: "ELIMINATED" as const, lifePct: vitals.lifePct };
  if (!account.autopilot || account.paused) return { status: "MARKED" as const, lifePct: vitals.lifePct };

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
  const pendingBuy = open.filter((o) => o.agent_id === agentId).reduce((sum, o) => sum.plus(String(o.reserved_cash)), new D(0));
  const reserved = new D(account.reserved_cash);
  const exposure = rows(allPositions).reduce((sum, p) => sum.plus(new D(p.quantity).times(String(p.average_cost))), new D(0));
  const availableCash = D.min(new D(account.cash).minus(reserved), new D(account.max_exposure).minus(exposure).minus(reserved));
  const decision = autopilotDecision({
    ticker: input.ticker, quote, history: input.history, now: new Date().toISOString(),
    position: { quantity: held.quantity, averageCost: String(held.average_cost) },
    hasOpenOrder: open.some((o) => o.agent_id === agentId),
    budgetRoom: new D(String(rows(agent).budget)).minus(basis).minus(pendingBuy).toFixed(2),
    maxOrderValue: account.max_order_value, availableCash: availableCash.toFixed(2),
    lotSize: rows(asset).lot_size, tickSize: String(rows(asset).tick_size),
    feeBps: account.fee_bps, slippageBps: account.slippage_bps, stopLossPct: STOP_LOSS_PCT,
  });
  if (decision.action === "HOLD") return { status: "HOLD" as const, reason: decision.reason, lifePct: vitals.lifePct };
  const proposal = z.object({ id: z.uuid() }).loose().parse(rows(await db.rpc("paper_create_proposal", {
    p_owner_id: owner, p_agent_id: agentId, p_side: decision.action, p_quantity: decision.quantity,
    p_limit_price: decision.limitPrice, p_reference_price: decision.referencePrice,
    p_quote_source: quote.source, p_quote_timestamp: quote.dataTimestamp,
    p_history_source: input.history.source, p_history_retrieved_at: input.history.retrievedAt,
    p_strategy_version: AUTOPILOT_VERSION, p_reasoning: decision.reason, p_indicators: decision.indicators,
    p_idempotency_key: input.jobId,
  })));
  const review = z.object({ status: z.string() }).loose().parse(rows(
    await db.rpc("paper_review_proposal", { p_owner_id: owner, p_proposal_id: proposal.id, p_approve: true })));
  return { status: review.status === "OPEN" ? "ORDER_OPENED" as const : "RISK_REJECTED" as const,
    side: decision.action, lifePct: vitals.lifePct };
}
