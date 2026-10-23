import { describe, expect, it } from "vitest";
import { planContribution, saoPauloMonth, type ContributionAgent } from "@/core/contribution";

const agent = (name: string, patch: Partial<ContributionAgent> = {}): ContributionAgent =>
  ({ id: name, name, ticker: `${name.toUpperCase().slice(0, 4)}3`, alive: true, pnl: null, budget: 2500, sells: 0, trendUp: true, context: "ALLOW", ...patch });

describe("monthly contribution (R$ 200)", () => {
  it("splits equally among agents without history, in whole reais", () => {
    const plan = planContribution(200, [agent("Maria"), agent("João"), agent("Ana")]);
    expect(plan.rows.map((r) => r.amount)).toEqual([66, 66, 66]);
    expect(plan.reserve).toBe(2);
  });

  it("keeps a falling or news-blocked stock's share in the reserve", () => {
    const plan = planContribution(200, [agent("Maria"), agent("João", { trendUp: false }), agent("Ana", { context: "BLOCK_BUY" }), agent("Pedro", { alive: false })]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ name: "Maria", amount: 66 });
    expect(plan.reserve).toBe(134);
    expect(plan.reserveReason).toContain("João");
    expect(plan.reserveReason).toContain("Ana");
  });

  it("gives more to measured winners and half under caution", () => {
    const plan = planContribution(200, [agent("Win", { sells: 5, pnl: 500 }), agent("Lose", { sells: 5, pnl: -500 }), agent("Care", { context: "REDUCE" })]);
    const [win, lose, care] = plan.rows;
    expect(win.amount).toBeGreaterThan(care.amount);
    expect(lose.amount).toBeLessThan(win.amount);
    expect(plan.rows.reduce((s, r) => s + r.amount, 0) + plan.reserve).toBe(200);
  });

  it("puts everything in reserve when nothing is worth buying, and uses São Paulo dates", () => {
    expect(planContribution(200, [agent("A", { trendUp: false })]).reserve).toBe(200);
    expect(saoPauloMonth(new Date("2026-11-01T02:00:00Z"))).toEqual({ month: "2026-10", day: 31 });
  });
});
