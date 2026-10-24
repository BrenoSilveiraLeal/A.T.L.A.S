/**
 * "A empresa está saudável?" (owner, 24/10/2026): a cheap stock of a company going bankrupt is
 * not a bargain. From the official annual statements (CVM DFP, last two years) and the official
 * company name (the CVM adds "em recuperação judicial" to companies under court protection):
 * - PERIGO blocks new purchases: court protection or bankruptcy, negative equity (owes more
 *   than it owns), losses two years in a row, or net debt above 4× equity.
 * - ATENCAO is shown to the owner but does not block: a loss in the last year, net debt above
 *   2× equity, revenue down more than 25% or profit down more than half.
 * - SEM_DADOS never blocks (banks file a different layout; some figures may be missing).
 * Pure: the caller passes the figures, in reais.
 */
export type HealthLevel = "SAUDAVEL" | "ATENCAO" | "PERIGO" | "SEM_DADOS";
export interface YearFigures { year: number; revenue: number | null; netIncome: number | null; equity: number | null; netDebt: number | null }
export interface CompanyHealth { level: HealthLevel; reasons: string[]; company: string; years: YearFigures[] }

const LEVELS: HealthLevel[] = ["SEM_DADOS", "SAUDAVEL", "ATENCAO", "PERIGO"];
const billions = (v: number) => `R$ ${(v / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function assessCompanyHealth(company: string, figures: readonly YearFigures[]): CompanyHealth {
  const years = [...figures].sort((a, b) => b.year - a.year);
  const [last, prior] = years;
  const reasons: string[] = [];
  let level: HealthLevel = "SEM_DADOS";
  const raise = (to: HealthLevel, why: string) => { reasons.push(why); if (LEVELS.indexOf(to) > LEVELS.indexOf(level)) level = to; };
  const name = normalize(company);
  if (/recuperacao judicial|recuperacao extrajudicial|em falencia|em liquidacao/.test(name))
    raise("PERIGO", `Está em recuperação judicial ou falência (nome oficial na CVM: ${company}).`);
  if (!last) return { level, reasons: reasons.length ? reasons : ["Sem balanço anual na CVM para avaliar."], company, years };
  if (last.netIncome !== null || last.equity !== null) level = level === "SEM_DADOS" ? "SAUDAVEL" : level;
  if (last.equity !== null && last.equity < 0)
    raise("PERIGO", `Patrimônio negativo em ${last.year} (${billions(last.equity)}): deve mais do que tem.`);
  if (last.netIncome !== null && last.netIncome < 0) {
    if (prior?.netIncome != null && prior.netIncome < 0) raise("PERIGO", `Prejuízo em ${prior.year} e ${last.year}, dois anos seguidos.`);
    else raise("ATENCAO", `Prejuízo de ${billions(-last.netIncome)} em ${last.year}.`);
  } else if (last.netIncome !== null && prior?.netIncome != null && prior.netIncome > 0 && last.netIncome < prior.netIncome * 0.5)
    raise("ATENCAO", `Lucro caiu mais da metade: ${billions(prior.netIncome)} em ${prior.year} para ${billions(last.netIncome)} em ${last.year}.`);
  if (last.netDebt !== null && last.equity !== null && last.equity > 0) {
    const leverage = last.netDebt / last.equity;
    if (leverage > 4) raise("PERIGO", `Dívida líquida de ${leverage.toFixed(1)}× o patrimônio: endividamento muito alto.`);
    else if (leverage > 2) raise("ATENCAO", `Dívida líquida de ${leverage.toFixed(1)}× o patrimônio.`);
  }
  if (last.revenue !== null && prior?.revenue != null && prior.revenue > 0 && last.revenue < prior.revenue * 0.75)
    raise("ATENCAO", `Receita caiu ${Math.round((1 - last.revenue / prior.revenue) * 100)}% de ${prior.year} para ${last.year}.`);
  if (level === "SAUDAVEL") reasons.push(last.netIncome !== null
    ? `Lucro de ${billions(last.netIncome)} em ${last.year}${last.equity !== null ? `, patrimônio de ${billions(last.equity)}` : ""}${last.netDebt !== null ? ", dívida sob controle" : ""}.`
    : `Patrimônio positivo em ${last.year}.`);
  if (level === "SEM_DADOS" && !reasons.length) reasons.push("O balanço desta empresa usa um formato que o ATLAS ainda não lê.");
  return { level, reasons, company, years };
}

export const HEALTH_LABELS: Record<HealthLevel, string> = {
  SAUDAVEL: "Empresa saudável", ATENCAO: "Atenção", PERIGO: "Perigo: não compra", SEM_DADOS: "Sem dados",
};
