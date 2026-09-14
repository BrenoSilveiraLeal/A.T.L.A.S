import Decimal from "decimal.js";
import type { HistoricalBar } from "../providers/types";

// Isolated precision: research never changes the accounting engine's Decimal configuration.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const DAY = 86_400_000;

export class ResearchError extends Error {
  constructor(public readonly code: string) { super(`Research: ${code}`); this.name = "ResearchError"; }
}

function decimal(value: string, positive = false): Decimal {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 80) throw new ResearchError("INVALID_DECIMAL");
  const result = new D(value);
  if (!result.isFinite() || (positive && !result.gt(0))) throw new ResearchError("INVALID_DECIMAL");
  return result;
}
function time(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new ResearchError("INVALID_TIMESTAMP");
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new ResearchError("INVALID_TIMESTAMP");
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== datePart) throw new ResearchError("INVALID_TIMESTAMP");
  return result;
}
function periodCheck(period: number) {
  if (!Number.isSafeInteger(period) || period < 1) throw new ResearchError("INVALID_PERIOD");
}

/** Warmup outputs are null. All indicator arithmetic is deterministic decimal arithmetic. */
export function sma(values: readonly string[], period: number): (string | null)[] {
  periodCheck(period);
  const prices = values.map((value) => decimal(value));
  let sum = new D(0);
  return prices.map((price, index) => {
    sum = sum.plus(price);
    if (index >= period) sum = sum.minus(prices[index - period]);
    return index < period - 1 ? null : sum.div(period).toFixed();
  });
}

/** EMA starts with the period-length SMA, then uses alpha = 2 / (period + 1). */
export function ema(values: readonly string[], period: number): (string | null)[] {
  periodCheck(period);
  const prices = values.map((value) => decimal(value));
  const alpha = new D(2).div(period + 1);
  let previous: Decimal | null = null;
  let seed = new D(0);
  return prices.map((price, index) => {
    if (index < period) seed = seed.plus(price);
    if (index < period - 1) return null;
    previous = previous === null ? seed.div(period) : price.mul(alpha).plus(previous.mul(new D(1).minus(alpha)));
    return previous.toFixed();
  });
}

/** Wilder RSI: period price changes; a flat window has RSI 50. */
export function rsi(values: readonly string[], period = 14): (string | null)[] {
  periodCheck(period);
  const prices = values.map((value) => decimal(value, true));
  let gains = new D(0); let losses = new D(0);
  return prices.map((price, index) => {
    if (index === 0) return null;
    const delta = price.minus(prices[index - 1]);
    const gain = D.max(delta, 0); const loss = D.max(delta.negated(), 0);
    if (index <= period) { gains = gains.plus(gain); losses = losses.plus(loss); }
    if (index < period) return null;
    if (index === period) { gains = gains.div(period); losses = losses.div(period); }
    else { gains = gains.mul(period - 1).plus(gain).div(period); losses = losses.mul(period - 1).plus(loss).div(period); }
    if (gains.isZero() && losses.isZero()) return "50";
    if (losses.isZero()) return "100";
    return new D(100).minus(new D(100).div(new D(1).plus(gains.div(losses)))).toFixed();
  });
}

/** Wilder ATR; first true range is high minus low, with no invented previous close. */
export function atr(bars: readonly Pick<HistoricalBar, "high" | "low" | "close">[], period = 14): (string | null)[] {
  periodCheck(period);
  let previousClose: Decimal | null = null; let average: Decimal | null = null; let seed = new D(0);
  return bars.map((bar, index) => {
    const high = decimal(bar.high, true); const low = decimal(bar.low, true); const close = decimal(bar.close, true);
    if (high.lt(low) || close.gt(high) || close.lt(low)) throw new ResearchError("INVALID_OHLC");
    const range = previousClose === null ? high.minus(low) : D.max(high.minus(low), high.minus(previousClose).abs(), low.minus(previousClose).abs());
    previousClose = close;
    if (index < period) seed = seed.plus(range);
    if (index < period - 1) return null;
    average = average === null ? seed.div(period) : average.mul(period - 1).plus(range).div(period);
    return average.toFixed();
  });
}

export interface ResearchBar extends HistoricalBar {
  /** timestamp is the open; closedAt is the completed bar's decision boundary. */
  closedAt: string;
  /** Actual point-in-time availability, never a retrospectively invented ingestion date. */
  availableAt: string;
}
export interface ResearchObservation { key: string; timestamp: string; availableAt: string; value: string }
export type CorporateAction =
  | { id: string; type: "SPLIT"; effectiveAt: string; availableAt: string; ratio: string }
  | { id: string; type: "CASH_DIVIDEND"; effectiveAt: string; availableAt: string; payableAt: string; cashPerShare: string };
export interface ResearchDataset {
  source: string;
  asOf: string;
  /** Unadjusted, as-traded OHLC is mandatory. adjustedClose is never exposed to a signal. */
  priceBasis: "RAW";
  bars: readonly ResearchBar[];
  observations?: readonly ResearchObservation[];
  /** null means unknown, not "no events". [] requires the explicit coverage attestation. */
  corporateActions: readonly CorporateAction[] | null;
  corporateActionsVerifiedThrough: string;
}
export interface ResearchCosts {
  brokerageFixed: string;
  brokerageBps: string;
  exchangeFeeBps: string;
  /** Full bid/ask spread: half is charged on each side. */
  spreadBps: string;
  slippageBps: string;
}
export type ResearchSignal = { action: "BUY"; quantity: string } | { action: "SELL" } | { action: "HOLD" };
export interface SignalContext {
  decisionAt: string;
  bars: readonly Readonly<ResearchBar>[];
  observations: readonly Readonly<ResearchObservation>[];
  corporateActions: readonly Readonly<CorporateAction>[];
  cash: string;
  quantity: string;
}
export type ResearchStrategy = (context: Readonly<SignalContext>) => ResearchSignal;
export interface ResearchConfig { initialCapital: string; costs: ResearchCosts; periodsPerYear: number; annualRiskFreeRate: number }
export interface ResearchFill {
  decisionAt: string; executedAt: string; side: "BUY" | "SELL";
  quantity: string; referenceOpen: string; price: string; notional: string; fees: string; cashAfter: string;
}
export interface ResearchTrade { openedAt: string; closedAt: string; pnl: string; income: string }
export interface EquityPoint { timestamp: string; cash: string; quantity: string; receivables: string; equity: string }
export interface ResearchMetrics {
  totalReturn: number; cagr: number | null; sharpe: number | null; sortino: number | null;
  maxDrawdown: number; profitFactor: number | null; winRate: number | null;
  expectancy: string | null; averageWin: string | null; averageLoss: string | null;
  /** Fraction of bars with a position at close; not elapsed wall-clock exposure. */
  exposure: number;
  /** Buy + sell notional divided by average closing equity; not annualized. */
  turnover: number | null;
  totalFees: string;
}
export interface ResearchResult {
  mode: "RESEARCH_ONLY"; source: string; fills: ResearchFill[]; trades: ResearchTrade[];
  equity: EquityPoint[]; metrics: ResearchMetrics;
  rejected: { decisionAt: string; attemptedAt: string; reason: string }[];
  finalCash: string; finalQuantity: string; finalReceivables: string;
  unexecutedFinalSignal: ResearchSignal | null;
}

function validateBars(bars: readonly ResearchBar[], asOf: number) {
  if (!bars.length) throw new ResearchError("EMPTY_DATA");
  bars.forEach((bar, index) => {
    const opened = time(bar.timestamp); const closed = time(bar.closedAt); const available = time(bar.availableAt);
    if (opened >= closed || available < closed) throw new ResearchError("INVALID_BAR_TIMING");
    if (closed > asOf || available > asOf) throw new ResearchError("FUTURE_DATA");
    if (index && time(bars[index - 1].closedAt) > opened) throw new ResearchError("OVERLAPPING_BARS");
    const open = decimal(bar.open, true); const high = decimal(bar.high, true);
    const low = decimal(bar.low, true); const close = decimal(bar.close, true);
    if (high.lt(low) || high.lt(open) || high.lt(close) || low.gt(open) || low.gt(close)) throw new ResearchError("INVALID_OHLC");
    if (!Number.isSafeInteger(bar.volume) || bar.volume < 0) throw new ResearchError("INVALID_VOLUME");
  });
}

function prepare(dataset: ResearchDataset) {
  const asOf = time(dataset.asOf);
  if (asOf > Date.now()) throw new ResearchError("FUTURE_AS_OF");
  if (!dataset.source.trim()) throw new ResearchError("MISSING_SOURCE");
  if (dataset.priceBasis !== "RAW") throw new ResearchError("RAW_PRICES_REQUIRED");
  validateBars(dataset.bars, asOf);
  const lastClose = time(dataset.bars[dataset.bars.length - 1].closedAt);
  if (!Array.isArray(dataset.corporateActions) || time(dataset.corporateActionsVerifiedThrough) < lastClose) throw new ResearchError("CORPORATE_ACTIONS_UNVERIFIED");
  if (time(dataset.corporateActionsVerifiedThrough) > asOf) throw new ResearchError("FUTURE_ACTION_COVERAGE");
  const opens = new Set(dataset.bars.map((bar) => time(bar.timestamp)));
  const actionIds = new Set<string>();
  const actions = dataset.corporateActions.map((action) => {
    const effective = time(action.effectiveAt); const available = time(action.availableAt);
    if (!action.id || actionIds.has(action.id)) throw new ResearchError("DUPLICATE_ACTION");
    actionIds.add(action.id);
    if (available > effective || available > asOf) throw new ResearchError("ACTION_NOT_AVAILABLE");
    if (!opens.has(effective)) throw new ResearchError("ACTION_OUTSIDE_OPEN_BOUNDARY");
    if (action.type === "SPLIT") decimal(action.ratio, true);
    else if (action.type === "CASH_DIVIDEND") {
      decimal(action.cashPerShare, true);
      if (time(action.payableAt) < effective) throw new ResearchError("INVALID_DIVIDEND_PAYMENT_DATE");
    } else throw new ResearchError("UNSUPPORTED_CORPORATE_ACTION");
    return Object.freeze({ ...action });
  });
  const actionTimes = actions.map((action) => action.effectiveAt);
  if (new Set(actionTimes).size !== actionTimes.length) throw new ResearchError("SIMULTANEOUS_ACTIONS_REQUIRE_ORDERING");
  const observations = (dataset.observations ?? []).map((observation) => {
    if (time(observation.timestamp) > time(observation.availableAt) || time(observation.availableAt) > asOf) throw new ResearchError("INVALID_OBSERVATION_AVAILABILITY");
    decimal(observation.value);
    return Object.freeze({ ...observation });
  });
  const bars = dataset.bars.map((bar) => Object.freeze({ ...bar, adjustedClose: null }));
  return { bars, actions, observations };
}

/**
 * Research only: single asset, integer shares, one entry followed by a full exit.
 * Signals see only data available by this bar's close; fills use the NEXT bar's open.
 * The callback is trusted code, not a sandbox: a closure can still import external future data.
 * No optimization, strategy endorsement, synthetic data, forced final liquidation or live orders.
 * Point-in-time requirement: https://www.quantconnect.com/docs/v2/writing-algorithms/key-concepts/research-guide
 */
export function runBacktest(dataset: ResearchDataset, strategy: ResearchStrategy, config: ResearchConfig): ResearchResult {
  const { bars, actions, observations } = prepare(dataset);
  const initial = decimal(config.initialCapital, true);
  if (!Number.isSafeInteger(config.periodsPerYear) || config.periodsPerYear <= 0 || !Number.isFinite(config.annualRiskFreeRate) || config.annualRiskFreeRate <= -1) throw new ResearchError("INVALID_ANNUALIZATION");
  const cost = Object.fromEntries(Object.entries(config.costs).map(([key, value]) => [key, decimal(value)]));
  for (const key of ["brokerageFixed", "brokerageBps", "exchangeFeeBps", "spreadBps", "slippageBps"]) {
    if (!cost[key] || cost[key].lt(0)) throw new ResearchError("INVALID_COSTS");
  }
  const friction = cost.spreadBps.div(2).plus(cost.slippageBps).div(10_000);
  if (friction.gte(1)) throw new ResearchError("INVALID_COSTS");
  const feeRate = cost.brokerageBps.plus(cost.exchangeFeeBps).div(10_000);
  let cash = initial; let quantity = new D(0); let basis = new D(0); let income = new D(0);
  let entryAt = ""; let pending: { signal: ResearchSignal; decisionAt: string } | null = null;
  const receivables: { value: Decimal; payableAt: number; paid: boolean }[] = [];
  const fills: ResearchFill[] = []; const trades: ResearchTrade[] = []; const equity: EquityPoint[] = [];
  const rejected: ResearchResult["rejected"] = [];
  let totalFees = new D(0); let totalNotional = new D(0); let exposedBars = 0;
  const settle = (at: number) => {
    receivables.forEach((receivable) => { if (!receivable.paid && receivable.payableAt <= at) { cash = cash.plus(receivable.value); receivable.paid = true; } });
  };
  const outstanding = () => receivables.reduce((sum, receivable) => receivable.paid ? sum : sum.plus(receivable.value), new D(0));

  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index]; const opened = time(bar.timestamp); const closed = time(bar.closedAt);
    actions.filter((action) => time(action.effectiveAt) === opened).forEach((action) => {
      if (action.type === "SPLIT") {
        const shares = quantity.mul(action.ratio);
        if (!shares.isInteger()) throw new ResearchError("FRACTIONAL_SPLIT_UNSUPPORTED");
        quantity = shares;
        // A submitted quantity before a split is ambiguous; do not silently change its meaning.
        if (pending?.signal.action === "BUY") {
          rejected.push({ decisionAt: pending.decisionAt, attemptedAt: bar.timestamp, reason: "CORPORATE_ACTION_INVALIDATED_SIGNAL" });
          pending = null;
        }
      } else if (quantity.gt(0)) {
        const entitlement = quantity.mul(action.cashPerShare);
        receivables.push({ value: entitlement, payableAt: time(action.payableAt), paid: false });
        income = income.plus(entitlement);
      }
    });
    settle(opened);
    if (pending && pending.signal.action !== "HOLD") {
      const { signal, decisionAt } = pending;
      let reason: string | null = null;
      if (time(decisionAt) > opened) throw new ResearchError("EXECUTION_BEFORE_DECISION");
      if (signal.action === "BUY" && quantity.gt(0)) reason = "POSITION_ALREADY_OPEN";
      if (signal.action === "SELL" && quantity.isZero()) reason = "NO_LONG_POSITION";
      const shares = signal.action === "BUY" ? decimal(signal.quantity, true) : quantity;
      if (!shares.isInteger()) throw new ResearchError("INTEGER_QUANTITY_REQUIRED");
      const price = new D(bar.open).mul(signal.action === "BUY" ? new D(1).plus(friction) : new D(1).minus(friction));
      const notional = shares.mul(price); const fees = cost.brokerageFixed.plus(notional.mul(feeRate));
      if (signal.action === "BUY" && notional.plus(fees).gt(cash)) reason = "INSUFFICIENT_CASH";
      if (signal.action === "SELL" && notional.lte(fees)) reason = "FEES_EXCEED_PROCEEDS";
      if (reason) rejected.push({ decisionAt, attemptedAt: bar.timestamp, reason });
      else {
        if (signal.action === "BUY") {
          cash = cash.minus(notional).minus(fees); quantity = shares; basis = notional.plus(fees); income = new D(0); entryAt = bar.timestamp;
        } else {
          const proceeds = notional.minus(fees);
          cash = cash.plus(proceeds);
          trades.push({ openedAt: entryAt, closedAt: bar.timestamp, pnl: proceeds.minus(basis).plus(income).toFixed(), income: income.toFixed() });
          quantity = new D(0); basis = new D(0); income = new D(0);
        }
        totalFees = totalFees.plus(fees); totalNotional = totalNotional.plus(notional);
        fills.push({ decisionAt, executedAt: bar.timestamp, side: signal.action, quantity: shares.toFixed(), referenceOpen: bar.open, price: price.toFixed(), notional: notional.toFixed(), fees: fees.toFixed(), cashAfter: cash.toFixed() });
      }
    }
    settle(closed);
    if (quantity.gt(0)) exposedBars++;
    equity.push({ timestamp: bar.closedAt, cash: cash.toFixed(), quantity: quantity.toFixed(), receivables: outstanding().toFixed(), equity: cash.plus(quantity.mul(bar.close)).plus(outstanding()).toFixed() });
    const context: SignalContext = {
      decisionAt: bar.closedAt,
      bars: Object.freeze(bars.slice(0, index + 1).filter((item) => time(item.availableAt) <= closed)),
      observations: Object.freeze(observations.filter((item) => time(item.availableAt) <= closed)),
      corporateActions: Object.freeze(actions.filter((item) => time(item.availableAt) <= closed)),
      cash: cash.toFixed(), quantity: quantity.toFixed(),
    };
    const signal = strategy(Object.freeze(context));
    if (!signal || !["BUY", "SELL", "HOLD"].includes(signal.action)) throw new ResearchError("INVALID_SIGNAL");
    if (signal.action === "BUY" && !decimal(signal.quantity, true).isInteger()) throw new ResearchError("INTEGER_QUANTITY_REQUIRED");
    pending = { signal: { ...signal }, decisionAt: bar.closedAt };
  }
  return {
    mode: "RESEARCH_ONLY", source: dataset.source, fills, trades, equity, rejected,
    metrics: metrics(equity, trades, initial, totalFees, totalNotional, exposedBars, time(bars[0].timestamp), config),
    finalCash: cash.toFixed(), finalQuantity: quantity.toFixed(), finalReceivables: outstanding().toFixed(),
    unexecutedFinalSignal: pending && pending.signal.action !== "HOLD" ? pending.signal : null,
  };
}

function finite(value: number): number | null { return Number.isFinite(value) ? value : null; }
function metrics(points: EquityPoint[], trades: ResearchTrade[], initial: Decimal, fees: Decimal, notional: Decimal, exposed: number, started: number, config: ResearchConfig): ResearchMetrics {
  const values = points.map((point) => new D(point.equity));
  const final = values[values.length - 1];
  const returns = values.map((value, index) => value.div(index ? values[index - 1] : initial).minus(1).toNumber());
  const riskFreePerPeriod = Math.pow(1 + config.annualRiskFreeRate, 1 / config.periodsPerYear) - 1;
  const excess = returns.map((value) => value - riskFreePerPeriod);
  const mean = excess.reduce((sum, value) => sum + value, 0) / excess.length;
  const variance = excess.length > 1 ? excess.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (excess.length - 1) : 0;
  const downside = Math.sqrt(excess.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / excess.length);
  let peak = initial; let drawdown = new D(0);
  values.forEach((value) => { peak = D.max(peak, value); drawdown = D.max(drawdown, peak.minus(value).div(peak)); });
  const pnls = trades.map((trade) => new D(trade.pnl));
  const wins = pnls.filter((pnl) => pnl.gt(0)); const losses = pnls.filter((pnl) => pnl.lt(0));
  const sum = (items: Decimal[]) => items.reduce((total, value) => total.plus(value), new D(0));
  const grossProfit = sum(wins); const grossLoss = sum(losses).abs();
  const years = (time(points[points.length - 1].timestamp) - started) / (365.25 * DAY);
  const averageEquity = sum(values).div(values.length);
  return {
    totalReturn: final.div(initial).minus(1).toNumber(),
    cagr: years > 0 && final.gt(0) ? finite(Math.pow(final.div(initial).toNumber(), 1 / years) - 1) : null,
    sharpe: variance > 0 && excess.length > 1 ? finite(mean / Math.sqrt(variance) * Math.sqrt(config.periodsPerYear)) : null,
    sortino: downside > 0 && excess.length > 1 ? finite(mean / downside * Math.sqrt(config.periodsPerYear)) : null,
    maxDrawdown: drawdown.toNumber(), profitFactor: grossLoss.gt(0) ? grossProfit.div(grossLoss).toNumber() : null,
    winRate: pnls.length ? wins.length / pnls.length : null,
    expectancy: pnls.length ? sum(pnls).div(pnls.length).toFixed() : null,
    averageWin: wins.length ? grossProfit.div(wins.length).toFixed() : null,
    averageLoss: losses.length ? sum(losses).div(losses.length).toFixed() : null,
    exposure: exposed / points.length, turnover: averageEquity.gt(0) ? notional.div(averageEquity).toNumber() : null,
    totalFees: fees.toFixed(),
  };
}

export interface TemporalPartitions { train: readonly ResearchBar[]; validation: readonly ResearchBar[]; outOfSample: readonly ResearchBar[]; trainCutoff: string; validationCutoff: string }
function frozenPartition(bars: readonly ResearchBar[]): readonly ResearchBar[] {
  const cutoff = time(bars[bars.length - 1].closedAt);
  if (bars.some((bar) => time(bar.availableAt) > cutoff)) throw new ResearchError("PARTITION_DATA_NOT_AVAILABLE");
  return Object.freeze(bars.map((bar) => Object.freeze({ ...bar, adjustedClose: null })));
}

/** Chronological holdout partitions. Fitting/selection must use train/validation only. */
export function temporalSplit(bars: readonly ResearchBar[], trainSize: number, validationSize: number): TemporalPartitions {
  validateBars(bars, Date.now()); periodCheck(trainSize); periodCheck(validationSize);
  if (trainSize + validationSize >= bars.length) throw new ResearchError("EMPTY_OUT_OF_SAMPLE");
  const train = frozenPartition(bars.slice(0, trainSize));
  const validation = frozenPartition(bars.slice(trainSize, trainSize + validationSize));
  const outOfSample = frozenPartition(bars.slice(trainSize + validationSize));
  return { train, validation, outOfSample, trainCutoff: train[train.length - 1].closedAt, validationCutoff: validation[validation.length - 1].closedAt };
}

export interface WalkForwardConfig { trainSize: number; validationSize: number; testSize: number; stepSize?: number; purgeBars?: number }
/** Rolling windows with non-overlapping test folds; purgeBars is the caller's label horizon. */
export function walkForward(bars: readonly ResearchBar[], config: WalkForwardConfig): TemporalPartitions[] {
  validateBars(bars, Date.now());
  periodCheck(config.trainSize); periodCheck(config.validationSize); periodCheck(config.testSize);
  const step = config.stepSize ?? config.testSize; const purge = config.purgeBars ?? 0;
  if (!Number.isSafeInteger(step) || step < config.testSize || !Number.isSafeInteger(purge) || purge < 0) throw new ResearchError("OVERLAPPING_TEST_WINDOWS");
  const windowSize = config.trainSize + config.validationSize + config.testSize + 2 * purge;
  const folds: TemporalPartitions[] = [];
  for (let start = 0; start + windowSize <= bars.length; start += step) {
    const validationStart = start + config.trainSize + purge;
    const testStart = validationStart + config.validationSize + purge;
    const train = frozenPartition(bars.slice(start, start + config.trainSize));
    const validation = frozenPartition(bars.slice(validationStart, validationStart + config.validationSize));
    const outOfSample = frozenPartition(bars.slice(testStart, testStart + config.testSize));
    folds.push({ train, validation, outOfSample, trainCutoff: train[train.length - 1].closedAt, validationCutoff: validation[validation.length - 1].closedAt });
  }
  if (!folds.length) throw new ResearchError("INSUFFICIENT_WALK_FORWARD_DATA");
  return folds;
}
