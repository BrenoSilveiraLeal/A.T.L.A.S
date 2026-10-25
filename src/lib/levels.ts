import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adjustStoredBars, levelPlan } from "@/core/strategies";
import { isinPrefix, type CorporateEvent } from "@/core/corporate-actions";
import { fetchB3Events, b3EventsUrl } from "@/providers/b3-events";
import { loadBars } from "./market-bars";
import { RANGE_DEFAULTS, rangeLevels } from "@/core/range";
import { softCached } from "./context";

/** The agent's price plan from the long official history, adjusted by official stock events. */
export async function agentLevels(db: SupabaseClient, ticker: string) {
  const bars = await loadBars(db, ticker, 320);
  if (bars.length < 21) return { ticker, available: false as const, bars: bars.length, reason: "Histórico insuficiente para calcular os níveis." };
  const prefix = isinPrefix(ticker);
  const events = prefix ? await softCached<CorporateEvent[]>("b3", `EVENTS:${ticker.slice(0, 4)}`, 12 * 3600000, 7 * 86400000, 100,
    b3EventsUrl(ticker.slice(0, 4)), () => fetchB3Events(ticker.slice(0, 4)), undefined, 1800) : null;
  const adjusted = adjustStoredBars(bars, (events ?? []).filter((e) => prefix && e.isin.startsWith(prefix)));
  const plan = levelPlan(adjusted);
  // The owner's rule: lowest and highest close of the last 6 months and the buy/sell triggers.
  const closes = adjusted.map((b) => Number(b.close));
  const levels = rangeLevels(closes, RANGE_DEFAULTS);
  const recent = bars.slice(-RANGE_DEFAULTS.window);
  const dateOf = (value: number) => recent[adjusted.slice(-RANGE_DEFAULTS.window).findIndex((b) => Number(b.close) === value)]?.trade_date ?? null;
  const range = levels ? { ...levels, window: RANGE_DEFAULTS.window, nearPct: RANGE_DEFAULTS.nearPct, months: Math.round(RANGE_DEFAULTS.window / 21),
    lowDate: dateOf(levels.low), highDate: dateOf(levels.high) } : null;
  return { ticker, available: true as const, bars: bars.length, from: bars[0].trade_date, to: bars[bars.length - 1].trade_date,
    lastClose: Number(adjusted[adjusted.length - 1].close).toFixed(2), eventsVerified: events !== null, plan, range };
}
