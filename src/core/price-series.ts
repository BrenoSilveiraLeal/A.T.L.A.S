/** Shared, non-interpolating helpers for daily price series shown in charts. */
export interface QuotePoint { price: number; at: string }
const quoteDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" });

export function appendQuotePoint(points: readonly QuotePoint[], point: QuotePoint, limit = 2000): QuotePoint[] {
  const time = Date.parse(point.at);
  if (!Number.isFinite(time) || !Number.isFinite(point.price) || point.price <= 0) return [...points];
  const day = quoteDay.format(new Date(time));
  const last = points.at(-1);
  if (last && Date.parse(last.at) >= time) return [...points];
  const sameDay = last && quoteDay.format(new Date(last.at)) === day;
  return [...(sameDay ? points : []), point].slice(-limit);
}
export interface RawPriceBar {
  trade_date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: number;
}

export interface AdjustedCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Sorts oldest first and rejects bad or duplicate observations; never fills missing sessions. */
export function normalizePriceSeries<T extends RawPriceBar>(bars: readonly T[]): T[] {
  const sorted = [...bars].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  let previous = "";
  for (const bar of sorted) {
    const open = Number(bar.open), high = Number(bar.high), low = Number(bar.low), close = Number(bar.close);
    if (!validDate(bar.trade_date) || bar.trade_date === previous ||
        ![open, high, low, close].every((n) => Number.isFinite(n) && n > 0) ||
        high < Math.max(open, close) || low > Math.min(open, close) || low > high ||
        (bar.volume !== undefined && (!Number.isFinite(bar.volume) || bar.volume < 0))) {
      throw new Error("INVALID_PRICE_SERIES");
    }
    previous = bar.trade_date;
  }
  return sorted;
}

/** Applies the same per-bar split adjustment to every OHLC value, preserving candle shape. */
export function adjustedCandles<T extends RawPriceBar>(raw: readonly T[], adjustedClose: readonly number[]): AdjustedCandle[] {
  if (raw.length !== adjustedClose.length) throw new Error("PRICE_SERIES_LENGTH_MISMATCH");
  return raw.map((bar, i) => {
    const close = Number(bar.close), targetClose = adjustedClose[i];
    const factor = targetClose / close;
    if (!Number.isFinite(factor) || factor <= 0) throw new Error("INVALID_PRICE_ADJUSTMENT");
    return {
      date: bar.trade_date,
      open: Number((Number(bar.open) * factor).toFixed(8)),
      high: Number((Number(bar.high) * factor).toFixed(8)),
      low: Number((Number(bar.low) * factor).toFixed(8)),
      close: targetClose,
    };
  });
}
