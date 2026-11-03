import { afterEach, describe, expect, it, vi } from "vitest";
import { B3_CALENDAR } from "@/core/b3-calendar";
import {
  backtestCandidate,
  selectWalkForwardCandidate,
  type BacktestCandidateId,
  type BacktestFoldSummary,
  type BacktestSummary,
  type MinuteBar,
} from "@/core/daytrade/analysis";

afterEach(() => vi.useRealTimers());

function regularSessions(count: number): string[] {
  const dates: string[] = [];
  for (let day = 1; day <= 31 && dates.length < count; day++) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const calendar = B3_CALENDAR[2026];
    if (weekday === 0 || weekday === 6 || calendar.closed[date] || calendar.lateOpen[date]) continue;
    dates.push(date);
  }
  if (dates.length !== count) throw new Error(`Could not create ${count} regular B3 fixture sessions.`);
  return dates;
}

function fixtureBars(dates: string[]): MinuteBar[] {
  const bars: MinuteBar[] = [];
  for (const date of dates) {
    // A completed history marker makes missing no-trade minutes explicit; do not fabricate them.
    for (let offset = 0; offset <= 60; offset++) {
      const totalMinutes = 9 * 60 + offset;
      const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
      const minute = String(totalMinutes % 60).padStart(2, "0");
      let open = 100, high = 100, low = 100, close = 100;
      if (offset < 15) { high = 101; low = 99; }
      if (offset === 29) { high = 102; close = 102; }
      if (offset >= 30 && offset < 60) { open = 102; high = 103; low = 101; close = 102; }
      if (offset === 60) { open = 105; high = 106; low = 104; close = 105; }
      if (offset > 60) { open = 105; high = 106; low = 104; close = 105; }
      bars.push({
        bucket_at: `${date}T${hour}:${minute}:00-03:00`,
        open, high, low, close, volume: 1, turnover: close,
      });
    }
  }
  return bars;
}

function summary(candidate: BacktestCandidateId, folds: BacktestFoldSummary[]): BacktestSummary {
  const trades = folds.flatMap((fold) => fold.netPnlByTrade);
  return {
    candidate, maxTradesPerDay: 3, researchOnly: true, trades: trades.length,
    grossPnl: folds.reduce((sum, fold) => sum + fold.grossPnl, 0),
    feesPaid: folds.reduce((sum, fold) => sum + fold.feesPaid, 0),
    slippageCost: folds.reduce((sum, fold) => sum + fold.slippageCost, 0),
    netPnl: trades.reduce((sum, value) => sum + value, 0),
    winRate: null, profitFactor: null, maxDrawdown: 0, outOfSampleTrades: trades.length,
    walkForwardFolds: folds.length, trainingDays: 10 + (folds.length - 1) * 3,
    evaluationDays: folds.length * 3, eligibleSessions: 10 + folds.length * 3,
    sparseSessions: 0, gapTerminatedSessions: 0, gapFlattenedTrades: 0,
    tradeLossLimitBreaches: 0, dailyLossLimitBreaches: 0, maxSingleTradeLoss: 0, maxDailyLoss: 0,
    folds, status: "RESEARCH_ONLY",
  };
}

const fold = (index: number, netPnlByTrade: number[]): BacktestFoldSummary => ({
  fold: index, trainingSessions: 10 + (index - 1) * 3,
  evaluationFrom: `2026-10-${String(20 + index).padStart(2, "0")}`,
  evaluationThrough: `2026-10-${String(22 + index).padStart(2, "0")}`,
  trades: netPnlByTrade.length, grossPnl: netPnlByTrade.reduce((sum, value) => sum + value, 0),
  feesPaid: 0, slippageCost: 0, netPnl: netPnlByTrade.reduce((sum, value) => sum + value, 0),
  netPnlByTrade,
});

describe("DASH quantitative research", () => {
  it("uses chronological out-of-sample sessions and charges both sides of costs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T17:00:00Z"));
    const dates = regularSessions(13);
    const bars = fixtureBars(dates);
    const risk = { maxLossPerTrade: 100, maxLossPerDay: 1000, maxTradesPerDay: 3 };
    const session = { lastEntry: "09:50", flatBy: "10:00" };
    const candidate = "opening-range-vwap-v1" as const;

    const historyCounts = Object.fromEntries(dates.map((date) => [date, 61]));
    const free = backtestCandidate(bars, 1, 1, 0, 0, null, session, candidate, risk, historyCounts);
    const charged = backtestCandidate(bars, 1, 1, 2, 1, null, session, candidate, risk, historyCounts);

    expect(free.status).toBe("RESEARCH_ONLY");
    expect(free.eligibleSessions).toBe(13);
    expect(free.sparseSessions).toBe(13);
    expect(free.trainingDays).toBe(10);
    expect(free.evaluationDays).toBe(3);
    expect(free.trades).toBe(3);
    expect(free.folds[0].evaluationFrom).toBe(dates[10]);
    expect(free.folds[0].evaluationThrough).toBe(dates[12]);
    expect(free.grossPnl).toBe(9);
    expect(free.netPnl).toBe(9);

    expect(charged.trades).toBe(3);
    expect(charged.feesPaid).toBe(12);
    expect(charged.slippageCost).toBe(6);
    expect(charged.netPnl).toBe(-9);
    expect(charged.netPnl).toBe(charged.grossPnl - charged.feesPaid - charged.slippageCost);
  });

  it("selects on completed earlier folds only, never on the fold being evaluated", () => {
    const preferredFromHistory = summary("opening-range-vwap-v1", [
      fold(1, [5, 5]), fold(2, [-50]),
    ]);
    const laterWinner = summary("opening-range-unfiltered-entry-v1", [
      fold(1, [1, 1]), fold(2, [100]),
    ]);

    const selected = selectWalkForwardCandidate([preferredFromHistory, laterWinner], 2);
    expect(selected.folds).toHaveLength(1);
    expect(selected.folds[0].selectedCandidate).toBe("opening-range-vwap-v1");
    expect(selected.folds[0].selectionScores).toEqual([
      { candidate: "opening-range-vwap-v1", netPnl: 10, trades: 2, maxDrawdown: 0 },
      { candidate: "opening-range-unfiltered-entry-v1", netPnl: 2, trades: 2, maxDrawdown: 0 },
    ]);
    expect(selected.folds[0].netPnl).toBe(-50);
  });

  it("reports stop-gap losses that exceed configured per-trade and daily limits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T17:00:00Z"));
    const dates = regularSessions(13), bars = fixtureBars(dates);
    const evaluationDates = new Set(dates.slice(10));
    for (const bar of bars) {
      if (evaluationDates.has(bar.bucket_at.slice(0, 10)) && bar.bucket_at.slice(11, 16) === "09:31") {
        bar.open = 90; bar.high = 91; bar.low = 89; bar.close = 90;
      }
    }
    const report = backtestCandidate(
      bars, 1, 1, 0, 0, null, { lastEntry: "09:50", flatBy: "10:00" },
      "opening-range-vwap-v1", { maxLossPerTrade: 5, maxLossPerDay: 10, maxTradesPerDay: 3 },
      Object.fromEntries(dates.map((date) => [date, 61])),
    );

    expect(report.trades).toBe(3);
    expect(report.tradeLossLimitBreaches).toBe(3);
    expect(report.dailyLossLimitBreaches).toBe(3);
    expect(report.maxSingleTradeLoss).toBe(12);
    expect(report.maxDailyLoss).toBe(12);
  });

  it("refuses malformed costs, risk limits, session times, and unknown candidate IDs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T17:00:00Z"));
    const dates = regularSessions(13), bars = fixtureBars(dates);
    const risk = { maxLossPerTrade: 100, maxLossPerDay: 1000, maxTradesPerDay: 3 };
    const session = { lastEntry: "09:50", flatBy: "10:00" };
    const invoke = (options: { pointValue?: number; costPerSide?: number; maxLossPerDay?: number; flatBy?: string; candidate?: string } = {}) =>
      backtestCandidate(bars, options.pointValue ?? 1, 1, options.costPerSide ?? 0, 0, null,
        { lastEntry: session.lastEntry, flatBy: options.flatBy ?? session.flatBy },
        (options.candidate ?? "opening-range-vwap-v1") as BacktestCandidateId,
        { ...risk, maxLossPerDay: options.maxLossPerDay ?? risk.maxLossPerDay },
        Object.fromEntries(dates.map((date) => [date, 61])));

    expect(invoke({ pointValue: Number.NaN }).status).toBe("INSUFFICIENT_DATA");
    expect(invoke({ costPerSide: -1 }).status).toBe("INSUFFICIENT_DATA");
    expect(invoke({ maxLossPerDay: 50 }).status).toBe("INSUFFICIENT_DATA");
    expect(invoke({ flatBy: "25:00" }).status).toBe("INSUFFICIENT_DATA");
    expect(invoke({ candidate: "unreviewed-v99" }).status).toBe("INSUFFICIENT_DATA");
  });
});
