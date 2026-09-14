import "server-only";
import { adminClient } from "./supabase";
import { required } from "./env";
import { ApiError } from "./auth";
import { fetchQuote, fetchHistory, fetchNews, fetchMacro, searchAssets } from "@/providers";

// Reserve one logical request out of 150/day: each adapter may attempt at most 3 GETs.
// This caps brapi at <=450 HTTP attempts/day (<=13,950 per 31 days), below 15,000/cycle.
async function cached<T>(provider: "brapi" | "bcb" | "ibge", key: string, ttl: number, source: string, fetcher: () => Promise<T>): Promise<T> {
  const db = adminClient(), owner = required("ATLAS_OWNER_ID"), now = Date.now();
  const found = await db.from("market_data_cache").select("payload,retrieved_at").eq("owner_id", owner).eq("provider", provider).eq("ticker", key).eq("data_kind", "READ_CACHE_V1").order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) {
    const age = now - Date.parse(found.data.retrieved_at);
    if (Number.isFinite(age) && age >= 0 && age < ttl) return found.data.payload as T;
  }
  const allowance = await db.rpc("consume_rate_limit", { p_key: `provider:${provider}:${new Date(now).toISOString().slice(0, 10)}`, p_limit: provider === "brapi" ? 150 : 200, p_window_seconds: 86400 });
  if (allowance.error) throw allowance.error;
  if (!allowance.data) throw new ApiError(429, "DATA_BUDGET_EXHAUSTED", "Orçamento diário desta fonte atingido. Aguarde o próximo ciclo; dados antigos não serão usados para operar.");
  const result = await fetcher();
  const saved = await db.from("market_data_cache").insert({ owner_id: owner, provider, ticker: key, data_kind: "READ_CACHE_V1", quality: provider === "brapi" ? "DELAYED" : "EOD", source_url: source, payload: result, retrieved_at: new Date().toISOString() });
  if (saved.error) throw saved.error;
  return result;
}
export async function readQuote(ticker: string) {
  const quote = await cached("brapi", `QUOTE:${ticker}`, 30 * 60000, "https://brapi.dev/docs/acoes/cotacao", () => fetchQuote(ticker));
  const ageSeconds = Math.max(0, (Date.now() - Date.parse(quote.dataTimestamp)) / 1000);
  return { ...quote, ageSeconds, freshness: ageSeconds > 3600 ? "STALE" as const : "DELAYED" as const };
}
export const readHistory = (ticker: string) => cached("brapi", `HISTORY:${ticker}`, 12 * 3600000, "https://brapi.dev/docs/acoes/historico", () => fetchHistory(ticker));
export const readSearch = (query: string) => cached("brapi", `SEARCH:${query.toUpperCase()}`, 3600000, "https://brapi.dev/docs", () => searchAssets(query));
export const readMacro = () => cached("bcb", "MACRO:432", 6 * 3600000, "https://dadosabertos.bcb.gov.br/", fetchMacro);
export const readNews = () => cached("ibge", "NEWS", 15 * 60000, "https://servicodados.ibge.gov.br/api/docs/noticias?versao=3", fetchNews);
