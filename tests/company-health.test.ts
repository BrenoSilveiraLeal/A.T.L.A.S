import { describe, expect, it } from "vitest";
import { assessCompanyHealth } from "@/core/company-health";

const year = (y: number, netIncome: number | null, equity: number | null, netDebt: number | null = null, revenue: number | null = 100e9) =>
  ({ year: y, revenue, netIncome, equity, netDebt });

describe("company health before buying", () => {
  it("passes a profitable company with debt under control (Petrobras 2025 figures)", () => {
    const h = assessCompanyHealth("PETROLEO BRASILEIRO S.A. PETROBRAS", [year(2024, 37e9, 367e9, 353e9), year(2025, 110.6e9, 417.6e9, 348e9)]);
    expect(h.level).toBe("SAUDAVEL");
    expect(h.reasons[0]).toContain("Lucro");
  });

  it("blocks court protection, negative equity, two years of losses and extreme debt", () => {
    expect(assessCompanyHealth("AMERICANAS S.A. - EM RECUPERAÇÃO JUDICIAL", [year(2025, 1e9, 5e9)]).level).toBe("PERIGO");
    expect(assessCompanyHealth("X S.A.", [year(2025, 1e9, -2e9)]).reasons[0]).toContain("Patrimônio negativo");
    expect(assessCompanyHealth("X S.A.", [year(2024, -1e9, 10e9), year(2025, -2e9, 8e9)]).level).toBe("PERIGO");
    expect(assessCompanyHealth("X S.A.", [year(2025, 1e9, 10e9, 45e9)]).level).toBe("PERIGO");
  });

  it("warns without blocking on one loss, a halved profit or a revenue drop", () => {
    expect(assessCompanyHealth("X S.A.", [year(2024, 2e9, 10e9), year(2025, -1e9, 9e9)]).level).toBe("ATENCAO");
    const vale = assessCompanyHealth("VALE S.A.", [year(2024, 30.4e9, 213.7e9, 65e9), year(2025, 11.8e9, 188.9e9, 63e9)]);
    expect([vale.level, vale.reasons[0]]).toEqual(["ATENCAO", expect.stringContaining("Lucro caiu")]);
    expect(assessCompanyHealth("X S.A.", [year(2024, 1e9, 10e9, null, 100e9), year(2025, 1e9, 10e9, null, 60e9)]).reasons[0]).toContain("Receita caiu 40%");
    expect(assessCompanyHealth("BANCO", []).level).toBe("SEM_DADOS");
  });
});
