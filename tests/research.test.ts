import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atr, ema, rsi, runBacktest, sma, temporalSplit, walkForward,
  type ResearchBar, type ResearchConfig, type ResearchDataset, type SignalContext,
} from "../src/core/research";

// Synthetic test fixtures only. These are never production price series.
function bars(prices: string[]): ResearchBar[] {
  return prices.map((price, index) => {
    const date = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
    return { timestamp: `${date}T12:00:00.000Z`, closedAt: `${date}T20:00:00.000Z`, availableAt: `${date}T20:00:00.000Z`, open: price, high: "200", low: "0.01", close: price, adjustedClose: "999", volume: 1000 };
  });
}
function dataset(candles: ResearchBar[]): ResearchDataset {
  return { source: "https://example.com/synthetic-test-only", asOf: "2025-06-01T00:00:00.000Z", priceBasis: "RAW", bars: candles, corporateActions: [], corporateActionsVerifiedThrough: candles[candles.length - 1].closedAt };
}
const config: ResearchConfig = {
  initialCapital: "100", periodsPerYear: 252, annualRiskFreeRate: 0,
  costs: { brokerageFixed: "0", brokerageBps: "0", exchangeFeeBps: "0", spreadBps: "0", slippageBps: "0" },
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("deterministic indicators", () => {
  it("computes SMA and EMA with explicit warmup and SMA seed", () => {
    expect(sma(["1", "2", "3", "4", "8"], 3)).toEqual([null, null, "2", "3", "5"]);
    expect(ema(["1", "2", "3", "4", "8"], 3)).toEqual([null, null, "2", "3", "5.5"]);
    expect(sma(["0.1", "0.2", "0.3"], 3)).toEqual([null, null, "0.2"]);
    expect(ema(["2", "3"], 1)).toEqual(["2", "3"]);
  });

  it("implements Wilder RSI with deterministic flat, rising and falling cases", () => {
    expect(rsi(["10", "11", "12", "13"], 3)).toEqual([null, null, null, "100"]);
    expect(rsi(["13", "12", "11", "10"], 3)).toEqual([null, null, null, "0"]);
    expect(rsi(["10", "10", "10", "10"], 3)).toEqual([null, null, null, "50"]);
    expect(rsi(["10", "11", "10", "11", "10"], 3).slice(3).map(Number)).toEqual([100 * 2 / 3, 100 * 4 / 9]);
  });

  it("ATR includes overnight gaps and Wilder smoothing", () => {
    const values = atr([
      { high: "11", low: "9", close: "10" }, // TR 2
      { high: "15", low: "13", close: "14" }, // TR 5, overnight gap
      { high: "15", low: "12", close: "13" }, // TR 3, seed 10/3
      { high: "16", low: "12", close: "14" }, // TR 4, next 32/9
    ], 3);
    expect(values.slice(0, 2)).toEqual([null, null]);
    expect(Number(values[2])).toBeCloseTo(10 / 3, 12);
    expect(Number(values[3])).toBeCloseTo(32 / 9, 12);
  });

  it("rejects invalid periods, input values and OHLC rather than creating zeroes", () => {
    expect(() => sma(["1"], 0)).toThrow("INVALID_PERIOD");
    expect(() => ema(["NaN"], 1)).toThrow("INVALID_DECIMAL");
    expect(() => rsi(["0", "1"], 1)).toThrow("INVALID_DECIMAL");
    expect(() => atr([{ high: "9", low: "10", close: "10" }], 1)).toThrow("INVALID_OHLC");
  });
});

describe("causal long-only backtest", () => {
  it("fills only at next opening, never signal close or unseen opening", () => {
    const candles = bars(["10", "11", "13"]);
    candles[0].close = "100";
    const contexts: SignalContext[] = [];
    const result = runBacktest(dataset(candles), (context) => {
      contexts.push(context);
      if (context.bars.length === 1) return { action: "BUY", quantity: "2" };
      if (context.bars.length === 2) return { action: "SELL" };
      return { action: "HOLD" };
    }, config);
    expect(contexts.map((context) => context.bars.length)).toEqual([1, 2, 3]);
    expect(contexts[0].bars[0].close).toBe("100");
    expect(contexts[0].bars).not.toContain(candles[1]);
    expect(contexts[0].bars[0].adjustedClose).toBeNull();
    expect(result.fills[0]).toMatchObject({ decisionAt: candles[0].closedAt, executedAt: candles[1].timestamp, price: "11", quantity: "2" });
    expect(result.fills[1]).toMatchObject({ executedAt: candles[2].timestamp, price: "13" });
    expect(result.finalCash).toBe("104");
    expect(result.trades[0].pnl).toBe("4");
    expect(result.mode).toBe("RESEARCH_ONLY");
  });

  it("only reveals observations and late candles after availableAt", () => {
    const candles = bars(["10", "11", "12"]);
    candles[0].availableAt = candles[2].closedAt;
    const data = dataset(candles);
    data.observations = [{ key: "income", value: "123", timestamp: candles[0].timestamp, availableAt: candles[2].closedAt }];
    const seen: [number, number][] = [];
    runBacktest(data, (context) => { seen.push([context.bars.length, context.observations.length]); return { action: "HOLD" }; }, config);
    expect(seen).toEqual([[0, 0], [1, 0], [3, 1]]);
  });

  it("prevents callbacks mutating the provided histories", () => {
    const candles = bars(["10", "11"]);
    expect(() => runBacktest(dataset(candles), (context) => {
      (context.bars[0] as ResearchBar).close = "999";
      return { action: "HOLD" };
    }, config)).toThrow();
    expect(candles[0].close).toBe("10");
  });

  it("accounts for brokerage, exchange fees, full spread and slippage with decimals", () => {
    const result = runBacktest(dataset(bars(["10", "10", "12"])), (context) => context.bars.length === 1 ? { action: "BUY", quantity: "2" } : context.bars.length === 2 ? { action: "SELL" } : { action: "HOLD" }, {
      ...config, costs: { brokerageFixed: "1", brokerageBps: "10", exchangeFeeBps: "5", spreadBps: "20", slippageBps: "10" },
    });
    expect(result.fills[0]).toMatchObject({ price: "10.02", notional: "20.04", fees: "1.03006", cashAfter: "78.92994" });
    expect(result.fills[1]).toMatchObject({ price: "11.976", fees: "1.035928" });
    expect(result.finalCash).toBe("101.846012");
    expect(result.metrics.totalFees).toBe("2.065988");
    expect(result.trades[0].pnl).toBe("1.846012");
  });

  it("does not generate binary floating-point money drift", () => {
    const result = runBacktest(dataset(bars(["0.1", "0.1", "0.2"])), (context) => context.bars.length === 1 ? { action: "BUY", quantity: "3" } : { action: "SELL" }, { ...config, initialCapital: "0.3" });
    expect(result.fills[0].cashAfter).toBe("0");
    expect(result.finalCash).toBe("0.6");
    expect(result.trades[0].pnl).toBe("0.3");
  });

  it("blocks buying beyond cash and never creates negative balances", () => {
    const result = runBacktest(dataset(bars(["10", "20"])), () => ({ action: "BUY", quantity: "10" }), config);
    expect(result.fills).toEqual([]);
    expect(result.rejected[0].reason).toBe("INSUFFICIENT_CASH");
    expect(result.finalCash).toBe("100");
    expect(result.finalQuantity).toBe("0");
  });

  it("forbids short selling, fractional shares and increasing an existing position", () => {
    const short = runBacktest(dataset(bars(["10", "10"])), () => ({ action: "SELL" }), config);
    expect(short.fills).toEqual([]);
    expect(short.finalQuantity).toBe("0");
    expect(() => runBacktest(dataset(bars(["10", "10"])), () => ({ action: "BUY", quantity: "0.5" }), config)).toThrow("INTEGER_QUANTITY_REQUIRED");
    const repeat = runBacktest(dataset(bars(["10", "10", "10"])), () => ({ action: "BUY", quantity: "1" }), config);
    expect(repeat.fills).toHaveLength(1);
    expect(repeat.rejected[0].reason).toBe("POSITION_ALREADY_OPEN");
  });

  it("does not force a final liquidation or fill a final-bar signal", () => {
    const result = runBacktest(dataset(bars(["10", "10"])), (context) => context.bars.length === 1 ? { action: "BUY", quantity: "1" } : { action: "SELL" }, config);
    expect(result.fills).toHaveLength(1);
    expect(result.trades).toEqual([]);
    expect(result.finalQuantity).toBe("1");
    expect(result.unexecutedFinalSignal).toEqual({ action: "SELL" });
    expect(result.metrics.winRate).toBeNull();
  });

  it("rejects unknown action, invalid costs and unsupported price basis", () => {
    const data = dataset(bars(["10", "10"]));
    expect(() => runBacktest(data, () => ({ action: "SHORT" }) as never, config)).toThrow("INVALID_SIGNAL");
    expect(() => runBacktest(data, () => ({ action: "HOLD" }), { ...config, costs: { ...config.costs, brokerageFixed: "-1" } })).toThrow("INVALID_COSTS");
    expect(() => runBacktest({ ...data, priceBasis: "ADJUSTED" } as never, () => ({ action: "HOLD" }), config)).toThrow("RAW_PRICES_REQUIRED");
  });
});

describe("corporate actions and point-in-time validation", () => {
  it("blocks missing or incomplete corporate-action coverage", () => {
    const data = dataset(bars(["10", "10"]));
    expect(() => runBacktest({ ...data, corporateActions: null }, () => ({ action: "HOLD" }), config)).toThrow("CORPORATE_ACTIONS_UNVERIFIED");
    expect(() => runBacktest({ ...data, corporateActionsVerifiedThrough: data.bars[0].closedAt }, () => ({ action: "HOLD" }), config)).toThrow("CORPORATE_ACTIONS_UNVERIFIED");
  });

  it("applies split share count while preserving entry cost basis", () => {
    const candles = bars(["100", "100", "50", "55"]);
    const data = dataset(candles);
    data.corporateActions = [{ id: "split-1", type: "SPLIT", ratio: "2", availableAt: candles[0].closedAt, effectiveAt: candles[2].timestamp }];
    const result = runBacktest(data, (context) => context.bars.length === 1 ? { action: "BUY", quantity: "1" } : context.bars.length === 3 ? { action: "SELL" } : { action: "HOLD" }, { ...config, initialCapital: "200" });
    expect(result.equity[1].equity).toBe("200");
    expect(result.equity[2]).toMatchObject({ quantity: "2", equity: "200" });
    expect(result.fills[1]).toMatchObject({ side: "SELL", quantity: "2", price: "55" });
    expect(result.finalCash).toBe("210");
    expect(result.trades[0].pnl).toBe("10");
  });

  it("blocks fractional reverse split settlement instead of rounding shares or inventing cash", () => {
    const candles = bars(["10", "10", "20"]);
    const data = dataset(candles);
    data.corporateActions = [{ id: "reverse", type: "SPLIT", ratio: "0.5", availableAt: candles[0].closedAt, effectiveAt: candles[2].timestamp }];
    expect(() => runBacktest(data, (context) => context.bars.length === 1 ? { action: "BUY", quantity: "1" } : { action: "HOLD" }, config)).toThrow("FRACTIONAL_SPLIT_UNSUPPORTED");
  });

  it("invalidates an unfilled pre-split buy proposal rather than guessing its revised quantity", () => {
    const candles = bars(["10", "5"]);
    const data = dataset(candles);
    data.corporateActions = [{ id: "split", type: "SPLIT", ratio: "2", availableAt: candles[0].closedAt, effectiveAt: candles[1].timestamp }];
    const result = runBacktest(data, () => ({ action: "BUY", quantity: "1" }), config);
    expect(result.fills).toEqual([]);
    expect(result.rejected[0].reason).toBe("CORPORATE_ACTION_INVALIDATED_SIGNAL");
  });

  it("accrues dividend receivable at ex-date and cash only on payable date, even after selling", () => {
    const candles = bars(["100", "100", "95", "96", "96"]);
    const data = dataset(candles);
    data.corporateActions = [{ id: "dividend", type: "CASH_DIVIDEND", cashPerShare: "5", availableAt: candles[0].closedAt, effectiveAt: candles[2].timestamp, payableAt: candles[4].timestamp }];
    const result = runBacktest(data, (context) => context.bars.length === 1 ? { action: "BUY", quantity: "1" } : context.bars.length === 3 ? { action: "SELL" } : { action: "HOLD" }, { ...config, initialCapital: "200" });
    expect(result.equity[2]).toMatchObject({ cash: "100", receivables: "5", equity: "200" });
    expect(result.equity[3]).toMatchObject({ cash: "196", quantity: "0", receivables: "5", equity: "201" });
    expect(result.finalCash).toBe("201");
    expect(result.finalReceivables).toBe("0");
    expect(result.trades[0]).toMatchObject({ pnl: "1", income: "5" });
  });

  it("rejects events supplied only after effective time", () => {
    const candles = bars(["10", "5"]);
    const data = dataset(candles);
    data.corporateActions = [{ id: "late", type: "SPLIT", ratio: "2", availableAt: candles[1].closedAt, effectiveAt: candles[1].timestamp }];
    expect(() => runBacktest(data, () => ({ action: "HOLD" }), config)).toThrow("ACTION_NOT_AVAILABLE");
  });

  it("rejects future as-of, future availability, fabricated dates and overlapping bars", () => {
    const data = dataset(bars(["10", "10"]));
    expect(() => runBacktest({ ...data, asOf: "2027-01-01T00:00:00Z" }, () => ({ action: "HOLD" }), config)).toThrow("FUTURE_AS_OF");
    const late = bars(["10", "10"]); late[0].availableAt = "2025-07-01T00:00:00Z";
    expect(() => runBacktest(dataset(late), () => ({ action: "HOLD" }), config)).toThrow("FUTURE_DATA");
    const invalid = bars(["10"]); invalid[0].timestamp = "2025-02-31T12:00:00Z";
    expect(() => runBacktest(dataset(invalid), () => ({ action: "HOLD" }), config)).toThrow("INVALID_TIMESTAMP");
    const overlap = bars(["10", "10"]); overlap[1].timestamp = overlap[0].timestamp;
    expect(() => runBacktest(dataset(overlap), () => ({ action: "HOLD" }), config)).toThrow("OVERLAPPING_BARS");
  });
});

describe("research statistics and temporal validation", () => {
  it("reports null for undefined no-trade ratios instead of infinities or fabricated wins", () => {
    const result = runBacktest(dataset(bars(["10", "11", "9"])), () => ({ action: "HOLD" }), config);
    expect(result.metrics).toMatchObject({ totalReturn: 0, cagr: 0, sharpe: null, sortino: null, profitFactor: null, winRate: null, expectancy: null, averageWin: null, averageLoss: null, maxDrawdown: 0, exposure: 0, turnover: 0 });
  });

  it("computes closed-trade P&L statistics and close-to-close drawdown including initial equity", () => {
    const candles = bars(["10", "10", "9"]); candles[1].close = "11";
    const result = runBacktest(dataset(candles), (context) => context.bars.length === 1 ? { action: "BUY", quantity: "1" } : context.bars.length === 2 ? { action: "SELL" } : { action: "HOLD" }, config);
    expect(result.metrics).toMatchObject({ totalReturn: -0.01, profitFactor: 0, winRate: 0, expectancy: "-1", averageLoss: "-1", averageWin: null, exposure: 1 / 3, turnover: 0.19 });
    expect(result.metrics.maxDrawdown).toBeCloseTo(2 / 101, 12);
    const excess = [0, 0.01, -2 / 101];
    const mean = excess.reduce((a, b) => a + b) / 3;
    const deviation = Math.sqrt(excess.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 2);
    expect(result.metrics.sharpe).toBeCloseTo(mean / deviation * Math.sqrt(252), 10);
    expect(result.metrics.sortino).toBeCloseTo(mean / Math.sqrt((2 / 101) ** 2 / 3) * Math.sqrt(252), 10);
  });

  it("profit factor and expectancy use completed net P&L, with a losing and a winning trade", () => {
    const result = runBacktest(dataset(bars(["10", "10", "12", "10", "9"])), (context) => context.bars.length === 1 || context.bars.length === 3 ? { action: "BUY", quantity: "1" } : { action: "SELL" }, config);
    expect(result.trades.map((trade) => trade.pnl)).toEqual(["2", "-1"]);
    expect(result.metrics).toMatchObject({ totalReturn: 0.01, profitFactor: 2, winRate: 0.5, expectancy: "0.5", averageWin: "2", averageLoss: "-1" });
  });

  it("creates chronological, disjoint train, validation and out-of-sample partitions", () => {
    const candles = bars(Array(10).fill("10"));
    const split = temporalSplit(candles, 5, 2);
    expect([split.train.length, split.validation.length, split.outOfSample.length]).toEqual([5, 2, 3]);
    expect(split.trainCutoff).toBe(candles[4].closedAt);
    expect(split.validationCutoff).toBe(candles[6].closedAt);
    expect(split.outOfSample[0].timestamp).toBe(candles[7].timestamp);
    expect(Object.isFrozen(split.train)).toBe(true);
    expect(split.train[0].adjustedClose).toBeNull();
  });

  it("blocks a training revision published only during validation", () => {
    const candles = bars(Array(10).fill("10"));
    candles[0].availableAt = candles[5].closedAt;
    expect(() => temporalSplit(candles, 5, 2)).toThrow("PARTITION_DATA_NOT_AVAILABLE");
  });

  it("walk-forward purges label horizons and never repeats test observations across folds", () => {
    const candles = bars(Array(20).fill("10"));
    const folds = walkForward(candles, { trainSize: 5, validationSize: 2, testSize: 3, purgeBars: 1 });
    expect(folds).toHaveLength(3);
    expect(folds[0].validation[0].timestamp).toBe(candles[6].timestamp);
    expect(folds[0].outOfSample[0].timestamp).toBe(candles[9].timestamp);
    const tests = folds.flatMap((fold) => fold.outOfSample.map((bar) => bar.timestamp));
    expect(new Set(tests).size).toBe(tests.length);
    for (const fold of folds) {
      expect(Date.parse(fold.trainCutoff)).toBeLessThan(Date.parse(fold.validation[0].timestamp));
      expect(Date.parse(fold.validationCutoff)).toBeLessThan(Date.parse(fold.outOfSample[0].timestamp));
    }
  });

  it("rejects invalid splits and overlapping walk-forward test steps", () => {
    const candles = bars(Array(10).fill("10"));
    expect(() => temporalSplit(candles, 8, 2)).toThrow("EMPTY_OUT_OF_SAMPLE");
    expect(() => walkForward(candles, { trainSize: 5, validationSize: 2, testSize: 3, stepSize: 1 })).toThrow("OVERLAPPING_TEST_WINDOWS");
    expect(() => walkForward(candles, { trainSize: 10, validationSize: 2, testSize: 3 })).toThrow("INSUFFICIENT_WALK_FORWARD_DATA");
  });
});
