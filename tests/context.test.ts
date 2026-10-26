import { describe, expect, it } from "vitest";
import { assessContext, companyProfile, resolveCompany } from "@/core/context";

const now = "2026-10-22T15:00:00.000Z";
const base = { ticker: "PETR4", now, facts: [], companyHeadlines: [], marketHeadlines: [],
  dollar: [{ observationDate: "2026-10-20", value: "5.00" }, { observationDate: "2026-10-21", value: "5.02" }],
  brent: [{ date: "2026-10-20", value: "100.00" }, { date: "2026-10-21", value: "100.50" }] };
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
  it("recognises new companies by unambiguous official name only", () => {
    const directory = [{ cvmCode: "000906", name: "BANCO BRADESCO S.A." }, { cvmCode: "019640", name: "BRADESCO LEASING S.A. - ARRENDAMENTO MERCANTIL" },
      { cvmCode: "005410", name: "WEG SA" }, { cvmCode: "008133", name: "LOJAS RENNER SA" }];
    expect(resolveCompany("LOJA3", "Lojas Renner", directory)).toMatchObject({ cvmCode: "008133", aliases: ["loja3", "lojas renner"] });
    expect(resolveCompany("WEGE3", "WEG", directory)).toMatchObject({ cvmCode: "005410", aliases: ["wege3"] });
    expect(resolveCompany("BRAD4", "Bradesco", directory).cvmCode).toBeNull();
    expect(resolveCompany("BRAD4", "Banco Bradesco", directory).cvmCode).toBe("000906");
    expect(resolveCompany("PETR4", "qualquer", null).cvmCode).toBe("009512");
    const unknown = assessContext({ ...base, ticker: "LOJA3", company: resolveCompany("LOJA3", "Lojas Renner", directory),
      facts: [{ cvmCode: "008133", deliveredOn: "2026-10-22", subject: "Aquisição", url: "https://www.rad.cvm.gov.br/z" }] });
    expect(unknown).toMatchObject({ action: "BLOCK_BUY", company: { name: "Lojas Renner", cvmCode: "008133" } });
  });
  it("brakes oil companies on sharp Brent falls and shows the reading", () => {
    const brent = (values: number[]) => values.map((v, i) => ({ date: `2026-10-${String(10 + i).padStart(2, "0")}`, value: v.toFixed(2) }));
    const calm = assessContext({ ...base, brent: brent([100, 101, 100, 102, 101, 100.5]) });
    expect(calm).toMatchObject({ action: "ALLOW", commodity: { value: "100.50", date: "2026-10-15" } });
    expect(assessContext({ ...base, brent: brent([100, 101, 100, 102, 101, 95]) }).reasons[0].code).toBe("OIL_DROP");
    expect(assessContext({ ...base, brent: brent([126, 126, 126, 119, 118, 112]) })).toMatchObject({ action: "BLOCK_BUY" });
    expect(assessContext({ ...base, brent: null }).unavailable).toContain("BRENT");
    expect(assessContext({ ...base, ticker: "ITUB4", brent: null })).toMatchObject({ commodity: null, unavailable: [] });
  });
});

