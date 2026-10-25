import { describe, expect, it } from "vitest";
import { bossGrant } from "@/core/boss";
import { rangeDecision } from "@/core/range";

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

describe("the boss releases money from one pot", () => {
  it("gives a small account enough for one share, and nothing when the pot cannot pay one", () => {
    expect(bossGrant({ pool: 50, deposited: 50, committed: 0, price: 48.5, fee: 0.99 })).toBe(49.97);
    expect(bossGrant({ pool: 30, deposited: 50, committed: 0, price: 48.5, fee: 0.99 })).toBe(0);
  });

  it("caps one agent at half of the deposits on bigger accounts and returns sales to the pot", () => {
    expect(bossGrant({ pool: 1000, deposited: 1000, committed: 0, price: 30, fee: 0.99 })).toBe(500);
    expect(bossGrant({ pool: 600, deposited: 1000, committed: 400, price: 30, fee: 0.99 })).toBe(100);
    expect(bossGrant({ pool: 600, deposited: 1000, committed: 500, price: 30, fee: 0.99 })).toBe(0);
  });
});

describe("buy near the 6-month low, sell near the 6-month high", () => {
  const closes = [...flat(60, 50), ...flat(30, 40), ...flat(36, 60)]; // low 40, high 60
  it("waits while the price is far from the low", () => {
    const d = rangeDecision({ closes, price: 50, quantity: 0, cost: 0, cash: 50, minOrder: 40 });
    expect([d.action, d.low, d.high]).toEqual(["HOLD", 40, 60]);
    expect(d.reason).toContain("40,80");
  });
  it("buys within 2% of the low and sells within 2% of the high, never at a loss", () => {
    expect(rangeDecision({ closes, price: 40.5, quantity: 0, cost: 0, cash: 50, minOrder: 40 }).action).toBe("BUY");
    expect(rangeDecision({ closes, price: 59, quantity: 1, cost: 41.5, cash: 0, minOrder: 40 }).action).toBe("SELL");
    expect(rangeDecision({ closes, price: 59, quantity: 1, cost: 58.5, cash: 0, minOrder: 40 }).action).toBe("HOLD");
  });
});
