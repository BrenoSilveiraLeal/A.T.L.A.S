import { describe, expect, it } from "vitest";
import { adjustedCandles, normalizePriceSeries, appendQuotePoint } from "@/core/price-series";

describe("daily chart price series", () => {
  const bars = [
    { trade_date: "2026-01-06", open: "10", high: "11", low: "9", close: "10", volume: 20 },
    { trade_date: "2026-01-05", open: "20", high: "22", low: "18", close: "20", volume: 10 },
  ];

  it("orders bars chronologically and preserves missing sessions without inventing candles", () => {
    const result = normalizePriceSeries(bars);
    expect(result.map((bar) => bar.trade_date)).toEqual(["2026-01-05", "2026-01-06"]);
    expect(result).toHaveLength(2);
  });

  it.each([
    [{ ...bars[0], trade_date: "2026-02-30" }, bars[1]],
    [bars[0], bars[0]],
    [{ ...bars[0], high: "9.5" }, bars[1]],
    [{ ...bars[0], low: "10.5" }, bars[1]],
    [{ ...bars[0], close: "NaN" }, bars[1]],
  ])("rejects invalid or duplicate observations", (first, second) => {
    expect(() => normalizePriceSeries([first, second])).toThrow("INVALID_PRICE_SERIES");
  });

  it("scales every OHLC component through a split without changing candle shape", () => {
    const raw = normalizePriceSeries([
      { trade_date: "2026-01-05", open: "20", high: "22", low: "18", close: "20", volume: 10 },
      { trade_date: "2026-01-06", open: "10", high: "11", low: "9", close: "10", volume: 20 },
    ]);
    const candles = adjustedCandles(raw, [10, 10]);
    expect(candles[0]).toEqual({ date: "2026-01-05", open: 10, high: 11, low: 9, close: 10 });
    expect(candles[1]).toEqual({ date: "2026-01-06", open: 10, high: 11, low: 9, close: 10 });
    expect(candles.every((bar) => bar.low <= bar.open && bar.open <= bar.high && bar.low <= bar.close && bar.close <= bar.high)).toBe(true);
  });

  it("rejects an adjustment series that is not aligned to the raw history", () => {
    expect(() => adjustedCandles([bars[0]], [])).toThrow("PRICE_SERIES_LENGTH_MISMATCH");
    expect(() => adjustedCandles([bars[0]], [0])).toThrow("INVALID_PRICE_ADJUSTMENT");
  });
});

it("keeps real quote timestamps in order, ignores duplicates and starts a separate trail each trading day", () => {
  let points = appendQuotePoint([], { price: 20, at: "2026-11-04T15:00:00Z" });
  points = appendQuotePoint(points, { price: 21, at: "2026-11-04T15:00:05Z" });
  expect(appendQuotePoint(points, { price: 19, at: "2026-11-04T15:00:00Z" })).toEqual(points);
  expect(appendQuotePoint(points, { price: NaN, at: "2026-11-04T15:00:10Z" })).toEqual(points);
  expect(appendQuotePoint(points, { price: 22, at: "2026-11-05T15:00:00Z" })).toEqual([{ price: 22, at: "2026-11-05T15:00:00Z" }]);
});
