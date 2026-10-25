import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GatewayError, HttpExecutionGateway } from "@/providers/execution-gateway";
import { bossRelease } from "./boss";
import { b3Session } from "@/core/b3-calendar";
import { mergeFractionalPositions } from "@/core/lots";
import { custodyShortfalls, liveIntent, minimumSellPrice, quoteProblem, sendOutcome, sizeLiveBuy, sizeLiveSell } from "@/core/live";
import { adminClient } from "./supabase";
import { required } from "./env";
import { notify } from "./notify";

/**
 * Real-money executor for Genial (runs on the owner's PC, next to MetaTrader). Each tick:
 * 1) follows up orders already sent (never resends an ambiguous one), 2) records broker deals,
 * 3) checks that Genial holds at least what ATLAS bought, 4) mirrors the simulation's autopilot
 * decisions with the agent's real budget, priced from MetaTrader's live book.
 * Needs LIVE_TRADING_ENABLED=true here, the owner's switch in the panel and, in the bridge,
 * ATLAS_MT5_ENABLE_EXECUTION=true. Entries only follow decisions from the last 20 minutes.
 */
const ACTIVE = ["PENDING", "DISPATCHED", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"];
const clientId = (orderId: string) => `atlas-${orderId}`;

async function alertOnce(_db: SupabaseClient, kind: string, text: string, windowSeconds = 3600) {
  await notify({ level: "warning", title: text, dedupeKey: `live:${kind}`, windowSeconds });
}

type Row = Record<string, unknown> & { id: string };
const ok = <T>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message.match(/ATLAS_[A-Z_]+/)?.[0] ?? "LIVE_DATABASE_UNAVAILABLE"); return r.data as T; };

export async function runLive(now = new Date()) {
  if (process.env.LIVE_TRADING_ENABLED !== "true") return { status: "OFF_ENV" as const };
  const db = adminClient(), owner = required("ATLAS_OWNER_ID");
  const [settings, active] = await Promise.all([
    db.from("live_settings").select("*").eq("owner_id", owner).maybeSingle(),
    db.from("live_orders").select("*").eq("owner_id", owner).in("status", ACTIVE),
  ]);
  const enabled = settings.data?.enabled === true;
  if (!enabled && !(active.data ?? []).length) return { status: "OFF" as const };

  let gateway: HttpExecutionGateway;
  try {
    gateway = await HttpExecutionGateway.connect({ url: required("ATLAS_GATEWAY_URL"), token: required("ATLAS_GATEWAY_TOKEN"),
      expectedAccountId: required("ATLAS_GATEWAY_ACCOUNT_ID"), expectedProviderId: required("ATLAS_GATEWAY_PROVIDER_ID"), timeoutMs: 8000 });
  } catch {
    await alertOnce(db, "gateway", "Dinheiro real: a ponte com a Genial está fora do ar. Abra o MetaTrader e confira se a ponte está rodando.");
    return { status: "GATEWAY_DOWN" as const };
  }
  const health = await gateway.healthCheck();
  const events: string[] = [];

  // 1) Follow up orders already created.
  for (const order of (active.data ?? []) as Row[]) {
    const age = now.getTime() - Date.parse(String(order.dispatched_at ?? order.created_at));
    try {
      if (order.status === "PENDING") {
        // Marked DISPATCHED before every send, so an old PENDING was never sent.
        if (age > 60_000) ok(await db.rpc("live_mark_order", { p_owner_id: owner, p_order_id: order.id, p_status: "REJECTED", p_broker_order_id: null, p_broker_filled: null, p_error: "NOT_SENT" }));
        continue;
      }
      if (order.status !== "UNKNOWN" && order.status !== "DISPATCHED" && !order.broker_order_id) continue;
      if ((order.status === "DISPATCHED" || order.status === "UNKNOWN") && age < 15_000) continue;
      const seen = order.broker_order_id ? await gateway.getOrder(String(order.broker_order_id)) : await gateway.getOrderByClientId(clientId(order.id));
      if (!seen) {
        if (order.status !== "UNKNOWN") ok(await db.rpc("live_mark_order", { p_owner_id: owner, p_order_id: order.id, p_status: "UNKNOWN", p_broker_order_id: null, p_broker_filled: null, p_error: "NOT_FOUND_AT_BROKER" }));
        await alertOnce(db, `unknown:${order.id}`, `Dinheiro real: não sei se a ordem de ${order.side === "BUY" ? "compra" : "venda"} de ${order.quantity} ${order.symbol} chegou na Genial. Nada será reenviado. Confira no MetaTrader ou ligue 11 4004-8888.`, 6 * 3600);
        continue;
      }
      const status = seen.status === "PENDING" ? "OPEN" : seen.status;
      if (status !== order.status || seen.filledQuantity !== order.broker_filled || !order.broker_order_id)
        ok(await db.rpc("live_mark_order", { p_owner_id: owner, p_order_id: order.id, p_status: status, p_broker_order_id: seen.brokerOrderId, p_broker_filled: seen.filledQuantity, p_error: null }));
    } catch (error) { events.push(`follow-up ${order.id}: ${error instanceof Error ? error.message : "erro"}`); }
  }

  // 2) Broker deals (idempotent; deals of orders ATLAS did not send are ignored).
  try {
    const sync = await db.from("live_sync").select("cursor").eq("owner_id", owner).maybeSingle();
    let cursor: string | null = sync.data?.cursor ?? null;
    for (let page = 0; page < 3; page++) {
      const batch = await gateway.getExecutions(cursor);
      for (const deal of batch.executions) {
        const recorded = ok(await db.rpc("live_record_fill", { p_owner_id: owner, p_fill: { executionId: deal.executionId, brokerOrderId: deal.brokerOrderId, side: deal.side,
          quantity: deal.quantity, price: deal.price, executedAt: deal.executedAt } }));
        if (recorded === "RECORDED") {
          const placed = await db.from("live_orders").select("agent_id,ticker").eq("owner_id", owner).eq("broker_order_id", deal.brokerOrderId).maybeSingle();
          const who = placed.data ? (await db.from("agents").select("name").eq("id", placed.data.agent_id).maybeSingle()).data?.name ?? "IA" : "IA";
          const value = Number(deal.quantity) * Number(deal.price);
          await notify({ level: "success", title: `${deal.side === "BUY" ? "Compra" : "Venda"} executada na Genial: ${who} ${deal.side === "BUY" ? "comprou" : "vendeu"} ${deal.quantity} ${placed.data?.ticker ?? ""}`,
            lines: [`Preço: R$ ${Number(deal.price).toFixed(2).replace(".", ",")} por ação · total R$ ${value.toFixed(2).replace(".", ",")}`, `Quando: ${new Date(deal.executedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`] });
        }
      }
      cursor = batch.nextCursor;
      if (!cursor) break;
    }
    // A finished pass starts over next time, so late or corrected deals are still caught.
    await db.from("live_sync").upsert({ owner_id: owner, cursor, updated_at: new Date().toISOString() });
  } catch (error) { events.push(`deals: ${error instanceof Error ? error.message : "erro"}`); }

  // 3) Custody check, only when nothing is in flight.
  const [positions, stillActive] = await Promise.all([
    db.from("live_positions").select("agent_id,ticker,quantity,cost,realized_pnl").eq("owner_id", owner),
    db.from("live_orders").select("id,agent_id,side,status,quantity,filled_quantity,reserved_cash").eq("owner_id", owner).in("status", ACTIVE),
  ]);
  const held: Record<string, number> = {};
  for (const p of positions.data ?? []) held[p.ticker] = (held[p.ticker] ?? 0) + Number(p.quantity);
  if (!(stillActive.data ?? []).length && Object.values(held).some((q) => q > 0)) {
    try {
      const short = custodyShortfalls(held, mergeFractionalPositions(await gateway.getPositions()));
      if (short.length) {
        const text = short.map((s) => `${s.ticker}: ATLAS ${s.atlas}, Genial ${s.broker}`).join("; ");
        await db.rpc("live_halt", { p_owner_id: owner, p_reason: `Genial mostra menos ações que o ATLAS (${text}).` });
        await notify({ level: "error", title: "Dinheiro real PARADO: a Genial mostra menos ações do que o ATLAS registrou", lines: [text, "Confira no MetaTrader antes de religar."] });
        return { status: "HALTED" as const, events };
      }
    } catch (error) { events.push(`custódia: ${error instanceof Error ? error.message : "erro"}`); }
  }

  // 4) New orders.
  if (!enabled || !health.healthy || health.reason) return { status: health.healthy ? "MONITORING" as const : "GATEWAY_UNHEALTHY" as const, events };
  if (b3Session(now).status !== "OPEN") return { status: "MARKET_CLOSED" as const, events };
  const busy = new Set((stillActive.data ?? []).map((o) => o.agent_id));
  const [agents, proposals] = await Promise.all([
    db.from("agents").select("id,name,status,autopilot,real_budget,asset_id").eq("owner_id", owner).gt("real_budget", 0),
    db.from("paper_proposals").select("id,agent_id,side,reasoning_summary,created_at").eq("owner_id", owner)
      .like("strategy_version", "paper-autopilot%").gte("created_at", new Date(now.getTime() - 3 * 86400000).toISOString())
      .order("created_at", { ascending: false }).limit(200),
  ]);
  if (agents.error || proposals.error || !(agents.data ?? []).length) return { status: "IDLE" as const, events };
  const paperOrders = await db.from("paper_orders").select("id,proposal_id,agent_id,side,limit_price,placed_at").eq("owner_id", owner)
    .in("proposal_id", (proposals.data ?? []).map((p) => p.id));
  const assets = await db.from("assets").select("id,ticker").eq("owner_id", owner);
  const mirrored = await db.from("live_orders").select("paper_order_id").eq("owner_id", owner).not("paper_order_id", "is", null)
    .in("paper_order_id", (paperOrders.data ?? []).map((o) => o.id));
  const done = new Set((mirrored.data ?? []).map((m) => m.paper_order_id));
  const today = new Date(now).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const refused = await db.from("live_orders").select("agent_id").eq("owner_id", owner).eq("status", "REJECTED").eq("side", "BUY")
    .gte("created_at", new Date(`${today}T00:00:00-03:00`).toISOString());
  const refusedToday = new Set((refused.data ?? []).map((o) => o.agent_id));

  for (const agent of agents.data ?? []) {
    if (busy.has(agent.id) || ["DEAD", "FIRED"].includes(agent.status) || agent.autopilot === false) continue;
    if (refusedToday.has(agent.id)) continue;
    const ticker = assets.data?.find((a) => a.id === agent.asset_id)?.ticker;
    // The agent's latest autopilot intent decides: enter on a fresh BUY, leave on any SELL.
    const latest = (paperOrders.data ?? []).filter((o) => o.agent_id === agent.id).sort((a, b) => String(b.placed_at).localeCompare(String(a.placed_at)))[0];
    if (!ticker || !latest) continue;
    const proposal = proposals.data?.find((p) => p.id === latest.proposal_id);
    const mine = (positions.data ?? []).filter((p) => p.agent_id === agent.id && p.ticker === ticker);
    const qty = mine.reduce((s, p) => s + Number(p.quantity), 0);
    try {
      const quote = await gateway.getQuote(ticker);
      const intent = liveIntent({ id: latest.id, side: latest.side as "BUY" | "SELL", placedAt: String(latest.placed_at) }, qty, done.has(latest.id), now.getTime());
      if (intent === "BUY") {
        const problem = quoteProblem(quote, String(latest.limit_price), now.getTime());
        if (problem) { events.push(`${agent.name}: ${problem}`); continue; }
        // The boss's pot: deposits + realized results − cost of all shares held − buy orders in flight.
        const plan = await db.from("capital_plans").select("ceiling").eq("owner_id", owner).maybeSingle();
        const deposited = Number(plan.data?.ceiling ?? 0);
        const pool = deposited + (positions.data ?? []).reduce((s, p) => s + Number(p.realized_pnl) - Number(p.cost), 0)
          - (stillActive.data ?? []).filter((o) => o.side === "BUY").reduce((s, o) => s + Number(o.reserved_cash), 0);
        const room = await bossRelease(db, owner, agent.id, pool, { [ticker]: Number(quote.ask) });
        const size = sizeLiveBuy(room, Number(settings.data!.max_order), quote.ask!);
        if ("skip" in size) { events.push(`${agent.name}: ${size.skip}`); continue; }
        await send(agent.id, "BUY", size.quantity, size.limit, `${agent.name}: ${proposal?.reasoning_summary ?? "sinal de compra do piloto"}`, latest.id);
      } else if (intent === "SELL") {
        const problem = quoteProblem(quote, null, now.getTime());
        if (problem) { events.push(`${agent.name}: ${problem}`); continue; }
        const size = sizeLiveSell(qty, quote.bid!);
        if (!size) continue;
        // Owner rule: never sell below what was paid (fees included) plus a small margin.
        const cost = mine.reduce((sum, p) => sum + Number(p.cost), 0);
        const floor = minimumSellPrice(cost, qty);
        if (Number(size.limit) < Number(floor)) { events.push(`${agent.name}: segurando; venda só a partir de R$ ${floor}`); continue; }
        await send(agent.id, "SELL", size.quantity, size.limit, `${agent.name}: ${proposal?.reasoning_summary ?? "sinal de venda do piloto"}`, done.has(latest.id) ? null : latest.id);
      }
    } catch (error) { events.push(`${agent.name}: ${error instanceof Error ? error.message : "erro"}`); }
  }
  return { status: "CHECKED" as const, events };

  async function send(agentId: string, side: "BUY" | "SELL", quantity: number, limit: string, reason: string, paperOrderId: string | null) {
    const order = ok(await db.rpc("live_create_order", { p_owner_id: owner, p_agent_id: agentId, p_side: side, p_quantity: quantity,
      p_limit: limit, p_reason: reason.slice(0, 500), p_paper_order_id: paperOrderId })) as unknown as Row & { symbol: string };
    ok(await db.rpc("live_mark_order", { p_owner_id: owner, p_order_id: order.id, p_status: "DISPATCHED", p_broker_order_id: null, p_broker_filled: null, p_error: null }));
    try {
      const result = await gateway.placeOrder({ clientOrderId: clientId(order.id), accountId: required("ATLAS_GATEWAY_ACCOUNT_ID"), symbol: order.symbol,
        side, quantity, kind: "LIMIT", limitPrice: limit, stopPrice: null, timeInForce: "DAY" });
      const status = result.status === "PENDING" ? "OPEN" : result.status;
      ok(await db.rpc("live_mark_order", { p_owner_id: owner, p_order_id: order.id, p_status: status, p_broker_order_id: result.brokerOrderId, p_broker_filled: result.filledQuantity, p_error: null }));
      await notify({ level: "info", title: `Ordem enviada à Genial: ${side === "BUY" ? "compra" : "venda"} de ${quantity} ${order.symbol} a até R$ ${limit.replace(".", ",")}`, lines: [reason.slice(0, 300)] });
    } catch (error) {
      const code = error instanceof GatewayError ? error.code : "AMBIGUOUS";
      if (sendOutcome(code) === "REJECTED") {
        ok(await db.rpc("live_mark_order", { p_owner_id: owner, p_order_id: order.id, p_status: "REJECTED", p_broker_order_id: null, p_broker_filled: null, p_error: code }));
        // A refused purchase (often money missing at Genial) pauses only this agent for the day.
        await notify({ level: "warning", title: `A Genial recusou a ${side === "BUY" ? "compra" : "venda"} de ${quantity} ${order.symbol}`,
          lines: [side === "BUY" ? "Pode ser falta de saldo na Genial. Se você depositou, registre o depósito em Carteira → Depositei mais." : `Motivo informado: ${code}.`,
            "Esta IA não tenta de novo hoje; as outras continuam."] });
      } else {
        ok(await db.rpc("live_mark_order", { p_owner_id: owner, p_order_id: order.id, p_status: "UNKNOWN", p_broker_order_id: null, p_broker_filled: null, p_error: code.slice(0, 300) }));
        await notify({ level: "warning", title: `Resposta incerta da Genial para ${quantity} ${order.symbol}`, lines: ["Nada será reenviado; o ATLAS confere sozinho em seguida."] });
      }
    }
  }
}
