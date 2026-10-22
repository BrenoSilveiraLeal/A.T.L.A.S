import { describe, expect, it } from "vitest";
import { adjustStoredBars, levelPlan } from "@/core/strategies";

const bar = (close: number, i: number) => ({ trade_date: `2026-01-${String(i + 1).padStart(2, "0")}`, high: (close + 1).toFixed(2), low: (close - 1).toFixed(2), close: close.toFixed(2) });

describe("price levels", () => {
  it("computes floor/ceiling from prior bars and the trend from the long average", () => {
    const bars = Array.from({ length: 120 }, (_, i) => ({ high: String(11 + i * 0.1), low: String(9 + i * 0.1), close: String(10 + i * 0.1) }));
    const plan = levelPlan(bars)!;
    // Window = the 20 bars before the latest one (indexes 99..118).
    expect(plan.floor).toBe("18.90");
    expect(plan.ceiling).toBe("22.80");
    expect(plan.trendUp).toBe(true);
    expect(plan.low52w).toBeNull();
    expect(levelPlan(bars.slice(0, 20))).toBeNull();
  });

  it("makes stored prices continuous across splits, groupings and bonus issues", () => {
    const bars = [bar(20, 0), bar(20, 1), bar(10, 2), bar(10, 3)];
    const split = adjustStoredBars(bars, [{ kind: "SPLIT", value: "100", lastDatePrior: "2026-01-02" }]);
    expect(split.map((b) => Number(b.close))).toEqual([10, 10, 10, 10]);
    const grouping = adjustStoredBars([bar(1, 0), bar(10, 1)], [{ kind: "GROUPING", value: "0.1", lastDatePrior: "2026-01-01" }]);
    expect(grouping.map((b) => Number(b.close))).toEqual([10, 10]);
    const cashIgnored = adjustStoredBars([bar(10, 0)], [{ kind: "CASH", value: "1", lastDatePrior: "2026-01-05" }]);
    expect(Number(cashIgnored[0].close)).toBe(10);
  });
});
