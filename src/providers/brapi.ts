import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import { getJson, parseResponse, ProviderError } from "./http";
import { brazilDate, checkedTicker, checkedTimestamp, isoTimestampSchema, positivePriceSchema, tickerSchema } from "./validation";
import type { AssetSearchResult, MarketHistory, MarketQuote } from "./types";

const identity = {
  requestedSymbol: z.string(), symbol: tickerSchema, changed: z.boolean(),
};
const quoteSchema = z.object({
  results: z.array(z.object({ ...identity, data: z.object({
    currency: z.literal("BRL"), regularMarketPrice: positivePriceSchema,
    regularMarketTime: isoTimestampSchema,
  }) })).length(1),
  requestedAt: isoTimestampSchema,
});
const barSchema = z.object({
  date: z.number().int().nonnegative().max(8_640_000_000_000),
  open: positivePriceSchema, high: positivePriceSchema, low: positivePriceSchema, close: positivePriceSchema,
  adjustedClose: positivePriceSchema.nullable().optional(),
  volume: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).refine((bar) => {
  const high = new Decimal(bar.high);
  const low = new Decimal(bar.low);
  return high.gte(low) && high.gte(bar.open) && high.gte(bar.close) && low.lte(bar.open) && low.lte(bar.close);
});
const historySchema = z.object({
  results: z.array(z.object({ ...identity, data: z.object({
    usedInterval: z.literal("1d"), usedRange: z.string().min(1),
    historicalDataPrice: z.array(barSchema).max(500),
  }) })).length(1),
  requestedAt: isoTimestampSchema,
});
const searchSchema = z.object({
  results: z.array(z.object({
    symbol: z.string(), name: z.string().min(1).max(1000),
    assetType: z.string(), subType: z.string(), exchange: z.string(), currency: z.string(),
    sector: z.string().nullable().optional(), isActive: z.boolean(),
  })).max(50),
});

function token(): string | undefined { return process.env.BRAPI_API_TOKEN?.trim() || undefined; }

function validateIdentity(row: z.infer<typeof quoteSchema>["results"][number] | z.infer<typeof historySchema>["results"][number], ticker: string) {
  if (row.changed || row.symbol !== ticker) throw new ProviderError("brapi", "TICKER_CHANGED");
  if (row.requestedSymbol !== ticker) throw new ProviderError("brapi", "INVALID_RESPONSE");
}

/** Complementary delayed data. It is never an execution-eligible quote. */
export async function fetchQuote(input: string): Promise<MarketQuote> {
  const ticker = checkedTicker(input);
  const url = new URL("https://brapi.dev/api/v2/stocks/quote");
  url.searchParams.set("symbols", ticker);
  const payload = parseResponse("brapi", quoteSchema, await getJson("brapi", url, { token: token() }));
  const now = Date.now();
  checkedTimestamp("brapi", payload.requestedAt, now);
  const row = payload.results[0];
  validateIdentity(row, ticker);
  const dataTimestamp = checkedTimestamp("brapi", row.data.regularMarketTime, now);
  if (Date.parse(dataTimestamp) > Date.parse(payload.requestedAt)) throw new ProviderError("brapi", "INVALID_RESPONSE");
  const ageSeconds = Math.floor((now - Date.parse(dataTimestamp)) / 1000);
  return {
    ticker, price: row.data.regularMarketPrice, currency: "BRL", dataTimestamp,
    retrievedAt: new Date(now).toISOString(), source: url.toString(),
    feed: "DELAYED", freshness: ageSeconds > 45 * 60 ? "STALE" : "DELAYED", ageSeconds, tradable: false,
  };
}

/** One month of daily bars. Today's possibly incomplete candle is excluded. */
export async function fetchHistory(input: string): Promise<MarketHistory> {
  const ticker = checkedTicker(input);
  const url = new URL("https://brapi.dev/api/v2/stocks/historical");
  url.search = new URLSearchParams({ symbols: ticker, range: "1mo", interval: "1d", sortOrder: "asc" }).toString();
  const payload = parseResponse("brapi", historySchema, await getJson("brapi", url, { token: token() }));
  const now = Date.now();
  checkedTimestamp("brapi", payload.requestedAt, now);
  const row = payload.results[0];
  validateIdentity(row, ticker);
  if (!row.data.historicalDataPrice.length) throw new ProviderError("brapi", "EMPTY_DATA");
  const seen = new Set<number>();
  const bars = row.data.historicalDataPrice.map((bar) => {
    if (seen.has(bar.date)) throw new ProviderError("brapi", "INVALID_RESPONSE");
    seen.add(bar.date);
    return {
      timestamp: checkedTimestamp("brapi", bar.date * 1000, now),
      open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      adjustedClose: bar.adjustedClose ?? null, volume: bar.volume,
    };
  }).filter((bar) => brazilDate(Date.parse(bar.timestamp)) < brazilDate(now))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!bars.length) throw new ProviderError("brapi", "EMPTY_DATA");
  return {
    ticker, bars, interval: "1d", range: row.data.usedRange,
    retrievedAt: new Date(now).toISOString(), source: url.toString(), feed: "EOD", tradable: false,
  };
}

export async function searchAssets(query: string): Promise<AssetSearchResult[]> {
  const parsed = z.string().trim().min(1).max(80).safeParse(query);
  if (!parsed.success) throw new ProviderError("brapi", "INVALID_INPUT");
  const url = new URL("https://brapi.dev/api/v2/tickers");
  url.search = new URLSearchParams({ search: parsed.data, type: "stock", subType: "stock", limit: "20", page: "1" }).toString();
  const payload = parseResponse("brapi", searchSchema, await getJson("brapi", url));
  const retrievedAt = new Date().toISOString();
  return payload.results.filter((row) => row.assetType === "stock" && row.subType === "stock"
    && row.exchange === "B3" && row.currency === "BRL" && row.isActive).map((row) => ({
      ticker: checkedTicker(row.symbol), name: row.name, exchange: "B3", currency: "BRL", assetType: "stock",
      sector: row.sector ?? null, source: url.toString(), retrievedAt,
    }));
}
