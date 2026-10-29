import { describe, expect, it } from "vitest";
import { AUTOPILOT_VERSION, AutopilotError, autopilotDecision, STEADY_VERSION, TRAILING_VERSION, type AutopilotInput } from "@/core/autopilot";
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
  it("buys in an uptrend, half of the tightest of budget, order limit and cash (buying in parts)", () => {
    const decision = autopilotDecision(input());
    expect(decision.action).toBe("BUY");
    if (decision.action !== "BUY") return;
    // Limit = 16 × (1 + 25 bps) rounded up to the tick; leaves room for the paper slippage.
    expect(decision.limitPrice).toBe("16.04");
    expect(Number(decision.limitPrice) * decision.quantity).toBeLessThanOrEqual(500);
    expect(decision.quantity).toBe(15); // half of the R$ 500 order limit (owner, 29/10/2026)
    expect(decision.reason).toContain(AUTOPILOT_VERSION);
    expect(decision.reason).not.toContain("simulação");
  });

  it("respects lot size and holds when one lot does not fit", () => {
    const lots = autopilotDecision(input({ lotSize: 10 }));
    expect(lots.action === "BUY" && lots.quantity).toBe(10);
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

  it("never sells below what was paid when the owner's floor is set", () => {
    const trailing = { peak: "19.00", priorHigh: "17.00", everHeld: true, trailPct: 15 };
    const position = { quantity: 10, averageCost: "17" };
    const held = autopilotDecision(input({ position, trailing, minSellPrice: "17.20" }, rising, "16.00"));
    expect(held.action).toBe("HOLD");
    expect(held.reason).toContain("abaixo do que pagou");
    const context = autopilotDecision(input({ position, minSellPrice: "17.20", context: { action: "EXIT", summary: "notícia grave" } }, rising, "16.00"));
    expect(context.action).toBe("HOLD");
    expect(autopilotDecision(input({ position, trailing, minSellPrice: "15.00" }, rising, "16.00")).action).toBe("SELL");
  });

  it("refuses stale or mismatched data instead of guessing", () => {
    const stale = input();
    stale.quote = { ...stale.quote, dataTimestamp: "2026-10-10T17:00:00.000Z" };
    expect(() => autopilotDecision(stale)).toThrow(AutopilotError);
    const other = input();
    other.quote = { ...other.quote, ticker: "OTHER3" };
    expect(() => autopilotDecision(other)).toThrow("ASSET_MISMATCH");
  });
  it("lets the context brake buys, halve them or force an exit, never start a buy", () => {
    const blocked = autopilotDecision(input({ context: { action: "BLOCK_BUY", summary: "fato relevante" } }));
    expect(blocked.action).toBe("HOLD");
    expect(blocked.reason).toContain("bloqueado pelo contexto");
    const reduced = autopilotDecision(input({ context: { action: "REDUCE", summary: "dólar" } }));
    expect(reduced.action === "BUY" && reduced.quantity).toBe(15);
    const exit = autopilotDecision(input({ position: { quantity: 5, averageCost: "15.00" }, context: { action: "EXIT", summary: "recuperação judicial" } }));
    expect(exit).toMatchObject({ action: "SELL", quantity: 5 });
    expect(autopilotDecision(input({ context: { action: "EXIT", summary: "x" } })).action).toBe("HOLD");
    expect(autopilotDecision(input({}, falling, "10.10")).action).toBe("HOLD");
  });
  it("trailing rule: enters at once, holds while near the top, exits after a 15% fall, re-enters on a new 20-day high", () => {
    const trailing = (patch: Partial<NonNullable<AutopilotInput["trailing"]>>) => ({ peak: null, priorHigh: "17.00", everHeld: false, trailPct: 15, ...patch });
    const first = autopilotDecision(input({ trailing: trailing({}) }, falling, "10.10"));
    expect(first.action).toBe("BUY");
    expect(first.reason).toContain(TRAILING_VERSION);
    const holding = autopilotDecision(input({ position: { quantity: 10, averageCost: "15" }, trailing: trailing({ peak: "18.00", everHeld: true }) }, rising, "16.00"));
    expect(holding.action).toBe("HOLD");
    expect(holding.reason).toContain("15.30");
    const stopped = autopilotDecision(input({ position: { quantity: 10, averageCost: "15" }, trailing: trailing({ peak: "19.00", everHeld: true }) }, rising, "16.00"));
    expect(stopped).toMatchObject({ action: "SELL", quantity: 10 });
    expect(autopilotDecision(input({ trailing: trailing({ everHeld: true }) }, rising, "16.00")).action).toBe("HOLD");
    expect(autopilotDecision(input({ trailing: trailing({ everHeld: true, priorHigh: "15.50" }) }, rising, "16.00")).action).toBe("BUY");
    expect(autopilotDecision(input({ trailing: trailing({}), context: { action: "BLOCK_BUY", summary: "x" } }, rising, "16.00")).action).toBe("HOLD");
  });
  it("owner's monthly rule: buys whenever its share reaches R$ 100, holds through falls, sells only high and never at a loss", () => {
    const steady = (peak: string | null) => ({ steady: { peak, targetPct: 60, turnPct: 8 }, minOrderValue: 100 });
    const first = autopilotDecision(input({ ...steady(null), budgetRoom: "266.00" }, falling, "10.10"));
    expect(first.action).toBe("BUY");
    expect(first.reason).toContain(STEADY_VERSION);
    expect(autopilotDecision(input({ ...steady(null), budgetRoom: "66.00" }, falling, "10.10")).reason).toContain("juntando");
    const held = { position: { quantity: 10, averageCost: "10.00" }, budgetRoom: "0.00" };
    expect(autopilotDecision(input({ ...steady("16.00"), ...held }, falling, "10.10")).action).toBe("HOLD"); // falling: just holds
    expect(autopilotDecision(input({ ...steady("17.00"), ...held }, rising, "16.50")).reason).toContain("segura"); // +65% but only 3% off the top
    expect(autopilotDecision(input({ ...steady("18.00"), ...held }, rising, "16.50"))).toMatchObject({ action: "SELL", quantity: 10 });
    expect(autopilotDecision(input({ ...steady("18.00"), ...held, minSellPrice: "20.00" }, rising, "16.50")).action).toBe("HOLD");
    expect(autopilotDecision(input({ ...steady("16.00"), position: held.position, budgetRoom: "300.00" }, falling, "10.10")).action).toBe("BUY");
  });
  it("one purchase a day: the next part waits for another session (owner, 29/10/2026)", () => {
    const again = autopilotDecision(input({ boughtToday: true }));
    expect(again.action).toBe("HOLD");
    expect(again.reason).toContain("já comprou hoje");
  });
});

describe("range levels without distorted sessions (owner, 29/10/2026: the election run-up)", () => {
  it("uses the level closes for the 6-month low and high, the full closes for the turn", async () => {
    const { rangeDecision, inDistortion } = await import("@/core/range");
    expect([inDistortion("2026-10-09"), inDistortion("2026-09-30"), inDistortion("2026-10-26")]).toEqual([false, false, false].map((_, i) => i === 0));
    // A run-up to 60 inside the window would make the high 60; without it the high is 46.
    const base = Array.from({ length: 60 }, (_, i) => 40 + (i % 7));
    const withRally = [...base, 55, 60, 58, 42];
    const opts = { window: 126, nearPct: 2, minGainPct: 3, confirmBuy: false, confirmSell: false, minUpShare: 0 };
    const common = { closes: withRally, price: 46, quantity: 10, cost: 400, cash: 0, minOrder: 0 };
    expect(rangeDecision(common, opts).high).toBe(60);
    const kept = rangeDecision({ ...common, levelCloses: [...base, 42] }, opts);
    expect(kept.high).toBe(46);
    expect(kept.action).toBe("SELL");
  });
});
