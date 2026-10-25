import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rangeLevels, RANGE_DEFAULTS } from "@/core/range";
import { scoutGrade, upsideOf } from "@/core/forecast";
import { companyProfile } from "@/core/context";
import { fetchConsensus, fetchDailyCloses, type Consensus } from "@/providers/yahoo";
import { softCached } from "./context";

const DAY = 86400000;

/** Analysts' consensus for one stock, refreshed once a day. */
export function consensusFor(ticker: string): Promise<Consensus | null> {
  return softCached("yahoo", `CONSENSUS:${ticker}`, DAY, 7 * DAY, 120, "https://finance.yahoo.com/", () =>
    fetchConsensus(ticker).then((c) => { if (!c) throw new Error("YAHOO_UNAVAILABLE"); return c; }), undefined, 3600);
}

/**
 * Large, liquid B3 stocks the boss's assistant watches for future agents (outside the team).
 * Kept short so one daily pass stays light on the free sources.
 */
const UNIVERSE = ["BBAS3", "BBDC4", "ITSA4", "ABEV3", "WEGE3", "RENT3", "SUZB3", "GGBR4", "PRIO3", "RADL3", "EQTL3", "CMIG4",
  "SBSP3", "VIVT3", "TIMS3", "BBSE3", "CXSE3", "UGPA3", "VBBR3", "CPLE6", "KLBN11", "CSAN3", "RAIL3", "TAEE11", "EGIE3",
  "LREN3", "CMIN3", "BPAC11", "SANB11", "TOTS3", "PSSA3", "MGLU3"];

export interface ScoutRow {
  ticker: string; company: string; price: number; low: number; high: number; position: number; upside: number | null;
  recommendation: string | null; analysts: number | null; score: number; good: boolean; reasons: string[]; warnings: string[];
}

async function scan(exclude: readonly string[]): Promise<{ at: string; rows: ScoutRow[] }> {
  const rows: ScoutRow[] = [];
  for (const ticker of UNIVERSE.filter((t) => !exclude.includes(t))) {
    const closes = await fetchDailyCloses(ticker, "6mo");
    const levels = closes ? rangeLevels(closes, RANGE_DEFAULTS) : null;
    if (!closes?.length || !levels) continue;
    const price = closes[closes.length - 1];
    const c = await fetchConsensus(ticker);
    const upside = upsideOf(price, c);
    const grade = scoutGrade({ price, low: levels.low, high: levels.high, upside, recommendation: c?.recommendation ?? null, profitMargin: c?.profitMargin ?? null });
    rows.push({ ticker, company: companyProfile(ticker).name, price, low: levels.low, high: levels.high, position: grade.position, upside,
      recommendation: c?.recommendation ?? null, analysts: c?.analysts ?? null, score: grade.score, good: grade.good, reasons: grade.reasons, warnings: grade.warnings });
  }
  if (!rows.length) throw new Error("SCOUT_UNAVAILABLE");
  return { at: new Date().toISOString(), rows: rows.sort((a, b) => b.score - a.score) };
}

/** The assistant's daily list of good stocks for future agents (best first). */
export async function scoutList(db: SupabaseClient, owner: string) {
  const assets = await db.from("assets").select("ticker").eq("owner_id", owner);
  const team = (assets.data ?? []).map((a) => String(a.ticker));
  return softCached("yahoo-scout", "SCOUT:V1", DAY, 7 * DAY, 4, "https://finance.yahoo.com/", () => scan(team), undefined, 3 * 3600);
}

/** Latest saved list (no new scan): what the office shows. */
export async function readScout(db: SupabaseClient, owner: string) {
  const found = await db.from("market_data_cache").select("payload,retrieved_at").eq("owner_id", owner).eq("provider", "yahoo-scout")
    .eq("ticker", "SCOUT:V1").eq("data_kind", "READ_CACHE_V1").order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
  if (found.error) throw found.error;
  return (found.data?.payload as { at: string; rows: ScoutRow[] } | undefined) ?? null;
}
