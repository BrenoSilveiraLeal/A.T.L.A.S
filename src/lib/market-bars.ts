import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketHistory } from "@/providers/types";
import { saoPauloClock } from "@/core/b3-calendar";

export interface StoredBar { trade_date: string; open: string; high: string; low: string; close: string; volume: number }

/**
 * Appends feed bars to the long history. Insert-only: an existing day (for instance
 * from the official B3 file) is never overwritten. Failures never block an analysis.
 */
export async function storeBars(db: SupabaseClient, history: MarketHistory) {
  const rows = history.bars
    .filter((b) => Number(b.low) > 0 && Number(b.low) <= Number(b.high))
    .map((b) => ({ ticker: history.ticker, trade_date: saoPauloClock(new Date(b.timestamp)).date, open: b.open, high: b.high,
      low: b.low, close: b.close, volume: Math.max(0, Math.round(b.volume)), source: "BRAPI" }));
  if (!rows.length) return 0;
  const result = await db.from("market_bars").upsert(rows, { onConflict: "ticker,trade_date", ignoreDuplicates: true });
  if (result.error) throw result.error;
  return rows.length;
}

/** Latest `limit` daily bars, oldest first. */
export async function loadBars(db: SupabaseClient, ticker: string, limit = 320): Promise<StoredBar[]> {
  const result = await db.from("market_bars").select("trade_date,open,high,low,close,volume").eq("ticker", ticker)
    .order("trade_date", { ascending: false }).limit(limit);
  if (result.error) throw result.error;
  return (result.data as StoredBar[]).map((b) => ({ ...b, open: String(b.open), high: String(b.high), low: String(b.low), close: String(b.close) })).reverse();
}
