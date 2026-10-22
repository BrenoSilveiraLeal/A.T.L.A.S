/**
 * Portfolio rotation research ("as IAs escolhem as mais fortes"): every `rebalanceEvery`
 * sessions, rank stocks by `lookback`-session return and hold the top `top` in equal
 * weights, optionally only those above their `trendPeriod` average and with positive
 * momentum. Decided at the close, executed at the next open, integer shares, costs in bps
 * on traded value. Prices must be split-adjusted; cash dividends are ignored (also in the
 * buy-and-hold benchmark). Research only.
 */
export interface SeriesBar { date: string; open: number; close: number }
export interface RotationOptions {
  lookback: number; top: number; rebalanceEvery: number; trendPeriod: number; absoluteMomentum: boolean;
  costBps: number; initial: number;
}
export interface RotationResult {
  equity: { date: string; value: number }[];
  totalReturn: number; maxDrawdown: number; trades: number; byYear: Record<string, number>;
}

export const ROTATION_DEFAULTS: RotationOptions = { lookback: 126, top: 3, rebalanceEvery: 21, trendPeriod: 200, absoluteMomentum: true, costBps: 13, initial: 100000 };

function summarize(equity: { date: string; value: number }[], initial: number, trades: number): RotationResult {
  let peak = initial, maxDrawdown = 0;
  const byYear: Record<string, number> = {};
  let yearStart = initial, year = equity[0]?.date.slice(0, 4);
  for (const point of equity) {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.max(maxDrawdown, 1 - point.value / peak);
    const y = point.date.slice(0, 4);
    if (y !== year) { yearStart = equity[equity.indexOf(point) - 1].value; year = y; }
    byYear[y] = point.value / yearStart - 1;
  }
  const last = equity.at(-1)?.value ?? initial;
  return { equity, totalReturn: last / initial - 1, maxDrawdown, trades, byYear };
}

export function runRotation(series: Record<string, readonly SeriesBar[]>, options: RotationOptions = ROTATION_DEFAULTS): RotationResult {
  const dates = [...new Set(Object.values(series).flatMap((bars) => bars.map((b) => b.date)))].sort();
  const index: Record<string, Map<string, number>> = Object.fromEntries(
    Object.entries(series).map(([ticker, bars]) => [ticker, new Map(bars.map((b, i) => [b.date, i]))]));
  const lastClose = (ticker: string, d: number) => {
    for (let k = d; k >= 0; k--) { const i = index[ticker].get(dates[k]); if (i !== undefined) return series[ticker][i].close; }
    return null;
  };
  let cash = options.initial, trades = 0;
  const shares: Record<string, number> = {};
  let pending: string[] | null = null;
  const equity: { date: string; value: number }[] = [];
  const minHistory = Math.max(options.lookback, options.trendPeriod);
  for (let d = 0; d < dates.length; d++) {
    const date = dates[d];
    if (pending) {
      // Execute yesterday's decision at today's open.
      const target = pending; pending = null;
      const open = (t: string) => { const i = index[t].get(date); return i === undefined ? null : series[t][i].open; };
      for (const t of Object.keys(shares)) {
        const price = open(t);
        if (!target.includes(t) && shares[t] > 0 && price) { cash += shares[t] * price * (1 - options.costBps / 1e4); shares[t] = 0; trades++; }
      }
      const value = cash + Object.entries(shares).reduce((s, [t, q]) => s + q * (open(t) ?? lastClose(t, d - 1) ?? 0), 0);
      const slot = target.length ? value / target.length : 0;
      for (const t of target) {
        const price = open(t);
        if (!price) continue;
        const current = (shares[t] ?? 0) * price;
        const delta = Math.floor((slot - current) / (price * (1 + options.costBps / 1e4)));
        if (delta > 0 && delta * price * (1 + options.costBps / 1e4) <= cash) { cash -= delta * price * (1 + options.costBps / 1e4); shares[t] = (shares[t] ?? 0) + delta; trades++; }
        else if (delta < 0) { cash += -delta * price * (1 - options.costBps / 1e4); shares[t] += delta; trades++; }
      }
    }
    const value = cash + Object.entries(shares).reduce((s, [t, q]) => s + q * (lastClose(t, d) ?? 0), 0);
    equity.push({ date, value });
    if (d >= minHistory && (d - minHistory) % options.rebalanceEvery === 0) {
      const scores: [string, number][] = [];
      for (const [ticker, bars] of Object.entries(series)) {
        const i = index[ticker].get(date);
        if (i === undefined || i < minHistory) continue;
        const momentum = bars[i].close / bars[i - options.lookback].close - 1;
        if (options.absoluteMomentum && momentum <= 0) continue;
        if (options.trendPeriod) {
          const average = bars.slice(i - options.trendPeriod + 1, i + 1).reduce((s, b) => s + b.close, 0) / options.trendPeriod;
          if (bars[i].close <= average) continue;
        }
        scores.push([ticker, momentum]);
      }
      pending = scores.sort((a, b) => b[1] - a[1]).slice(0, options.top).map(([t]) => t);
    }
  }
  return summarize(equity, options.initial, trades);
}

/** Equal-weight buy-and-hold of every stock from its first common open. */
export function runEqualWeightHold(series: Record<string, readonly SeriesBar[]>, options: Pick<RotationOptions, "costBps" | "initial"> = ROTATION_DEFAULTS): RotationResult {
  const tickers = Object.keys(series);
  const start = tickers.map((t) => series[t][0].date).sort().at(-1)!;
  let cash = options.initial;
  const shares: Record<string, number> = {};
  for (const t of tickers) {
    const bar = series[t].find((b) => b.date >= start)!;
    const quantity = Math.floor(options.initial / tickers.length / (bar.open * (1 + options.costBps / 1e4)));
    shares[t] = quantity;
    cash -= quantity * bar.open * (1 + options.costBps / 1e4);
  }
  const dates = [...new Set(tickers.flatMap((t) => series[t].map((b) => b.date)))].filter((d) => d >= start).sort();
  const last: Record<string, number> = {};
  const equity = dates.map((date) => {
    for (const t of tickers) { const bar = series[t].find((b) => b.date === date); if (bar) last[t] = bar.close; }
    return { date, value: cash + tickers.reduce((s, t) => s + shares[t] * (last[t] ?? 0), 0) };
  });
  return summarize(equity, options.initial, tickers.length);
}
