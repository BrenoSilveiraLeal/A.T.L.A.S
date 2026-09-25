import Decimal from "decimal.js";
import type { MarketHistory, MarketQuote } from "@/providers/types";

export const PAPER_STRATEGY_VERSION = "paper-owner-guided-sma3x8/1.0.0";
const D = Decimal.clone({ precision: 32, rounding: Decimal.ROUND_HALF_EVEN });

export class PaperAnalysisError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function paperReferencePrice(raw: string): string {
  let price: Decimal;
  try { price = new D(raw); } catch { throw new PaperAnalysisError("INVALID_PRICE"); }
  if (!price.isFinite() || price.lte(0)) throw new PaperAnalysisError("INVALID_PRICE");
  const rounded = price.toDecimalPlaces(2).toFixed(2);
  if (new D(rounded).lte(0)) throw new PaperAnalysisError("INVALID_PRICE");
  return rounded;
}

/** A descriptive signal for an owner-guided paper proposal, never a live recommendation. */
export function analyzePaperProposal(input: {
  ticker: string;
  quote: MarketQuote;
  history: MarketHistory;
  side: "BUY" | "SELL";
  now: string;
}) {
  const now = Date.parse(input.now);
  const quoteAt = Date.parse(input.quote.dataTimestamp);
  const retrievedAt = Date.parse(input.history.retrievedAt);
  const bars = input.history.bars;
  if (input.quote.ticker !== input.ticker || input.history.ticker !== input.ticker)
    throw new PaperAnalysisError("ASSET_MISMATCH");
  if (!Number.isFinite(now) || !Number.isFinite(quoteAt) || !Number.isFinite(retrievedAt) ||
    quoteAt > now || quoteAt < now - 72 * 3600000 ||
    retrievedAt > now || retrievedAt < now - 24 * 3600000)
    throw new PaperAnalysisError("STALE_MARKET_DATA");
  if (bars.length < 8 || bars.some((bar, index) =>
    !Number.isFinite(Date.parse(bar.timestamp)) || Date.parse(bar.timestamp) >= now ||
    (index > 0 && Date.parse(bar.timestamp) <= Date.parse(bars[index - 1].timestamp))))
    throw new PaperAnalysisError("INSUFFICIENT_OR_INVALID_HISTORY");
  if (Date.parse(bars[bars.length - 1].timestamp) < now - 7 * 86400000)
    throw new PaperAnalysisError("STALE_HISTORY_BARS");
  let quotePrice: Decimal;
  let sma3: Decimal;
  let sma8: Decimal;
  try {
    quotePrice = new D(input.quote.price);
    const closes = bars.slice(-8).map((bar) => new D(bar.close));
    if (!quotePrice.isFinite() || quotePrice.lte(0) ||
      closes.some((close) => !close.isFinite() || close.lte(0))) throw new Error();
    sma3 = D.sum(...closes.slice(-3)).div(3);
    sma8 = D.sum(...closes).div(8);
  } catch {
    throw new PaperAnalysisError("INVALID_PRICE");
  }
  const trend = sma3.gt(sma8) ? "UP" : sma3.lt(sma8) ? "DOWN" : "FLAT";
  const referencePrice = paperReferencePrice(input.quote.price);
  const reasoningSummary = `${input.ticker}: ${input.side} virtual escolhida pelo proprietário. SMA3 ${sma3.toFixed(4)} e SMA8 ${sma8.toFixed(4)} (${trend}); cotação brapi ${referencePrice} BRL, ${input.quote.feed}, observada em ${input.quote.dataTimestamp}. Isto não é previsão nem autorização para negociar de verdade.`;
  return {
    referencePrice,
    reasoningSummary,
    strategyVersion: PAPER_STRATEGY_VERSION,
    indicators: { sma3: sma3.toFixed(4), sma8: sma8.toFixed(4), trend },
  };
}
