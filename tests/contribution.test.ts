import { describe, expect, it } from "vitest";
import { planContribution, saoPauloMonth, type ContributionAgent } from "@/core/contribution";

const agent = (name: string, patch: Partial<ContributionAgent> = {}): ContributionAgent =>
  ({ id: name, name, ticker: `${name.toUpperCase().slice(0, 4)}3`, alive: true, pnl: null, budget: 2500, sells: 0, trendUp: true, context: "ALLOW", ...patch });

describe("monthly contribution (R$ 200) with Genial brokerage", () => {
  it("concentrates R$ 200 in at most two agents so each order is about R$ 100", () => {
    const plan = planContribution(200, [agent("Maria"), agent("João", { budget: 2000 }), agent("Ana")]);
    expect(plan.rows.map((r) => [r.name, r.amount])).toEqual([["João", 100], ["Maria", 100]]);
    expect(plan.waiting.map((w) => w.name)).toEqual(["Ana"]);
    expect(plan.reserve).toBe(0);
  });

  it("gives everything to the only stock worth buying and explains who was skipped", () => {
    const plan = planContribution(200, [agent("Maria"), agent("João", { trendUp: false }), agent("Ana", { context: "BLOCK_BUY" }), agent("Pedro", { alive: false })]);
    expect(plan.rows).toEqual([expect.objectContaining({ name: "Maria", amount: 200 })]);
    expect(plan.skipped.map((s) => s.name)).toEqual(["João", "Ana"]);
  });

  it("weights measured winners above losers", () => {
    const plan = planContribution(200, [agent("Win", { sells: 5, pnl: 500 }), agent("Lose", { sells: 5, pnl: -500 }), agent("Care", { context: "REDUCE" })]);
    expect(plan.rows.map((r) => [r.name, r.amount])).toEqual([["Win", 140], ["Lose", 60]]);
    expect(plan.waiting.map((w) => w.name)).toEqual(["Care"]);
  });

  it("keeps the money in reserve when nothing is worth buying or the amount is too small", () => {
    expect(planContribution(200, [agent("A", { trendUp: false })]).reserve).toBe(200);
    const tiny = planContribution(50, [agent("A")]);
    expect([tiny.rows.length, tiny.reserve]).toEqual([0, 50]);
    expect(tiny.reserveReason).toContain("corretagem");
    expect(saoPauloMonth(new Date("2026-11-01T02:00:00Z"))).toEqual({ month: "2026-10", day: 31 });
  });
});
