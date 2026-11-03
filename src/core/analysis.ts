import Decimal from "decimal.js";
import type {
  MarketQuote,
  MarketHistory,
  MacroObservation,
  NewsArticle,
} from "@/providers/types";

export const OBSERVATION_VERSION = "sma-observation/1.0.0";
/** Tolerated lead of a quote over the computer's clock (exchange and PC clocks differ by seconds). */
export const QUOTE_CLOCK_SKEW_MS = 120_000;

export function analyzeAsset(input: {
  ticker: string;
  now: string;
  quote: MarketQuote;
  history: MarketHistory;
  news: NewsArticle[];
  macro: MacroObservation[];
  contextErrors?: string[];
}) {
  const { quote, history } = input;
  const now = Date.parse(input.now);
  if (
    !Number.isFinite(now) ||
    quote.ticker !== input.ticker ||
    history.ticker !== input.ticker
  )
    throw new Error("ANALYSIS_IDENTITY_INVALID");
  // 03/11/2026: Genial's MetaTrader stamps live ticks a few seconds ahead of the PC clock now and
  // then; up to QUOTE_CLOCK_SKEW_MS is clock skew, beyond it the quote is refused.
  if (
    !Number.isFinite(Date.parse(quote.dataTimestamp)) ||
    Date.parse(quote.dataTimestamp) > now + QUOTE_CLOCK_SKEW_MS
  )
    throw new Error("FUTURE_OR_INVALID_QUOTE");
  if (
    history.bars.some(
      (bar, i) =>
        !Number.isFinite(Date.parse(bar.timestamp)) ||
        Date.parse(bar.timestamp) >= now ||
        (i > 0 &&
          Date.parse(bar.timestamp) <=
            Date.parse(history.bars[i - 1].timestamp)),
    )
  )
    throw new Error("INVALID_HISTORY_ORDER");
  const average = (period: number) => {
    if (history.bars.length < period) return null;
    return history.bars
      .slice(-period)
      .reduce((sum, bar) => {
        const close = new Decimal(bar.close);
        if (!close.isFinite() || close.lte(0)) throw new Error("INVALID_BAR");
        return sum.plus(close);
      }, new Decimal(0))
      .div(period)
      .toFixed(8);
  };
  const sma20 = average(20),
    sma50 = average(50);
  const trend =
    sma20 && sma50
      ? new Decimal(sma20).gt(sma50)
        ? "ABOVE"
        : new Decimal(sma20).lt(sma50)
          ? "BELOW"
          : "EQUAL"
      : "INSUFFICIENT_HISTORY";
  const reason = `${input.ticker}: cotação ${quote.price} BRL com origem brapi (${quote.freshness}). ${sma20 && sma50 ? `SMA20 ${sma20}; SMA50 ${sma50}.` : "Histórico insuficiente para comparar SMA20 e SMA50."} HOLD: feed complementar, sessão oficial e corretora não homologados. Estratégia ${OBSERVATION_VERSION}.`;
  return {
    ticker: input.ticker,
    timestamp: input.now,
    decision: "HOLD" as const,
    confidence: null,
    reasoningSummary: reason,
    technicalScore: null,
    fundamentalScore: null,
    newsScore: null,
    macroScore: null,
    riskScore: null,
    indicators: { sma20, sma50, trend },
    suggestedQuantity: 0,
    suggestedOrderType: null,
    suggestedLimitPrice: null,
    expectedHoldingPeriod: null,
    invalidatedIf: [
      "CORPORATE_ACTION_UNREVIEWED",
      "HISTORY_REVISED",
      "DATA_STALE",
    ],
    sources: [
      quote.source,
      history.source,
      ...input.macro.map((item) => item.source),
      ...input.news.slice(0, 5).map((item) => item.url),
    ],
    dataTimestamp: quote.dataTimestamp,
    strategyVersion: OBSERVATION_VERSION,
    risk: {
      approved: false,
      reasons: [
        "LIVE_DISABLED",
        "FEED_NOT_EXECUTABLE",
        "BROKER_NOT_CERTIFIED",
        "OFFICIAL_SESSION_UNKNOWN",
      ],
    },
    context: {
      newsCount: input.news.length,
      macroCount: input.macro.length,
      errors: input.contextErrors ?? [],
      classification: "UNCLASSIFIED",
    },
  };
}
