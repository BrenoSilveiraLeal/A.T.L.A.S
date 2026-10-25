import { accumulateDecision, type AccumulateOptions } from "./accumulate";
import { rangeDecision, type RangeOptions } from "./range";

/**
 * Research simulation of a monthly-contribution plan on one stock: money arrives on the first
 * session of each month, decisions use the close, orders fill at the next open with Genial's
 * fractional brokerage (R$ 0,99), B3 fees, spread and slippage. Cash dividends are credited on
 * the ex-date. Idle cash earns nothing (it sits in the broker account).
 */
export interface SimBar { date: string; open: number; close: number }
export interface SimDividend { date: string; perShare: number }
export type SimRule = { kind: "accumulate"; options: AccumulateOptions } | { kind: "monthly" } | { kind: "range"; options: RangeOptions };
export interface SimResult { deposited: number; finalValue: number; gain: number; trades: number; worstDrop: number }

const FIXED = 0.99, VARIABLE = (3 + 10 + 5) / 10000;

export function simulatePlan(bars: readonly SimBar[], dividends: readonly SimDividend[], monthly: number, rule: SimRule, minOrder = 100): SimResult {
  let cash = 0, shares = 0, cost = 0, deposited = 0, trades = 0, peak: number | null = null, worstDrop = 0, bestValue = 0;
  let pending: { side: "BUY"; spend: number } | { side: "SELL" } | null = null;
  const closes: number[] = [];
  const divByDate = new Map(dividends.map((d) => [d.date, d.perShare]));
  let month = "";
  for (const bar of bars) {
    if (bar.date.slice(0, 7) !== month) { month = bar.date.slice(0, 7); cash += monthly; deposited += monthly; }
    if (pending) {
      const price = bar.open * (pending.side === "BUY" ? 1 + VARIABLE : 1 - VARIABLE);
      if (pending.side === "BUY") {
        const quantity = Math.floor((Math.min(pending.spend, cash) - FIXED) / price);
        if (quantity > 0) { const paid = quantity * price + FIXED; cash -= paid; cost += paid; shares += quantity; trades++; peak ??= bar.close; }
      } else if (shares > 0) {
        cash += shares * price - FIXED; shares = 0; cost = 0; peak = null; trades++;
      }
      pending = null;
    }
    const perShare = divByDate.get(bar.date);
    if (perShare && shares > 0) cash += shares * perShare;
    if (shares > 0) peak = Math.max(peak ?? bar.close, bar.close);
    const value = cash + shares * bar.close;
    bestValue = Math.max(bestValue, value - deposited);
    if (shares > 0 && cost > 0) worstDrop = Math.max(worstDrop, 1 - (shares * bar.close) / cost);
    if (rule.kind === "range") {
      const decision = rangeDecision({ closes: [...closes, bar.close], price: bar.close, quantity: shares, cost, cash, minOrder }, rule.options);
      if (decision.action === "BUY") pending = { side: "BUY", spend: cash };
      if (decision.action === "SELL") pending = { side: "SELL" };
    } else if (rule.kind === "monthly") {
      if (cash >= minOrder) pending = { side: "BUY", spend: cash };
    } else if (closes.length >= 60) {
      const decision = accumulateDecision({ closes, price: bar.close, quantity: shares, cost, cash, peakSinceEntry: peak }, rule.options);
      if (decision.action === "BUY") pending = { side: "BUY", spend: decision.spend };
      if (decision.action === "SELL") pending = { side: "SELL" };
    }
    closes.push(bar.close);
  }
  const last = bars.at(-1)?.close ?? 0;
  const finalValue = cash + shares * last;
  return { deposited, finalValue, gain: deposited ? finalValue / deposited - 1 : 0, trades, worstDrop };
}

/**
 * The whole team as one wallet: every month the contribution goes to the `picks` stocks that are
 * furthest below their 1-year high (orders of at least `minOrder`), so money is never idle and
 * always lands on what is cheapest. A position is sold only after `targetPct` of gain and a
 * `turnPct` turn from its top (never at a loss); the money goes back to the pot.
 */
export function simulateTeamPlan(
  series: ReadonlyMap<string, { bars: readonly SimBar[]; dividends: readonly SimDividend[] }>,
  monthly: number, picks: number, targetPct: number, turnPct = 8, minOrder = 100,
): SimResult {
  const dates = [...new Set([...series.values()].flatMap((s) => s.bars.map((b) => b.date)))].sort();
  const state = new Map([...series].map(([t, s]) => [t, {
    byDate: new Map(s.bars.map((b) => [b.date, b])), divs: new Map(s.dividends.map((d) => [d.date, d.perShare])),
    closes: [] as number[], shares: 0, cost: 0, peak: 0, pending: null as null | { side: "BUY"; spend: number } | { side: "SELL" },
  }]));
  let cash = 0, deposited = 0, trades = 0, month = "", worstDrop = 0;
  for (const date of dates) {
    if (date.slice(0, 7) !== month) { month = date.slice(0, 7); cash += monthly; deposited += monthly; }
    for (const s of state.values()) {
      const bar = s.byDate.get(date);
      if (!bar) continue;
      if (s.pending?.side === "BUY") {
        const price = bar.open * (1 + VARIABLE);
        const quantity = Math.floor((Math.min(s.pending.spend, cash) - FIXED) / price);
        if (quantity > 0) { const paid = quantity * price + FIXED; cash -= paid; s.cost += paid; s.shares += quantity; trades++; s.peak = Math.max(s.peak, bar.close); }
      } else if (s.pending?.side === "SELL" && s.shares > 0) {
        cash += s.shares * bar.open * (1 - VARIABLE) - FIXED; s.shares = 0; s.cost = 0; s.peak = 0; trades++;
      }
      s.pending = null;
      const perShare = s.divs.get(date);
      if (perShare && s.shares > 0) cash += s.shares * perShare;
      if (s.shares > 0) { s.peak = Math.max(s.peak, bar.close); worstDrop = Math.max(worstDrop, 1 - (s.shares * bar.close) / s.cost); }
      if (s.shares > 0 && bar.close / (s.cost / s.shares) - 1 >= targetPct / 100 && 1 - bar.close / s.peak >= turnPct / 100) s.pending = { side: "SELL" };
      s.closes.push(bar.close);
    }
    const ranked = [...state.values()]
      .filter((s) => s.byDate.has(date) && s.closes.length >= 60 && !s.pending)
      .map((s) => ({ s, drop: 1 - s.closes[s.closes.length - 1] / Math.max(...s.closes.slice(-252)) }))
      .sort((a, b) => b.drop - a.drop);
    const count = Math.min(picks, Math.floor(cash / minOrder), ranked.length);
    for (const { s } of ranked.slice(0, count)) s.pending = { side: "BUY", spend: cash / count };
  }
  const value = cash + [...state.values()].reduce((sum, s) => sum + s.shares * (s.closes.at(-1) ?? 0), 0);
  return { deposited, finalValue: value, gain: deposited ? value / deposited - 1 : 0, trades, worstDrop };
}

/** The same deposits kept in the CDI (daily rates in % from BCB SGS 12, keyed by date). */
export function simulateCdi(dates: readonly string[], cdiDaily: ReadonlyMap<string, number>, monthly: number) {
  let value = 0, deposited = 0, month = "";
  for (const date of dates) {
    if (date.slice(0, 7) !== month) { month = date.slice(0, 7); value += monthly; deposited += monthly; }
    value *= 1 + (cdiDaily.get(date) ?? 0) / 100;
  }
  return { deposited, finalValue: value, gain: deposited ? value / deposited - 1 : 0 };
}
