import { describe, expect, it } from "vitest";
import { assessContext, companyProfile } from "@/core/context";

const now = "2026-10-22T15:00:00.000Z";
const base = { ticker: "PETR4", now, facts: [], companyHeadlines: [], marketHeadlines: [],
  dollar: [{ observationDate: "2026-10-20", value: "5.00" }, { observationDate: "2026-10-21", value: "5.02" }] };
const h = (title: string) => ({ title, url: `https://example.test/${encodeURIComponent(title)}`, seenAt: now });

describe("rule-based market context", () => {
  it("allows when nothing notable happened and lists no gaps", () => {
    expect(assessContext(base)).toMatchObject({ action: "ALLOW", riskScore: 0, reasons: [], unavailable: [] });
  });

  it("pauses buys after a recent material fact and asks to exit on a grave one", () => {
    const fact = (subject: string, deliveredOn = "2026-10-21") => ({ cvmCode: "009512", deliveredOn, subject, url: "https://www.rad.cvm.gov.br/x" });
    const recent = assessContext({ ...base, facts: [fact("Aprovação de dividendos intercalares")] });
    expect(recent.action).toBe("BLOCK_BUY");
    expect(recent.reasons[0]).toMatchObject({ code: "RECENT_MATERIAL_FACT", source: "https://www.rad.cvm.gov.br/x" });
    expect(assessContext({ ...base, facts: [fact("Pedido de Recuperação Judicial")] }).action).toBe("EXIT");
    expect(assessContext({ ...base, facts: [fact("Dividendos", "2026-10-10")] }).action).toBe("ALLOW");
    expect(assessContext({ ...base, facts: [{ ...fact("Fraude"), cvmCode: "004170" }] }).action).toBe("ALLOW");
  });

  it("reads company headlines, ignoring ones that do not mention the company", () => {
    const negative = [h("Petrobras cai após multa"), h("Ações da Petrobras despencam"), h("Petrobras: greve e queda na produção")];
    expect(assessContext({ ...base, companyHeadlines: negative }).action).toBe("BLOCK_BUY");
    const balanced = [...negative, h("Petrobras lucro recorde"), h("Petrobras sobe com dividendo")];
    expect(assessContext({ ...base, companyHeadlines: balanced }).action).toBe("ALLOW");
    expect(assessContext({ ...base, companyHeadlines: [h("Bolsa cai"), h("Dólar despenca"), h("Multa no trânsito")] }).action).toBe("ALLOW");
    const grave = [h("Explosão em plataforma da Petrobras"), h("Petrobras confirma vazamento de óleo")];
    expect(assessContext({ ...base, companyHeadlines: grave }).reasons[0].code).toBe("SEVERE_COMPANY_NEWS");
  });

  it("does not confuse the word 'vale' with the company Vale", () => {
    const vale = { ...base, ticker: "VALE3" };
    expect(assessContext({ ...vale, companyHeadlines: [h("Vale a pena? Ação cai"), h("Vale cai"), h("Não vale a queda")] }).action).toBe("ALLOW");
    expect(assessContext({ ...vale, companyHeadlines: [h("Mineradora Vale cai"), h("VALE3 despenca"), h("Mineradora Vale tem multa")] }).action).toBe("BLOCK_BUY");
  });

  it("reduces size on market stress and blocks buys on a circuit breaker", () => {
    const stress = [h("Ibovespa despenca com guerra no Oriente Médio"), h("Pânico: bolsa brasileira derrete")];
    expect(assessContext({ ...base, marketHeadlines: stress }).action).toBe("REDUCE");
    expect(assessContext({ ...base, marketHeadlines: [h("B3 aciona circuit breaker")] }).action).toBe("BLOCK_BUY");
  });

  it("reduces size on a dollar shock of 2% or more", () => {
    const shock = assessContext({ ...base, dollar: [{ observationDate: "2026-10-20", value: "5.00" }, { observationDate: "2026-10-21", value: "5.12" }] });
    expect(shock).toMatchObject({ action: "REDUCE" });
    expect(shock.reasons[0].text).toContain("subiu 2.4%");
  });

  it("keeps the most severe action, caps the score and reports missing sources", () => {
    const worst = assessContext({ ...base, facts: [{ cvmCode: "009512", deliveredOn: "2026-10-22", subject: "Investigação", url: "https://www.rad.cvm.gov.br/y" }],
      marketHeadlines: [h("circuit breaker na B3")], companyHeadlines: null, dollar: null });
    expect(worst).toMatchObject({ action: "EXIT", riskScore: 90, unavailable: ["COMPANY_NEWS", "DOLLAR"] });
    expect(companyProfile("XPTO3")).toMatchObject({ cvmCode: null, query: "XPTO3" });
    expect(assessContext({ ...base, ticker: "XPTO3" }).unavailable).toContain("CVM_FACTS");
  });
});
