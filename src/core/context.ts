/**
 * Free, rule-based market context ("analista de contexto"). It can only brake the
 * price strategy: block new buys, halve their size or ask to exit a position. It never
 * starts a buy. Every reason keeps its public source so the owner can audit it.
 * Sources: CVM material facts (weekly open data), GDELT headlines, BCB dollar (PTAX).
 */
export const CONTEXT_VERSION = "context-rules/1.0.0";

export interface CompanyProfile {
  name: string;
  cvmCode: string | null;
  /** GDELT DOC query. */
  query: string;
  /** Lower-case, accent-free phrases that identify the company in a headline. */
  aliases: string[];
}

// CVM codes verified in the 2026 IPE dataset (padded to 6 digits like the CVM provider).
export const COMPANIES: Record<string, CompanyProfile> = {
  PETR4: { name: "Petrobras", cvmCode: "009512", query: "petrobras", aliases: ["petrobras", "petr4"] },
  VALE3: { name: "Vale", cvmCode: "004170", query: '("mineradora vale" OR vale3 OR "vale s.a.")', aliases: ["mineradora vale", "vale3", "vale s.a", "vale sa"] },
  ITUB4: { name: "Itaú Unibanco", cvmCode: "019348", query: '(itau OR "itau unibanco" OR itub4)', aliases: ["itau", "itub4"] },
  MGLU3: { name: "Magazine Luiza", cvmCode: "022470", query: '("magazine luiza" OR magalu OR mglu3)', aliases: ["magazine luiza", "magalu", "mglu3"] },
  BBAS3: { name: "Banco do Brasil", cvmCode: "001023", query: '("banco do brasil" OR bbas3)', aliases: ["banco do brasil", "bbas3"] },
};
export const MARKET_QUERY = '(ibovespa OR "bolsa brasileira" OR "mercado brasileiro")';

export function companyProfile(ticker: string): CompanyProfile {
  return COMPANIES[ticker] ?? { name: ticker, cvmCode: null, query: ticker, aliases: [ticker.toLowerCase()] };
}

export interface MaterialFact { cvmCode: string; deliveredOn: string; subject: string; url: string }
export interface ContextHeadline { title: string; url: string; seenAt: string; source?: string }
const quoted = (h: ContextHeadline) => `"${h.title}"${h.source ? ` (${h.source})` : ""}`;
export interface DollarPoint { observationDate: string; value: string }

export type ContextAction = "ALLOW" | "REDUCE" | "BLOCK_BUY" | "EXIT";
export interface ContextReason { code: string; text: string; source: string | null }
export interface ContextAssessment {
  version: typeof CONTEXT_VERSION;
  action: ContextAction;
  riskScore: number;
  reasons: ContextReason[];
  unavailable: string[];
  assessedAt: string;
}

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const words = (list: string[]) => new RegExp(`\\b(${list.map(normalize).join("|")})\\b`, "g");

const SEVERE_FACT = words(["recuperacao judicial", "falencia", "fraude", "investigacao", "inadimplemento",
  "vencimento antecipado", "acidente", "rompimento", "operacao da policia federal"]);
const NEGATIVE = words(["queda", "cai", "caem", "despenca", "desaba", "recua", "tomba", "prejuizo", "perda", "multa",
  "processo", "investigacao", "greve", "acidente", "vazamento", "rebaixa", "rebaixamento", "demissao", "crise", "fraude",
  "escandalo", "interferencia", "falls", "drops", "plunges", "slumps", "loss", "fine", "lawsuit", "probe", "strike",
  "downgrade", "crisis", "scandal"]);
const POSITIVE = words(["alta", "sobe", "sobem", "dispara", "salta", "recorde", "lucro", "dividendo", "dividendos",
  "recompra", "eleva", "upgrade", "aprova", "rises", "gains", "jumps", "soars", "record", "profit", "dividend", "buyback"]);
const SEVERE_NEWS = words(["fraude", "falencia", "recuperacao judicial", "policia federal", "explosao", "vazamento de oleo",
  "rompimento", "desastre", "tragedia", "fraud", "bankruptcy", "explosion", "oil spill", "dam collapse"]);
const MARKET_STRESS = words(["despenca", "derrete", "panico", "crash", "guerra", "invasao", "ataque", "terremoto",
  "tsunami", "catastrofe", "tragedia", "golpe", "impeachment", "war", "invasion", "attack", "earthquake", "panic",
  "meltdown", "coup"]);
const CIRCUIT_BREAKER = /\bcircuit breaker\b/;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const ORDER: ContextAction[] = ["ALLOW", "REDUCE", "BLOCK_BUY", "EXIT"];

export function assessContext(input: {
  ticker: string;
  now: string;
  facts: MaterialFact[] | null;
  companyHeadlines: ContextHeadline[] | null;
  marketHeadlines: ContextHeadline[] | null;
  dollar: DollarPoint[] | null;
}): ContextAssessment {
  const company = companyProfile(input.ticker);
  const reasons: ContextReason[] = [];
  const unavailable: string[] = [];
  let action: ContextAction = "ALLOW";
  let risk = 0;
  const raise = (next: ContextAction, points: number, reason: ContextReason) => {
    if (ORDER.indexOf(next) > ORDER.indexOf(action)) action = next;
    risk += points;
    reasons.push(reason);
  };

  // 1. Material facts (CVM): a recent filing pauses buys; a grave subject asks to exit.
  if (input.facts === null || company.cvmCode === null) unavailable.push("CVM_FACTS");
  else {
    const since = new Date(Date.parse(input.now) - 3 * 86400000).toISOString().slice(0, 10);
    for (const fact of input.facts.filter((f) => f.cvmCode === company.cvmCode && f.deliveredOn >= since)) {
      const severe = count(normalize(fact.subject), SEVERE_FACT) > 0;
      raise(severe ? "EXIT" : "BLOCK_BUY", severe ? 50 : 25, { code: severe ? "SEVERE_MATERIAL_FACT" : "RECENT_MATERIAL_FACT",
        text: `Fato relevante de ${company.name} em ${fact.deliveredOn}: ${fact.subject}`, source: fact.url });
    }
  }

  // 2. Company headlines (GDELT, last 24h): mostly negative or grave coverage pauses buys.
  if (input.companyHeadlines === null) unavailable.push("COMPANY_NEWS");
  else {
    const about = input.companyHeadlines.filter((h) => company.aliases.some((a) => normalize(h.title).includes(a)));
    const text = about.map((h) => normalize(h.title));
    const negative = text.reduce((n, t) => n + count(t, NEGATIVE), 0);
    const positive = text.reduce((n, t) => n + count(t, POSITIVE), 0);
    const severe = about.filter((h) => count(normalize(h.title), SEVERE_NEWS) > 0);
    if (severe.length >= 2)
      raise("BLOCK_BUY", 30, { code: "SEVERE_COMPANY_NEWS", text: `${severe.length} manchetes graves sobre ${company.name}: ${quoted(severe[0])}`, source: severe[0].url });
    else if (negative >= 3 && negative >= 2 * Math.max(positive, 1)) {
      const first = about.find((h) => count(normalize(h.title), NEGATIVE) > 0)!;
      raise("BLOCK_BUY", 20, { code: "NEGATIVE_COMPANY_NEWS", text: `Cobertura negativa sobre ${company.name} (${negative} termos negativos x ${positive} positivos): ${quoted(first)}`, source: first.url });
    }
  }

  // 3. Brazilian market mood (GDELT): conflicts, disasters and crashes show up here.
  if (input.marketHeadlines === null) unavailable.push("MARKET_NEWS");
  else {
    const breaker = input.marketHeadlines.find((h) => CIRCUIT_BREAKER.test(normalize(h.title)));
    const stressed = input.marketHeadlines.filter((h) => count(normalize(h.title), MARKET_STRESS) > 0);
    if (breaker) raise("BLOCK_BUY", 40, { code: "CIRCUIT_BREAKER", text: `Circuit breaker na bolsa: ${quoted(breaker)}`, source: breaker.url });
    else if (stressed.length >= 2)
      raise("REDUCE", 20, { code: "MARKET_STRESS", text: `${stressed.length} manchetes de estresse no mercado: ${quoted(stressed[0])}`, source: stressed[0].url });
  }

  // 4. Dollar shock (BCB PTAX): a ≥2% daily move halves new buys.
  if (input.dollar === null || input.dollar.length < 2) unavailable.push("DOLLAR");
  else {
    const [previous, last] = [...input.dollar].sort((a, b) => a.observationDate.localeCompare(b.observationDate)).slice(-2);
    const change = (Number(last.value) / Number(previous.value) - 1) * 100;
    if (Number.isFinite(change) && Math.abs(change) >= 2)
      raise("REDUCE", 15, { code: "DOLLAR_SHOCK", text: `Dólar ${change > 0 ? "subiu" : "caiu"} ${Math.abs(change).toFixed(1)}% em ${last.observationDate} (PTAX ${last.value}).`, source: "https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes" });
  }

  return { version: CONTEXT_VERSION, action, riskScore: Math.min(100, risk), reasons, unavailable, assessedAt: input.now };
}
