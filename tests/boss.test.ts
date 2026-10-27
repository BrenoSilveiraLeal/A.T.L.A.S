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
    expect(d.reason).toContain("42,00");
  });
  it("sells within 2% of the high, never at a loss", () => {
    expect(rangeDecision({ closes, price: 59, quantity: 1, cost: 41.5, cash: 0, minOrder: 40 }).action).toBe("SELL");
    expect(rangeDecision({ closes, price: 59, quantity: 1, cost: 58.5, cash: 0, minOrder: 40 }).action).toBe("HOLD");
  });
});

describe("buys only after the fall turns into a rise (owner, 26/10/2026)", () => {
  const falling = [...flat(60, 50), ...flat(62, 60), 45, 43, 41, 40]; // low 40 (yesterday), high 60
  const at = (price: number, quantity = 0, cost = 0) => rangeDecision({ closes: falling, price, quantity, cost, cash: 100, minOrder: 40 });
  it("waits while it is still falling, and until it has risen 1% off the bottom", () => {
    expect([at(39.5).action, at(39.5).reason]).toEqual(["HOLD", expect.stringContaining("ainda caindo")]);
    expect([at(40.2).action, at(40.2).reason]).toEqual(["HOLD", expect.stringContaining("ainda não virou")]);
  });
  it("buys once it turned up and is still within 5% of the low", () => {
    expect([at(40.6).action, at(40.6).reason]).toEqual(["BUY", expect.stringContaining("virou para cima")]);
    expect(at(42.5).action).toBe("HOLD"); // already 6% above the low
  });
  it("holding already, buys more only after a new dip below the average price", () => {
    expect([at(40.6, 1, 41).action, at(40.6, 1, 41).reason]).toEqual(["HOLD", expect.stringContaining("compra mais só se cair")]);
    expect(at(40.6, 1, 43).action).toBe("BUY");
  });
});

describe("the turn matters only after a big fall (owner, 26/10/2026)", () => {
  // Normal ups and downs near the low: 52 → 49 is only a 6% dip, below the 8% big-fall mark.
  const calm = [...flat(60, 50), ...flat(54, 52), 51, 50, 49.5, 49];
  const at = (price: number) => rangeDecision({ closes: calm, price, quantity: 0, cost: 0, cash: 100, minOrder: 40 });
  it("in normal ups and downs it buys only right at the low, without waiting for a turn", () => {
    expect(at(49.5).action).toBe("BUY"); // low 49, within 2%
    expect(at(48.9).action).toBe("BUY"); // still falling a little, but it was no big fall
    expect([at(50.5).action, at(50.5).reason]).toEqual(["HOLD", expect.stringContaining("oscilação normal")]);
  });
  it("after a big fall it waits for the turn", () => {
    const crash = [...flat(60, 50), ...flat(54, 60), 52, 47, 44, 43];
    const d = (price: number) => rangeDecision({ closes: crash, price, quantity: 0, cost: 0, cash: 100, minOrder: 40 });
    expect([d(42.5).action, d(42.5).reason]).toEqual(["HOLD", expect.stringContaining("ainda caindo")]);
    expect(d(43.6).action).toBe("BUY");
  });
});

describe("the boss compares the six stocks", () => {
  it("gives the whole pot to the only stock in its buy zone, so it can buy several shares", () => {
    expect(allocatePot(100, [{ agentId: "joao", price: 30, fee: 0.99, score: 0.02 }])).toEqual({ joao: 100 });
  });
  it("splits 50/30/20 among the three best, at least one share each, while money lasts", () => {
    const a = allocatePot(100, [{ agentId: "ana", price: 49, fee: 0.99, score: 0.3 }, { agentId: "joao", price: 62, fee: 0.99, score: 0.01 }]);
    expect(a.joao).toBeCloseTo(63.61, 2);
    expect(a.ana).toBe(0); // R$ 36,39 left does not pay one ITUB4
    const b = allocatePot(300, [{ agentId: "ana", price: 49, fee: 0.99, score: 0.3 }, { agentId: "joao", price: 62, fee: 0.99, score: 0.01 }]);
    expect([b.joao, b.ana]).toEqual([187.5, 112.5]); // two candidates: 50/30 → 62.5% and the rest
    const c = allocatePot(500, [{ agentId: "a", price: 10, fee: 0.99, score: 0.1 }, { agentId: "b", price: 10, fee: 0.99, score: 0.2 },
      { agentId: "c", price: 10, fee: 0.99, score: 0.3 }, { agentId: "d", price: 10, fee: 0.99, score: 0.4 }]);
    expect([c.a, c.b, c.c, c.d]).toEqual([250, 150, 100, 0]);
    // The best costs more than the pot: the money goes to the next one.
    const d = allocatePot(100, [{ agentId: "x", price: 120, fee: 0.99, score: 0 }, { agentId: "y", price: 20, fee: 0.99, score: 0.1 }]);
    expect([d.x, d.y]).toEqual([0, 100]);
  });
  it("ranks closeness to the 6-month low and penalises a company flagged Atenção", () => {
    expect(opportunityScore(41, 40, 60, false)).toBeCloseTo(0.05);
    expect(opportunityScore(41, 40, 60, true)).toBeCloseTo(0.2);
  });
});

describe("only really cheap, and only at the top", () => {
  const closes = [...flat(60, 50), ...flat(30, 40), ...flat(35, 60), 58]; // low 40, high 60, last close 58
  it("does not buy near the low when past visits to the low were not followed by rises (Vale today)", () => {
    const vale = { samples: 6, upShare: 0.33, average: -0.01 };
    const turned = [...flat(60, 50), ...flat(62, 60), 45, 43, 41, 40];
    const d = rangeDecision({ closes: turned, price: 40.6, quantity: 0, cost: 0, cash: 100, minOrder: 40, history: vale });
    expect([d.action, d.reason]).toEqual(["HOLD", expect.stringContaining("não vale a pena")]);
    expect(rangeDecision({ closes: turned, price: 40.6, quantity: 0, cost: 0, cash: 100, minOrder: 40, history: { samples: 4, upShare: 0.75, average: 0.03 } }).action).toBe("BUY");
  });
  it("holds near the high while the price is still rising, sells when the rise stops", () => {
    expect(rangeDecision({ closes, price: 59.5, quantity: 1, cost: 41.5, cash: 0, minOrder: 40 }).action).toBe("HOLD"); // 59,50 > 58
    expect(rangeDecision({ closes: [...closes, 59.8], price: 59, quantity: 1, cost: 41.5, cash: 0, minOrder: 40 }).action).toBe("SELL");
  });
});

describe("no money for a stock that collapsed (owner, 27/10/2026)", () => {
  it("flags a fall of 60% or more from the top of the stored history", async () => {
    const { collapse } = await import("@/core/range");
    expect(collapse([30, 32, 28, 20, 14], 12)).toBeCloseTo(0.625);
    expect(collapse([30, 32, 28, 20, 14], 15)).toBeNull(); // −53%: a big fall, not a collapse
    expect(collapse([], 10)).toBeNull();
  });
});
