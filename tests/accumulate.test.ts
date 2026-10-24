import { describe, expect, it } from "vitest";
import { accumulateDecision, ACCUMULATE_DEFAULTS } from "@/core/accumulate";

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
const base = { quantity: 0, cost: 0, cash: 300, peakSinceEntry: null };

describe("accumulate on dips, sell near the top", () => {
  it("waits while the stock is not cheap or money is short", () => {
    expect(accumulateDecision({ ...base, closes: flat(260, 10), price: 9.5 }).action).toBe("HOLD");
    expect(accumulateDecision({ ...base, cash: 50, closes: flat(260, 10), price: 8 }).reason).toContain("juntando");
  });

  it("buys after a 15% fall once the price turns up, and only below its own average later", () => {
    const falling = [...flat(250, 10), 9, 8.6, 8.4, 8.2, 8.1];
    expect(accumulateDecision({ ...base, closes: falling, price: 8.0 }).reason).toContain("ainda caindo");
    expect(accumulateDecision({ ...base, closes: falling, price: 8.3 })).toMatchObject({ action: "BUY", spend: 300 });
    const held = { ...base, quantity: 10, cost: 85, closes: falling };
    expect(accumulateDecision({ ...held, price: 8.3 }).action).toBe("HOLD"); // 8.30 > 8.50 × 0.95
    expect(accumulateDecision({ ...held, price: 8.0, closes: [...falling.slice(0, -1), 7.9] }).action).toBe("BUY");
  });

  it("sells everything only after a 40% gain and an 8% turn from the top, never at a loss", () => {
    const rally = [...flat(250, 10), 12, 13, 14, 15];
    const held = { ...base, quantity: 10, cost: 90, closes: rally }; // average R$ 9
    expect(accumulateDecision({ ...held, price: 15, peakSinceEntry: 15 }).reason).toContain("segura");
    expect(accumulateDecision({ ...held, price: 13.7, peakSinceEntry: 15 }).action).toBe("SELL");
    expect(accumulateDecision({ ...held, cost: 200, price: 13.7, peakSinceEntry: 15 }).action).not.toBe("SELL");
    expect(ACCUMULATE_DEFAULTS.minOrder).toBe(100);
  });
});
