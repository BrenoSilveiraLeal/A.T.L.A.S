import { describe, expect, it } from "vitest";
import { allocatePot, bossGrant, opportunityScore } from "@/core/boss";
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

describe("the boss compares the six stocks", () => {
  it("gives the whole pot to the only stock in its buy zone, so it can buy several shares", () => {
    expect(allocatePot(100, [{ agentId: "joao", price: 30, fee: 0.99, score: 0.02 }])).toEqual({ joao: 100 });
  });
  it("serves the best opportunity first, at least one share each, while money lasts", () => {
    const a = allocatePot(100, [{ agentId: "ana", price: 49, fee: 0.99, score: 0.3 }, { agentId: "joao", price: 62, fee: 0.99, score: 0.01 }]);
    expect(a.joao).toBeCloseTo(63.61, 2);
    expect(a.ana).toBe(0); // R$ 36,39 left does not pay one ITUB4
    const b = allocatePot(300, [{ agentId: "ana", price: 49, fee: 0.99, score: 0.3 }, { agentId: "joao", price: 62, fee: 0.99, score: 0.01 }]);
    expect([b.joao, b.ana]).toEqual([150, 150]);
  });
  it("ranks closeness to the 6-month low and penalises a company flagged Atenção", () => {
    expect(opportunityScore(41, 40, 60, false)).toBeCloseTo(0.05);
    expect(opportunityScore(41, 40, 60, true)).toBeCloseTo(0.2);
  });
});
