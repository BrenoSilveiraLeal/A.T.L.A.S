import Decimal from "decimal.js";
import type { CorporateAction, ResearchBar, ResearchStrategy } from "./research";

/**
 * Price-level strategies ("piso e teto") and the plan an agent shows to the owner.
 * All levels use split-adjusted prices known at decision time. Research entry points
 * return engine strategies (decide at close, fill at the next open, standard lots).
 */
export interface DailyBar { high: string; low: string; close: string }

export interface LevelPlan {
  /** Lowest low / highest high of the lookback window, excluding the latest bar. */
  floor: string;
  ceiling: string;
  low52w: string | null;
  high52w: string | null;
  trendAverage: string | null;
  trendUp: boolean;
  /** Buy when the price is at or below this; sell (take profit) at or above `sellAt`; stop at `stop`. */
  buyAt: string;
  sellAt: string;
  stop: string;
}

export const LEVELS_DEFAULTS = { lookback: 20, trendPeriod: 100, nearFloorPct: 3, ceilingPct: 1, stopPct: 5 };

const avg = (values: Decimal[]) => values.reduce((a, b) => a.plus(b), new Decimal(0)).div(values.length);

/** Pure plan from adjusted daily bars (oldest first). Null when history is too short. */
export function levelPlan(bars: readonly DailyBar[], options = LEVELS_DEFAULTS): LevelPlan | null {
  if (bars.length < options.lookback + 1) return null;
  const window = bars.slice(-options.lookback - 1, -1);
  const floor = Decimal.min(...window.map((b) => new Decimal(b.low)));
  const ceiling = Decimal.max(...window.map((b) => new Decimal(b.high)));
  const year = bars.slice(-252);
  const closes = bars.map((b) => new Decimal(b.close));
  const trend = closes.length >= options.trendPeriod ? avg(closes.slice(-options.trendPeriod)) : null;
  const close = closes[closes.length - 1];
  return {
    floor: floor.toFixed(2), ceiling: ceiling.toFixed(2),
    low52w: bars.length >= 252 ? Decimal.min(...year.map((b) => new Decimal(b.low))).toFixed(2) : null,
    high52w: bars.length >= 252 ? Decimal.max(...year.map((b) => new Decimal(b.high))).toFixed(2) : null,
    trendAverage: trend ? trend.toFixed(2) : null,
    trendUp: trend !== null && close.gt(trend),
    buyAt: floor.times(1 + options.nearFloorPct / 100).toFixed(2),
    sellAt: ceiling.times(1 - options.ceilingPct / 100).toFixed(2),
    stop: floor.times(1 - options.stopPct / 100).toFixed(2),
  };
}

/** Split-adjusted OHLC as known at decision time (later splits are unknown then). */
export function adjustedBars(bars: readonly ResearchBar[], actions: readonly CorporateAction[]): DailyBar[] {
  const splits = actions.filter((a): a is Extract<CorporateAction, { type: "SPLIT" }> => a.type === "SPLIT");
  return bars.map((bar) => {
    const factor = splits.filter((s) => s.effectiveAt > bar.timestamp).reduce((f, s) => f.times(s.ratio), new Decimal(1));
    return { high: new Decimal(bar.high).div(factor).toFixed(8), low: new Decimal(bar.low).div(factor).toFixed(8), close: new Decimal(bar.close).div(factor).toFixed(8) };
  });
}

function lotsFor(cash: string, close: Decimal, lot: number) {
  const lots = new Decimal(cash).times(0.98).div(close.times(lot)).floor();
  return lots.gt(0) ? lots.times(lot).toFixed() : null;
}

/**
 * "Piso e teto": in a long-term uptrend, buy pullbacks near the recent floor; sell near
 * the recent ceiling, below the stop, or when the uptrend breaks. The plan is frozen at
 * entry so targets do not drift with the position.
 */
export function levelsResearchStrategy(options = { ...LEVELS_DEFAULTS, lot: 100 }): ResearchStrategy {
  let plan: LevelPlan | null = null;
  return (context) => {
    const bars = adjustedBars(context.bars, context.corporateActions);
    const close = new Decimal(bars[bars.length - 1].close);
    const quantity = new Decimal(context.quantity);
    const current = levelPlan(bars, options);
    if (!current) return { action: "HOLD" };
    if (quantity.gt(0)) {
      const frozen = plan ?? current;
      if (close.gte(frozen.sellAt) || close.lte(frozen.stop) || !current.trendUp) { plan = null; return { action: "SELL" }; }
      return { action: "HOLD" };
    }
    plan = null;
    if (!current.trendUp || close.gt(current.buyAt)) return { action: "HOLD" };
    const quantityToBuy = lotsFor(context.cash, close, options.lot);
    if (!quantityToBuy) return { action: "HOLD" };
    plan = current;
    return { action: "BUY", quantity: quantityToBuy };
  };
}

/** Classic breakout ("rompimento"): buy a new N-day high, exit on an M-day low. */
export function breakoutResearchStrategy(options = { entryLookback: 55, exitLookback: 20, lot: 100 }): ResearchStrategy {
  return (context) => {
    const bars = adjustedBars(context.bars, context.corporateActions);
    if (bars.length < options.entryLookback + 1) return { action: "HOLD" };
    const close = new Decimal(bars[bars.length - 1].close);
    const prior = (n: number) => bars.slice(-n - 1, -1);
    if (new Decimal(context.quantity).gt(0)) {
      const low = Decimal.min(...prior(options.exitLookback).map((b) => new Decimal(b.low)));
      return close.lt(low) ? { action: "SELL" } : { action: "HOLD" };
    }
    const high = Decimal.max(...prior(options.entryLookback).map((b) => new Decimal(b.high)));
    if (!close.gt(high)) return { action: "HOLD" };
    const quantityToBuy = lotsFor(context.cash, close, options.lot);
    return quantityToBuy ? { action: "BUY", quantity: quantityToBuy } : { action: "HOLD" };
  };
}

/**
 * "Segurar com freio" by long trend: hold while the adjusted close is above its N-day
 * average; sell when it closes below it by `bufferPct`; buy back once above again.
 */
export function longTrendResearchStrategy(options = { period: 200, bufferPct: 2, lot: 100 }): ResearchStrategy {
  return (context) => {
    const bars = adjustedBars(context.bars, context.corporateActions);
    if (bars.length < options.period) return { action: "HOLD" };
    const closes = bars.slice(-options.period).map((b) => new Decimal(b.close));
    const average = avg(closes), close = closes[closes.length - 1];
    if (new Decimal(context.quantity).gt(0))
      return close.lt(average.times(1 - options.bufferPct / 100)) ? { action: "SELL" } : { action: "HOLD" };
    if (!close.gt(average.times(1 + options.bufferPct / 100))) return { action: "HOLD" };
    const quantityToBuy = lotsFor(context.cash, close, options.lot);
    return quantityToBuy ? { action: "BUY", quantity: quantityToBuy } : { action: "HOLD" };
  };
}

/**
 * "Segurar com stop móvel": hold; sell after a `trailPct` drop from the highest close
 * since entry; buy back when the close makes a new `reentryLookback`-day high.
 */
export function trailingHoldResearchStrategy(options = { trailPct: 20, reentryLookback: 20, lot: 100 }): ResearchStrategy {
  let peak: Decimal | null = null;
  let splitsSeen = 0;
  return (context) => {
    const bars = adjustedBars(context.bars, context.corporateActions);
    const splits = context.corporateActions.filter((a) => a.type === "SPLIT");
    // Adjusted prices already absorb splits; keep the stored peak in the same terms.
    for (const s of splits.slice(splitsSeen)) if (peak && s.type === "SPLIT") peak = peak.div(s.ratio);
    splitsSeen = splits.length;
    const close = new Decimal(bars[bars.length - 1].close);
    if (new Decimal(context.quantity).gt(0)) {
      peak = peak && peak.gt(close) ? peak : close;
      if (close.lte(peak.times(1 - options.trailPct / 100))) { peak = null; return { action: "SELL" }; }
      return { action: "HOLD" };
    }
    peak = null;
    const first = context.bars.length === 1;
    const prior = bars.slice(-options.reentryLookback - 1, -1);
    const breakout = prior.length === options.reentryLookback && close.gt(Decimal.max(...prior.map((b) => new Decimal(b.close))));
    if (!first && !breakout) return { action: "HOLD" };
    const quantityToBuy = lotsFor(context.cash, close, options.lot);
    if (!quantityToBuy) return { action: "HOLD" };
    peak = close;
    return { action: "BUY", quantity: quantityToBuy };
  };
}

/**
 * Live counterpart of `adjustedBars` for stored daily bars: a bar on or before an event's
 * record date ("data com") is divided by that event's share ratio, so the series is
 * continuous across splits, groupings and bonus issues. Cash dividends are ignored.
 */
export function adjustStoredBars(
  bars: readonly { trade_date: string; high: string; low: string; close: string }[],
  stockEvents: readonly { kind: "SPLIT" | "GROUPING" | "BONUS" | "CASH"; value: string; lastDatePrior: string }[],
): DailyBar[] {
  const ratios = stockEvents.filter((e) => e.kind !== "CASH")
    .map((e) => ({ date: e.lastDatePrior, ratio: e.kind === "GROUPING" ? new Decimal(e.value) : new Decimal(e.value).div(100).plus(1) }));
  return bars.map((bar) => {
    const factor = ratios.filter((r) => bar.trade_date <= r.date).reduce((f, r) => f.times(r.ratio), new Decimal(1));
    return { high: new Decimal(bar.high).div(factor).toFixed(8), low: new Decimal(bar.low).div(factor).toFixed(8), close: new Decimal(bar.close).div(factor).toFixed(8) };
  });
}
