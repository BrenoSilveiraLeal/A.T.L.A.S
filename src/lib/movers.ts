import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { b3Session, saoPauloClock } from "@/core/b3-calendar";
import { loadPrices } from "./prices";
import { notify } from "./notify";

/**
 * Big moves of the team's stocks during the session (owner, 26/10/2026: "se uma ação subiu, se uma
 * ação caiu... pelo meu WhatsApp"): every 3% step of today's move against yesterday's close, once
 * per stock, direction and step per day. Checked at most every 5 minutes, with the Genial price.
 */
export const MOVE_STEP = 0.03;

export function moveStep(change: number) { return Math.floor(Math.abs(change) / MOVE_STEP); }

export async function notifyBigMoves(db: SupabaseClient, owner: string, now = new Date()) {
  if (b3Session(now).status !== "OPEN") return;
  const allowed = await db.rpc("consume_rate_limit", { p_key: `movers:${owner}`, p_limit: 1, p_window_seconds: 300 });
  if (allowed.error || !allowed.data) return;
  const day = saoPauloClock(now).date;
  const [agents, assets, prices] = await Promise.all([
    db.from("agents").select("name,status,asset_id").eq("owner_id", owner),
    db.from("assets").select("id,ticker").eq("owner_id", owner),
    loadPrices(db, owner),
  ]);
  if (agents.error || assets.error || prices.source !== "MT5") return;
  for (const agent of agents.data.filter((a) => !["DEAD", "FIRED"].includes(String(a.status)))) {
    const ticker = String(assets.data.find((a) => a.id === agent.asset_id)?.ticker ?? "");
    const price = prices.prices[ticker]?.price;
    if (!ticker || !price) continue;
    const previous = await db.from("market_bars").select("close").eq("ticker", ticker).lt("trade_date", day)
      .order("trade_date", { ascending: false }).limit(1).maybeSingle();
    const close = Number(previous.data?.close ?? 0);
    if (!(close > 0)) continue;
    const change = price / close - 1, step = moveStep(change);
    if (step < 1) continue;
    const up = change > 0, pct = `${up ? "+" : "−"}${Math.abs(change * 100).toFixed(1).replace(".", ",")}%`;
    await notify({ level: up ? "success" : "warning", whatsapp: true,
      title: `${ticker} ${up ? "sobe" : "cai"} ${pct} hoje (${agent.name})`,
      lines: [`Agora R$ ${price.toFixed(2).replace(".", ",")} · ontem fechou em R$ ${close.toFixed(2).replace(".", ",")}.`],
      dedupeKey: `move:${ticker}:${day}:${up ? "up" : "down"}:${step}`, windowSeconds: 86400 });
  }
}
