import "server-only";
import { adminClient } from "./supabase";
import { required } from "./env";
import { ApiError } from "./auth";
import { bridgeQuote } from "./prices";
import { loadBars } from "./market-bars";
import type { MarketHistory } from "@/providers/types";
import {
  fetchCvmFundamentals,
  validateCvmQuery,
  type CvmQuery,
} from "@/providers/cvm";
import {
  fetchQuote,
  fetchHistory,
  fetchNews,
  fetchMacro,
  searchAssets,
} from "@/providers";

// Reserve one logical request out of 150/day: each adapter may attempt at most 3 GETs.
// This caps brapi at <=450 HTTP attempts/day (<=13,950 per 31 days), below 15,000/cycle.
export async function cached<T>(
  provider: "brapi" | "bcb" | "ibge" | "cvm",
  key: string,
  ttl: number,
  source: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const db = adminClient(),
    owner = required("ATLAS_OWNER_ID"),
    now = Date.now();
  const found = await db
    .from("market_data_cache")
    .select("payload,retrieved_at")
    .eq("owner_id", owner)
    .eq("provider", provider)
    .eq("ticker", key)
    .eq("data_kind", "READ_CACHE_V1")
    .order("retrieved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (found.error) throw found.error;
  if (found.data) {
    const age = now - Date.parse(found.data.retrieved_at);
    if (Number.isFinite(age) && age >= 0 && age < ttl)
      return found.data.payload as T;
  }
  const allowance = await db.rpc("consume_rate_limit", {
    p_key: `provider:${provider}:${new Date(now).toISOString().slice(0, 10)}`,
    p_limit: provider === "brapi" ? 150 : provider === "cvm" ? 4 : 200,
    p_window_seconds: 86400,
  });
  if (allowance.error) throw allowance.error;
  if (!allowance.data)
    throw new ApiError(
      429,
      "DATA_BUDGET_EXHAUSTED",
      "Orçamento diário desta fonte atingido. Aguarde o próximo ciclo; dados antigos não serão usados para operar.",
    );
  const result = await fetcher();
  const saved = await db.from("market_data_cache").upsert(
    {
      owner_id: owner,
      provider,
      ticker: key,
      data_kind: "READ_CACHE_V1",
      quality: provider === "brapi" ? "DELAYED" : "EOD",
      source_url: source,
      payload: result,
      retrieved_at: new Date().toISOString(),
      provider_timestamp: null,
    },
    {
      // A read cache is a replaceable snapshot. Immutable analysis inputs live in
      // decisions and memories, separately from this TTL cache.
      onConflict: "owner_id,provider,ticker,data_kind,provider_timestamp",
    },
  );
  if (saved.error) throw saved.error;
  return result;
}
/**
 * Price for an analysis (27/10/2026: with sixteen agents the free feed's 150 requests a day ran out in
 * the afternoon and analyses failed). The Genial MetaTrader price comes first — live and without a
 * daily limit — and the free feed only when the bridge is off.
 */
export async function readQuote(ticker: string) {
  const live = await bridgeQuote(ticker);
  if (live) {
    const ageSeconds = Math.max(0, (Date.now() - Date.parse(live.at)) / 1000);
    return { ticker, price: live.price.toFixed(2), currency: "BRL" as const, dataTimestamp: live.at, retrievedAt: new Date().toISOString(),
      source: "https://www.genialinvestimentos.com.br/metatrader-5", feed: "DELAYED" as const, tradable: false as const,
      ageSeconds, freshness: ageSeconds > 3600 ? ("STALE" as const) : ("DELAYED" as const) };
  }
  const quote = await cached(
    "brapi",
    `QUOTE:${ticker}`,
    30 * 60000,
    "https://brapi.dev/docs/acoes/cotacao",
    () => fetchQuote(ticker),
  );
  const ageSeconds = Math.max(
    0,
    (Date.now() - Date.parse(quote.dataTimestamp)) / 1000,
  );
  return {
    ...quote,
    ageSeconds,
    freshness: ageSeconds > 3600 ? ("STALE" as const) : ("DELAYED" as const),
  };
}
/** Daily history from the free feed (cached 12 h); when its daily budget is spent, from the stored B3 history. */
export async function readHistory(ticker: string): Promise<MarketHistory> {
  try {
    return await cached("brapi", `HISTORY:${ticker}`, 12 * 3600000, "https://brapi.dev/docs/acoes/historico", () => fetchHistory(ticker));
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "DATA_BUDGET_EXHAUSTED") throw error;
    const bars = await loadBars(adminClient(), ticker, 70);
    if (bars.length < 20) throw error;
    return { ticker, interval: "1d", range: "3mo", retrievedAt: new Date().toISOString(), source: "https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/",
      feed: "EOD", tradable: false, bars: bars.map((b) => ({ timestamp: new Date(`${b.trade_date}T13:00:00Z`).toISOString(), open: b.open, high: b.high,
        low: b.low, close: b.close, adjustedClose: null, volume: b.volume })) };
  }
}
export const readSearch = (query: string) =>
  cached(
    "brapi",
    `SEARCH:${query.toUpperCase()}`,
    3600000,
    "https://brapi.dev/docs",
    () => searchAssets(query),
  );
export const readMacro = () =>
  cached(
    "bcb",
    "MACRO:432",
    6 * 3600000,
    "https://dadosabertos.bcb.gov.br/",
    fetchMacro,
  );
export const readNews = () =>
  cached(
    "ibge",
    "NEWS",
    15 * 60000,
    "https://servicodados.ibge.gov.br/api/docs/noticias?versao=3",
    fetchNews,
  );

export function readFundamentals(query: CvmQuery) {
  const input = validateCvmQuery(query);
  return cached(
    "cvm",
    `DFP:${input.cvmCode}:${input.year}:${input.scope}`,
    7 * 86400000,
    `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_${input.year}.zip`,
    () => fetchCvmFundamentals(input),
  );
}
