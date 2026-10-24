import { describe, expect, it } from "vitest";
import { planContribution, saoPauloMonth, type ContributionAgent } from "@/core/contribution";

const agent = (name: string, patch: Partial<ContributionAgent> = {}): ContributionAgent =>
  ({ id: name, name, ticker: `${name.toUpperCase().slice(0, 4)}3`, alive: true, active: true, ...patch });
const team = ["Maria", "João", "Ana", "Rafa", "Davi", "Sofia"].map((n) => agent(n));

describe("monthly contribution (R$ 200): every active agent gets an equal share", () => {
  it("splits R$ 200 over six agents in whole reais and keeps the rounding in reserve", () => {
    const plan = planContribution(200, team);
    expect(plan.rows.map((r) => r.amount)).toEqual([33, 33, 33, 33, 33, 33]);
    expect(plan.reserve).toBe(2);
    expect(plan.rows[0].reason).toContain("R$ 100");
  });

  it("leaves out retired and eliminated agents", () => {
    const plan = planContribution(200, [agent("Maria"), agent("Lucas", { active: false }), agent("Pedro", { alive: false })]);
    expect(plan.rows).toEqual([expect.objectContaining({ name: "Maria", amount: 200 })]);
    expect(plan.skipped.map((s) => s.name)).toEqual(["Lucas"]);
  });

  it("keeps everything in reserve without an active team", () => {
    const plan = planContribution(200, [agent("A", { active: false })]);
    expect([plan.rows.length, plan.reserve]).toEqual([0, 200]);
    expect(saoPauloMonth(new Date("2026-11-01T02:00:00Z"))).toEqual({ month: "2026-10", day: 31 });
  });
});
