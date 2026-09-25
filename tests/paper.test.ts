import { describe, expect, it } from "vitest";
import { analyzePaperProposal, PaperAnalysisError, paperReferencePrice } from "@/core/paper";
import type { MarketHistory, MarketQuote } from "@/providers/types";

const now = "2026-09-25T18:00:00.000Z";
const quote: MarketQuote = {
  ticker: "TEST3", price: "10.015", currency: "BRL",
  dataTimestamp: "2026-09-25T17:45:00.000Z", retrievedAt: now,
  source: "https://example.test/quote", feed: "DELAYED", freshness: "DELAYED",
  ageSeconds: 900, tradable: false,
};
const bars = Array.from({ length: 8 }, (_, index) => ({
  timestamp: new Date(Date.parse(now) - (9 - index) * 86400000).toISOString(),
  open: "10", high: "11", low: "9", close: (10 + index / 10).toFixed(2),
  adjustedClose: null, volume: 1000,
}));
const history: MarketHistory = {
  ticker: "TEST3", bars, interval: "1d", range: "1mo",
  retrievedAt: now, source: "https://example.test/history", feed: "EOD", tradable: false,
};

describe("owner-guided paper analysis", () => {
  it("keeps source, delayed feed and deterministic SMA evidence", () => {
    const result = analyzePaperProposal({ ticker: "TEST3", quote, history, side: "BUY", now });
    expect(result.referencePrice).toBe("10.02");
    expect(result.indicators.trend).toBe("UP");
    expect(result.reasoningSummary).toContain("DELAYED");
    expect(result.reasoningSummary).toContain("escolhida pelo proprietário");
  });
  it("blocks stale, mismatched or insufficient market evidence", () => {
    expect(() => analyzePaperProposal({ ticker: "OTHER3", quote, history, side: "BUY", now })).toThrow("ASSET_MISMATCH");
    expect(() => analyzePaperProposal({ ticker: "TEST3", quote: { ...quote, dataTimestamp: "2026-09-20T18:00:00Z" }, history, side: "BUY", now })).toThrow("STALE_MARKET_DATA");
    expect(() => analyzePaperProposal({ ticker: "TEST3", quote, history: { ...history, bars: bars.slice(0, 3) }, side: "BUY", now })).toThrow("INSUFFICIENT_OR_INVALID_HISTORY");
    expect(() => paperReferencePrice("NaN")).toThrow(PaperAnalysisError);
  });
  it.skipIf(process.env.ATLAS_PAPER_PUBLIC_SMOKE !== "1")("accepts current public brapi evidence without placing an order", async () => {
    const { fetchQuote, fetchHistory } = await import("@/providers");
    const [publicQuote, publicHistory] = await Promise.all([fetchQuote("PETR4"), fetchHistory("PETR4")]);
    const result = analyzePaperProposal({ ticker: "PETR4", quote: publicQuote, history: publicHistory, side: "BUY", now: new Date().toISOString() });
    expect(result.reasoningSummary).toContain(publicQuote.dataTimestamp);
    expect(result.strategyVersion).toContain("paper-");
  });
});
