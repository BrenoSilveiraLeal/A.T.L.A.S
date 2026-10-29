import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dividendRows } from "@/core/dividends";
import { isinPrefix, type CorporateEvent } from "@/core/corporate-actions";
import { saoPauloClock } from "@/core/b3-calendar";
import { b3EventsUrl, fetchB3Events } from "@/providers/b3-events";
import { softCached } from "./context";
import { notify } from "./notify";

const brl = (v: string | number) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Records the dividends and JCP the real shares are entitled to (core/dividends), from B3's
 * official list, at most every 6 hours. A new event is told to the owner (bell and e-mail) with
 * what it pays and when; the money counts as free cash from its payment date (lib/live-view and
 * live_agent_room). Nothing here can place or change an order.
 */
export async function creditDividends(db: SupabaseClient, owner: string) {
  const rate = await db.rpc("consume_rate_limit", { p_key: `atlas-dividends:${owner}`, p_limit: 1, p_window_seconds: 21600 });
  if (rate.error || !rate.data) return { recorded: 0, skipped: true };
  const fills = await db.from("live_fills").select("agent_id,ticker,side,quantity,executed_at").eq("owner_id", owner);
  if (fills.error) throw new Error("DIVIDENDS_FILLS_UNAVAILABLE");
  const groups = new Map<string, { agentId: string; ticker: string; fills: { side: "BUY" | "SELL"; quantity: number; date: string }[] }>();
  for (const f of fills.data ?? []) {
    const key = `${f.agent_id}:${f.ticker}`;
    if (!groups.has(key)) groups.set(key, { agentId: String(f.agent_id), ticker: String(f.ticker), fills: [] });
    groups.get(key)!.fills.push({ side: f.side as "BUY" | "SELL", quantity: Number(f.quantity), date: saoPauloClock(new Date(String(f.executed_at))).date });
  }
  let recorded = 0;
  for (const g of groups.values()) {
    const issuer = g.ticker.slice(0, 4);
    const events = await softCached<CorporateEvent[]>("b3", `EVENTS:${issuer}`, 6 * 3600000, 7 * 86400000, 100,
      b3EventsUrl(issuer), () => fetchB3Events(issuer), undefined, 1800).catch(() => null);
    if (!events) continue;
    for (const row of dividendRows(g.fills, events, isinPrefix(g.ticker))) {
      const result = await db.rpc("live_record_dividend", { p_owner_id: owner, p_event: { agentId: g.agentId, ticker: g.ticker, ...row, source: b3EventsUrl(issuer) } });
      if (result.error) throw new Error("DIVIDENDS_RECORD_FAILED");
      if (result.data !== "RECORDED") continue;
      recorded++;
      const kind = /JRS/.test(row.label) ? "JCP" : "Dividendo";
      const paid = row.paymentDate <= saoPauloClock(new Date()).date;
      await notify({ level: "success", email: true, title: `${kind} da ${g.ticker}: ${brl(row.net)} ${paid ? "recebido" : `a receber em ${day(row.paymentDate)}`}`,
        lines: [`${row.quantity} ações × R$ ${row.rate} por ação = ${brl(row.gross)}${Number(row.tax) > 0 ? `, menos ${brl(row.tax)} de imposto retido na fonte` : ""}.`,
          `Direito de quem tinha a ação em ${day(row.lastDatePrior)}; pagamento em ${day(row.paymentDate)}.`,
          "O valor entra no caixa do ATLAS na data do pagamento e volta a comprar ações que pagam dividendos."] });
    }
  }
  return { recorded, skipped: false };
}
