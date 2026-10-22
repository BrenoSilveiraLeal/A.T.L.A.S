import Decimal from "decimal.js";
import type { CorporateAction, ResearchBar, ResearchStrategy } from "./research";
import { sma } from "./research";
import type { CorporateEvent } from "./corporate-actions";

/**
 * Research adapter for the paper autopilot rule (SMA20/SMA50 trend with 8% stop), on
 * official raw B3 daily bars plus official corporate events. Point-in-time: the strategy
 * only sees bars closed by its decision and events already effective; orders fill at the
 * next open inside `runBacktest`. Standard lots of 100 shares, as in the B3 standard market.
 */
export interface DailyRow { date: string; open: string; high: string; low: string; close: string; volume: string }

// B3 trades 10:00–17:55 São Paulo (UTC-3). Daily bars become available at the close.
export function researchBars(rows: readonly DailyRow[]): ResearchBar[] {
  return rows.map((r) => ({
    timestamp: `${r.date}T13:00:00.000Z`, closedAt: `${r.date}T21:00:00.000Z`, availableAt: `${r.date}T21:00:00.000Z`,
    open: r.open, high: r.high, low: r.low, close: r.close, adjustedClose: null, volume: Number(r.volume),
  }));
}

/**
 * Converts official events to engine actions on the first trading day after the record
 * date ("data com"). Same-day cash events are merged (JCP net of 15% withholding); a cash
 * event on a split day is dropped and reported, since the engine needs one action per open.
 */
export function researchActions(events: readonly CorporateEvent[], bars: readonly ResearchBar[]) {
  const notes: string[] = [];
  const exOpen = (recordDate: string) => bars.find((b) => b.timestamp.slice(0, 10) > recordDate)?.timestamp ?? null;
  const first = bars[0]?.timestamp.slice(0, 10) ?? "";
  const splits = new Map<string, Decimal>();
  const cash = new Map<string, { amount: Decimal; payableAt: string }>();
  for (const e of events) {
    if (e.lastDatePrior < first) continue;
    const at = exOpen(e.lastDatePrior);
    if (!at) continue;
    if (e.kind === "CASH") {
      if (!e.paymentDate) continue;
      const payable = `${e.paymentDate}T13:00:00.000Z`;
      if (payable < at) { notes.push(`Pagamento anterior à data-ex ignorado: ${e.label} ${e.lastDatePrior}`); continue; }
      const net = new Decimal(e.value).times(/JRS|JUROS/.test(e.label) ? "0.85" : "1");
      const prev = cash.get(at);
      cash.set(at, { amount: (prev?.amount ?? new Decimal(0)).plus(net), payableAt: prev && prev.payableAt > payable ? prev.payableAt : payable });
    } else {
      const ratio = e.kind === "GROUPING" ? new Decimal(e.value) : new Decimal(e.value).div(100).plus(1);
      splits.set(at, (splits.get(at) ?? new Decimal(1)).times(ratio));
    }
  }
  const actions: CorporateAction[] = [];
  for (const [at, ratio] of splits) actions.push({ id: `split:${at}`, type: "SPLIT", effectiveAt: at, availableAt: at, ratio: ratio.toFixed() });
  for (const [at, c] of cash) {
    if (splits.has(at)) { notes.push(`Provento em dia de ajuste de ações omitido: ${at.slice(0, 10)}`); continue; }
    actions.push({ id: `cash:${at}`, type: "CASH_DIVIDEND", effectiveAt: at, availableAt: at, payableAt: c.payableAt, cashPerShare: c.amount.toFixed() });
  }
  return { actions: actions.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt)), notes };
}

/** Split-adjusted closes as known at decision time (later splits are unknown then). */
function adjustedCloses(bars: readonly ResearchBar[], actions: readonly CorporateAction[]) {
  const splits = actions.filter((a): a is Extract<CorporateAction, { type: "SPLIT" }> => a.type === "SPLIT");
  return bars.map((bar) => splits.filter((s) => s.effectiveAt > bar.timestamp)
    .reduce((price, s) => price.div(s.ratio), new Decimal(bar.close)).toFixed(8));
}

export function autopilotResearchStrategy(options = { stopLossPct: 8, lot: 100 }): ResearchStrategy {
  let entry: Decimal | null = null;
  let splitsSeen = 0;
  return (context) => {
    const bars = context.bars;
    const quantity = new Decimal(context.quantity);
    const splits = context.corporateActions.filter((a): a is Extract<CorporateAction, { type: "SPLIT" }> => a.type === "SPLIT");
    // Keep the stop reference in post-split terms.
    for (const split of splits.slice(splitsSeen)) if (entry) entry = entry.div(split.ratio);
    splitsSeen = splits.length;
    if (quantity.isZero()) entry = null;
    else if (!entry) entry = new Decimal(bars[bars.length - 1].open); // filled at this bar's open
    if (bars.length < 50) return { action: "HOLD" };
    const closes = adjustedCloses(bars, context.corporateActions);
    const fast = new Decimal(sma(closes, 20).at(-1)!), slow = new Decimal(sma(closes, 50).at(-1)!);
    const close = new Decimal(closes[closes.length - 1]);
    if (quantity.gt(0)) {
      const stopped = entry !== null && close.lte(entry.times(1 - options.stopLossPct / 100));
      return stopped || fast.lt(slow) ? { action: "SELL" } : { action: "HOLD" };
    }
    if (!(fast.gt(slow) && close.gt(fast))) return { action: "HOLD" };
    // Leave 2% for costs and an adverse open; whole standard lots only.
    const lots = new Decimal(context.cash).times(0.98).div(close.times(options.lot)).floor();
    return lots.gt(0) ? { action: "BUY", quantity: lots.times(options.lot).toFixed() } : { action: "HOLD" };
  };
}

export function buyAndHoldStrategy(lot = 100): ResearchStrategy {
  return (context) => {
    if (new Decimal(context.quantity).gt(0)) return { action: "HOLD" };
    const close = new Decimal(context.bars[context.bars.length - 1].close);
    const lots = new Decimal(context.cash).times(0.98).div(close.times(lot)).floor();
    return lots.gt(0) ? { action: "BUY", quantity: lots.times(lot).toFixed() } : { action: "HOLD" };
  };
}
