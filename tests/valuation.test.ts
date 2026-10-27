import { describe, expect, it } from "vitest";
import { brNumber, focusTrend, focusView, parseFundamentus, valuationView } from "@/core/valuation";
import { analysts } from "@/core/committee";

// The real layout of fundamentus.com.br/resultado.php (27/10/2026), two rows.
const HEAD = ["Papel", "Cotação", "P/L", "P/VP", "PSR", "Div.Yield", "P/Ativo", "P/Cap.Giro", "P/EBIT", "P/Ativ Circ.Liq", "EV/EBIT", "EV/EBITDA",
  "Mrg Bruta", "Mrg Ebit", "Mrg. Líq.", "Liq. Corr.", "ROIC", "ROE", "Liq.2meses", "Patrim. Líq", "Dív.Líq/ Patrim.", "Cresc. Rec.5a"];
const row = (cells: string[]) => `<tr><td><span class="tips"><a href="detalhes.php?papel=${cells[0]}">${cells[0]}</a></span></td>${cells.slice(1).map((c) => `<td>${c}</td>`).join("")}</tr>`;
const HTML = `<table><thead><tr>${HEAD.map((h) => `<th><a href="#">${h}</a></th>`).join("")}</tr></thead><tbody>
${row(["EQTL3", "34,84", "45,78", "1,68", "0,812", "4,53%", "0,369", "4,59", "4,54", "-0,69", "10,15", "7,76", "25,57%", "17,86%", "3,27%", "1,57", "9,18%", "3,67%", "601.534.000,00", "26.126.700.000,00", "2,07", "18,46%"])}
${row(["PETR4", "52,79", "5,21", "1,44", "1,0", "6,76%", "0,5", "1", "1", "1", "1", "1", "50%", "30%", "20%", "1,2", "15%", "27,73%", "1.000.000,00", "1.000.000,00", "0,65", "10%"])}
</tbody></table>`;

describe("valuation from Fundamentus (same source as the fundamentus Python library)", () => {
  it("reads Brazilian numbers", () => {
    expect(brNumber("1.234,56")).toBe(1234.56);
    expect(brNumber("4,53%")).toBe(4.53);
    expect(brNumber("-0,69")).toBe(-0.69);
    expect(brNumber("")).toBeNull();
  });

  it("parses the results table", () => {
    const v = parseFundamentus(HTML, 2);
    expect(v.EQTL3).toEqual({ pl: 45.78, pvp: 1.68, dy: expect.closeTo(0.0453), roe: expect.closeTo(0.0367), debt: 2.07 });
    expect(v.PETR4.pl).toBe(5.21);
    expect(() => parseFundamentus("<table><tr><th>Outra</th></tr></table>")).toThrow("FUNDAMENTUS_LAYOUT_CHANGED");
  });

  it("cheap with good returns and dividends is a reason to rise; a loss, a high P/L or heavy debt a worry", () => {
    const v = parseFundamentus(HTML, 2);
    expect(valuationView(v.PETR4).ups).toHaveLength(2);
    expect(valuationView(v.EQTL3).worries).toEqual(["cara pelo lucro atual (preço/lucro 45,8)"]);
    expect(valuationView({ pl: -3, pvp: 1, dy: 0, roe: -0.1, debt: 4 }).worries).toHaveLength(2);
  });
});

describe("economists' outlook from the Boletim Focus (same source as python-bcb)", () => {
  const days = (start: string, n: number, value: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ Data: new Date(Date.parse(start) - i * 86400000).toISOString().slice(0, 10), Mediana: value(i) }));

  it("compares the latest median with four weeks before", () => {
    const t = focusTrend(days("2026-10-23", 40, (i) => (i < 10 ? 12.5 : 11.75)), days("2026-10-23", 40, () => 4.3), "2027");
    expect(t).toMatchObject({ asOf: "2026-10-23", selic: 12.5, selicBefore: 11.75, year: "2027" });
    expect(focusView(t).risk).toContain("juros mais altos no fim de 2027 (Selic 11,8% → 12,5%)");
    const falling = focusTrend(days("2026-10-23", 40, (i) => (i < 10 ? 11 : 12)), [], "2027");
    expect(focusView(falling).up).toContain("juros caindo");
    expect(focusView(focusTrend(days("2026-10-23", 40, () => 12), [], "2027"))).toEqual({ up: null, risk: null });
  });

  it("counts in the council like any moderate reason or risk", () => {
    const base = { context: { action: "ALLOW" as const, summary: "" }, health: null, price: 40 };
    const v = parseFundamentus(HTML, 2);
    expect(analysts({ ...base, valuation: v.PETR4 }).optimist.vote).toBe("A_FAVOR");
    const pricey = analysts({ ...base, valuation: v.EQTL3 });
    expect([pricey.pessimist.vote, pricey.consensus.fraction]).toEqual(["NEUTRO", 0.5]);
    const rates = analysts({ ...base, macro: { asOf: "2026-10-23", year: "2027", selic: 12.5, selicBefore: 11.75, ipca: 4.3, ipcaBefore: 4.3 } });
    expect(rates.world.text).toContain("Boletim Focus");
  });
});
