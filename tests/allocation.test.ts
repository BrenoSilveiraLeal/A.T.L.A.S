import { describe, expect, it } from "vitest";
import { suggestAllocation } from "@/core/allocation";

const agent = (id: string, ticker: string, pnl: number | null, sells: number, dead = false) =>
  ({ id, name: id, ticker, budget: 10000, pnl, sells, dead });

describe("IA gestora", () => {
  it("moves budget toward measured winners and frees eliminated budgets", () => {
    const result = suggestAllocation([agent("Maria", "PETR4", 2000, 4), agent("João", "VALE3", -1000, 5), agent("Ana", "ITUB4", null, 0), agent("Zé", "MGLU3", -3000, 6, true)]);
    expect(result.pool).toBe(40000);
    const [maria, joao, ana] = result.rows;
    expect(maria.suggested).toBeGreaterThan(ana.suggested);
    expect(ana.suggested).toBeGreaterThan(joao.suggested);
    expect(result.rows.reduce((s, r) => s + r.suggested, 0)).toBeLessThanOrEqual(40000);
    expect(result.vacancies).toEqual(["MGLU3"]);
    expect(result.measured).toBe(true);
  });

  it("keeps equal weights until agents have enough closed sales", () => {
    const result = suggestAllocation([agent("A", "PETR4", 5000, 1), agent("B", "VALE3", -5000, 2)]);
    expect(result.rows.map((r) => r.suggested)).toEqual([10000, 10000]);
    expect(result.measured).toBe(false);
  });
});
