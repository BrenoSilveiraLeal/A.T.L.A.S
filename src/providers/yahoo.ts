import "server-only";

/**
 * Yahoo Finance public endpoints (free, no key): analysts' consensus for B3 stocks (target
 * prices, recommendation, number of analysts) and daily price history. Unofficial: the session
 * needs a cookie and a "crumb"; every failure returns null and nothing is presumed. Used once a
 * day per stock (cached by the caller).
 */
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" };
let session: { cookie: string; crumb: string; at: number } | null = null;

async function yahooSession() {
  if (session && Date.now() - session.at < 6 * 3600000) return session;
  const first = await fetch("https://fc.yahoo.com", { headers: UA, redirect: "manual", signal: AbortSignal.timeout(10000) });
  const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
  const crumb = (await (await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...UA, cookie }, signal: AbortSignal.timeout(10000) })).text()).trim();
  if (!cookie || !crumb || crumb.length > 40 || /[<{]/.test(crumb)) throw new Error("YAHOO_SESSION_UNAVAILABLE");
  session = { cookie, crumb, at: Date.now() };
  return session;
}

const symbolOf = (ticker: string) => {
  if (!/^[A-Z][A-Z0-9]{3}\d{1,2}$/.test(ticker)) throw new Error("INVALID_TICKER");
  return `${ticker}.SA`;
};
const num = (v: unknown) => (typeof v === "object" && v !== null && typeof (v as { raw?: unknown }).raw === "number" ? (v as { raw: number }).raw : null);

export interface Consensus {
  ticker: string; price: number | null; targetMean: number | null; targetLow: number | null; targetHigh: number | null;
  recommendation: string | null; analysts: number | null;
  votes: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  profitMargin: number | null; debtToEquity: number | null; earningsGrowth: number | null; returnOnEquity: number | null;
  retrievedAt: string; source: string;
}

export async function fetchConsensus(ticker: string): Promise<Consensus | null> {
  try {
    const s = await yahooSession();
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbolOf(ticker)}?modules=financialData,recommendationTrend&crumb=${encodeURIComponent(s.crumb)}`;
    const r = await fetch(url, { headers: { ...UA, cookie: s.cookie }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { if (r.status === 401) session = null; return null; }
    const result = (await r.json())?.quoteSummary?.result?.[0];
    const f = result?.financialData;
    if (!f) return null;
    const t = result?.recommendationTrend?.trend?.find((x: { period?: string }) => x.period === "0m");
    return {
      ticker, price: num(f.currentPrice), targetMean: num(f.targetMeanPrice), targetLow: num(f.targetLowPrice), targetHigh: num(f.targetHighPrice),
      recommendation: typeof f.recommendationKey === "string" && f.recommendationKey !== "none" ? f.recommendationKey : null,
      analysts: num(f.numberOfAnalystOpinions),
      votes: t ? { strongBuy: t.strongBuy ?? 0, buy: t.buy ?? 0, hold: t.hold ?? 0, sell: t.sell ?? 0, strongSell: t.strongSell ?? 0 } : null,
      profitMargin: num(f.profitMargins), debtToEquity: num(f.debtToEquity), earningsGrowth: num(f.earningsGrowth), returnOnEquity: num(f.returnOnEquity),
      retrievedAt: new Date().toISOString(), source: `https://finance.yahoo.com/quote/${symbolOf(ticker)}/analysis`,
    };
  } catch {
    return null;
  }
}

/** Daily closes (oldest first) for a stock, e.g. "6mo" or "1y". */
export async function fetchDailyCloses(ticker: string, range = "1y"): Promise<number[] | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbolOf(ticker)}?range=${range}&interval=1d`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const closes = (await r.json())?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    return Array.isArray(closes) ? closes.filter((c: unknown): c is number => typeof c === "number" && c > 0) : null;
  } catch {
    return null;
  }
}
