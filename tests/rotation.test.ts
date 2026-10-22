import { describe, expect, it } from "vitest";
import { runEqualWeightHold, runRotation, type SeriesBar } from "@/core/rotation";

const days = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10));
const series = (f: (i: number) => number): SeriesBar[] => days.map((date, i) => ({ date, open: f(i), close: f(i) }));
const data = { UP: series((i) => 10 * 1.003 ** i), FLAT: series(() => 10), DOWN: series((i) => 10 * 0.998 ** i) };
const options = { lookback: 20, top: 1, rebalanceEvery: 10, trendPeriod: 50, absoluteMomentum: true, costBps: 13, initial: 10000 };

describe("portfolio rotation research", () => {
  it("rotates into the strongest stock and beats an equal-weight hold", () => {
    const rotation = runRotation(data, options);
    const hold = runEqualWeightHold(data, options);
    expect(rotation.totalReturn).toBeGreaterThan(hold.totalReturn);
    expect(rotation.trades).toBeGreaterThan(0);
    expect(rotation.equity).toHaveLength(300);
  });

  it("stays in cash when nothing has positive momentum above its trend", () => {
    const falling = { A: series((i) => 10 * 0.999 ** i), B: series((i) => 20 * 0.998 ** i) };
    const result = runRotation(falling, options);
    expect(result.trades).toBe(0);
    expect(result.totalReturn).toBe(0);
  });

  it("reports drawdown and yearly returns", () => {
    const hold = runEqualWeightHold({ X: series((i) => (i < 150 ? 10 : 8)) }, options);
    expect(hold.maxDrawdown).toBeGreaterThan(0.19);
    expect(Object.keys(hold.byYear)).toEqual(["2024"]);
  });
});
