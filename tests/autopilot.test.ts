import { describe, expect, it } from "vitest";
import { AUTOPILOT_VERSION, AutopilotError, autopilotDecision, type AutopilotInput } from "@/core/autopilot";
import type { MarketHistory, MarketQuote } from "@/providers/types";

const now = "2026-10-22T18:00:00.000Z";
function market(closes: number[], price: string) {
  const quote: MarketQuote = {
    ticker: "TEST3", price, currency: "BRL", dataTimestamp: "2026-10-22T17:30:00.000Z", retrievedAt: now,
    source: "https://example.test/quote", feed: "DELAYED", freshness: "DELAYED", ageSeconds: 1800, tradable: false,
  };
  const history: MarketHistory = {
    ticker: "TEST3", interval: "1d", range: "3mo", retrievedAt: now, source: "https://example.test/history",
    feed: "EOD", tradable: false,
    bars: closes.map((close, index) => ({
      timestamp: new Date(Date.parse(now) - (closes.length - index) * 86400000).toISOString(),
      open: String(close), high: String(close), low: String(close), close: close.toFixed(2), adjustedClose: null, volume: 1000,
    })),
  };
  return { quote, history };
}
const rising = Array.from({ length: 60 }, (_, i) => 10 + i * 0.1); // SMA20 > SMA50, last close 15.9
const falling = Array.from({ length: 60 }, (_, i) => 16 - i * 0.1);
function input(overrides: Partial<AutopilotInput> = {}, closes = rising, price = "16.00"): AutopilotInput {
  return {
    ticker: "TEST3", ...market(closes, price), now,
    position: { quantity: 0, averageCost: "0" }, hasOpenOrder: false,
    budgetRoom: "1000.00", maxOrderValue: "500.00", availableCash: "5000.00",
    lotSize: 1, tickSize: "0.01", feeBps: 3, slippageBps: 5, stopLossPct: 8,
    ...overrides,
  };
}

describe("paper autopilot rule", () => {
  it("buys in an uptrend, sized by the tightest of budget, order limit and cash", () => {
    const decision = autopilotDecision(input());
    expect(decision.action).toBe("BUY");
    if (decision.action !== "BUY") return;
    // Limit = 16 × (1 + 25 bps) rounded up to the tick; leaves room for the paper slippage.
    expect(decision.limitPrice).toBe("16.04");
    expect(Number(decision.limitPrice) * decision.quantity).toBeLessThanOrEqual(500);
    expect(decision.quantity).toBe(31);
    expect(decision.reason).toContain(AUTOPILOT_VERSION);
    expect(decision.reason).toContain("simulação");
  });

  it("respects lot size and holds when one lot does not fit", () => {
    const lots = autopilotDecision(input({ lotSize: 10 }));
    expect(lots.action === "BUY" && lots.quantity).toBe(30);
    expect(autopilotDecision(input({ budgetRoom: "10.00" })).action).toBe("HOLD");
    expect(autopilotDecision(input({ availableCash: "0" })).action).toBe("HOLD");
  });

  it("does nothing while an order is open or in a downtrend without position", () => {
    expect(autopilotDecision(input({ hasOpenOrder: true })).action).toBe("HOLD");
    expect(autopilotDecision(input({}, falling, "10.10")).action).toBe("HOLD");
  });

  it("needs 50 bars before trading", () => {
    const decision = autopilotDecision(input({}, rising.slice(-30)));
    expect(decision.action).toBe("HOLD");
    expect(decision.reason).toContain("50");
  });

  it("sells the whole position when the trend turns or the stop is hit", () => {
    const trend = autopilotDecision(input({ position: { quantity: 40, averageCost: "11.00" } }, falling, "10.10"));
    expect(trend.action).toBe("SELL");
    if (trend.action === "SELL") {
      expect(trend.quantity).toBe(40);
      expect(trend.limitPrice).toBe("10.07");
    }
    const stop = autopilotDecision(input({ position: { quantity: 5, averageCost: "20.00" } }, rising, "16.00"));
    expect(stop.action).toBe("SELL");
    expect(stop.reason).toContain("stop");
    const keep = autopilotDecision(input({ position: { quantity: 5, averageCost: "15.00" } }));
    expect(keep.action).toBe("HOLD");
  });

  it("refuses stale or mismatched data instead of guessing", () => {
    const stale = input();
    stale.quote = { ...stale.quote, dataTimestamp: "2026-10-10T17:00:00.000Z" };
    expect(() => autopilotDecision(stale)).toThrow(AutopilotError);
    const other = input();
    other.quote = { ...other.quote, ticker: "OTHER3" };
    expect(() => autopilotDecision(other)).toThrow("ASSET_MISMATCH");
  });
});
