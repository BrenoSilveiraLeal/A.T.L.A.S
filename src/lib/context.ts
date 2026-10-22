import "server-only";
import { adminClient } from "./supabase";
import { required } from "./env";
import { fetchCvmMaterialFacts, type CvmMaterialFact } from "@/providers/cvm";
import { fetchHeadlines, type Headline } from "@/providers/gdelt";
import { fetchAgenciaBrasilHeadlines } from "@/providers/agencia-brasil";
import { fetchDollar } from "@/providers/bcb";
import type { MacroObservation } from "@/providers/types";
import { assessContext, companyProfile, MARKET_QUERY, type ContextAssessment } from "@/core/context";

/**
 * Stale-tolerant cache for context sources. Unlike data.ts `cached`, a failed or
 * budget-limited refresh falls back to the last snapshot while it is younger than
 * maxStaleMs; older or absent data is reported as unavailable, never invented.
 */
async function softCached<T>(provider: string, key: string, ttlMs: number, maxStaleMs: number, dailyLimit: number,
  source: string, fetcher: () => Promise<T>, canFetch: () => Promise<boolean> = async () => true,
  retrySeconds = 600): Promise<T | null> {
  const db = adminClient(), owner = required("ATLAS_OWNER_ID"), now = Date.now();
  const found = await db.from("market_data_cache").select("payload,retrieved_at").eq("owner_id", owner)
    .eq("provider", provider).eq("ticker", key).eq("data_kind", "READ_CACHE_V1")
    .order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
  if (found.error) throw found.error;
  const age = found.data ? now - Date.parse(found.data.retrieved_at) : Infinity;
  if (age >= 0 && age < ttlMs) return found.data!.payload as T;
  const stale = age >= 0 && age < maxStaleMs ? (found.data!.payload as T) : null;
  try {
    const allowance = await db.rpc("consume_rate_limit", { p_key: `provider:${provider}:${new Date(now).toISOString().slice(0, 10)}`,
      p_limit: dailyLimit, p_window_seconds: 86400 });
    if (allowance.error || !allowance.data) return stale;
    // Back off per key: a failing source is retried at most once per retrySeconds, not every tick.
    const attempt = await db.rpc("consume_rate_limit", { p_key: `attempt:${provider}:${key}`, p_limit: 1, p_window_seconds: retrySeconds });
    if (attempt.error || !attempt.data || !(await canFetch())) return stale;
    const result = await fetcher();
    const saved = await db.from("market_data_cache").upsert({ owner_id: owner, provider, ticker: key, data_kind: "READ_CACHE_V1",
      quality: "EOD", source_url: source, payload: result, retrieved_at: new Date().toISOString(), provider_timestamp: null },
      { onConflict: "owner_id,provider,ticker,data_kind,provider_timestamp" });
    if (saved.error) throw saved.error;
    return result;
  } catch {
    return stale;
  }
}

/** GDELT allows one request per 5 s; a shared 6 s DB slot also covers concurrent ticks. Waits up to 8 s for it. */
function gdeltPacer(maxFetches: number) {
  let used = 0;
  return async () => {
    if (used >= maxFetches) return false;
    for (let waited = 0; waited <= 8000; waited += 1000) {
      const slot = await adminClient().rpc("consume_rate_limit", { p_key: "gdelt:slot", p_limit: 1, p_window_seconds: 6 });
      if (slot.error) return false;
      if (slot.data) { used++; return true; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  };
}

export interface ContextSources {
  facts: CvmMaterialFact[] | null;
  /** Agência Brasil (primary, licensed for non-commercial reuse with credit). */
  agency: Headline[] | null;
  market: Headline[] | null;
  dollar: MacroObservation[] | null;
  company: Map<string, Headline[] | null>;
}

/**
 * Loads context once per scheduler tick for the claimed tickers. At most one GDELT
 * refresh per tick (≤20 s with the pacing wait), so a Vercel invocation stays inside 60 s.
 */
export async function loadContextSources(tickers: readonly string[]): Promise<ContextSources> {
  const year = new Date().getUTCFullYear();
  const pace = gdeltPacer(1);
  const [facts, dollar, agency] = await Promise.all([
    softCached("cvm-ipe", `IPE:${year}`, 6 * 3600000, 8 * 86400000, 6,
      `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/ipe_cia_aberta_${year}.zip`, () => fetchCvmMaterialFacts(year)),
    softCached("bcb", "SGS:1", 3 * 3600000, 4 * 86400000, 50, "https://dadosabertos.bcb.gov.br/", fetchDollar),
    softCached("agenciabrasil", "HEADLINES", 3600000, 12 * 3600000, 200, "https://agenciabrasil.ebc.com.br/", () => fetchAgenciaBrasilHeadlines()),
  ]);
  // Sequential on purpose: GDELT throttles parallel requests.
  const market = await softCached("gdelt", "MARKET", 2 * 3600000, 12 * 3600000, 300, "https://api.gdeltproject.org/",
    () => fetchHeadlines(MARKET_QUERY, "24h", 75), pace, 1800);
  const company = new Map<string, Headline[] | null>();
  for (const ticker of new Set(tickers)) {
    company.set(ticker, await softCached("gdelt", `COMPANY:${ticker}`, 2 * 3600000, 12 * 3600000, 300,
      "https://api.gdeltproject.org/", () => fetchHeadlines(companyProfile(ticker).query, "24h", 50), pace, 1800));
  }
  return { facts, agency, market, dollar, company };
}

const SOURCE_NAMES: Record<string, string> = { "agenciabrasil.ebc.com.br": "Agência Brasil" };

/** Merges available headline sources, last 24 h only; null only when every source failed. */
function merge(now: string, ...lists: (Headline[] | null)[]) {
  const available = lists.filter((list): list is Headline[] => list !== null);
  if (!available.length) return null;
  const since = Date.parse(now) - 24 * 3600000;
  const unique = new Map(available.flat().filter((h) => Date.parse(h.seenAt) >= since)
    .map((h) => [h.url, { title: h.title, url: h.url, seenAt: h.seenAt, source: SOURCE_NAMES[h.domain] ?? h.domain }]));
  return [...unique.values()];
}

export function contextFor(ticker: string, sources: ContextSources, now = new Date().toISOString()): ContextAssessment {
  return assessContext({
    ticker, now, facts: sources.facts,
    companyHeadlines: merge(now, sources.agency, sources.company.get(ticker) ?? null),
    marketHeadlines: merge(now, sources.agency, sources.market),
    dollar: sources.dollar?.map((d) => ({ observationDate: d.observationDate, value: d.value })) ?? null,
  });
}

/** One-line summary for proposals and alerts (proposal reasoning is capped in the database). */
export function contextSummary(context: ContextAssessment) {
  return (context.reasons[0]?.text ?? "sem eventos relevantes").slice(0, 200);
}
