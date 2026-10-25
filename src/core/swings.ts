/**
 * The main rises and falls of a price series (zigzag): a new leg starts when the price turns by
 * at least `minPct` from the last extreme. Used to list, next to the chart, how much the stock
 * rose or fell and between which dates. Pure.
 */
export interface Swing { from: { date: string; price: number }; to: { date: string; price: number }; change: number }

export function swings(points: readonly { date: string; close: number }[], minPct = 8): Swing[] {
  if (points.length < 2) return [];
  const legs: Swing[] = [];
  let start = points[0], extreme = points[0], direction: 1 | -1 | 0 = 0;
  for (const p of points.slice(1)) {
    if (direction >= 0 && p.close >= extreme.close) { extreme = p; if (!direction && p.close / start.close - 1 >= minPct / 100) direction = 1; continue; }
    if (direction <= 0 && p.close <= extreme.close) { extreme = p; if (!direction && 1 - p.close / start.close >= minPct / 100) direction = -1; continue; }
    const turn = direction >= 0 ? 1 - p.close / extreme.close : p.close / extreme.close - 1;
    if (turn >= minPct / 100) {
      if (Math.abs(extreme.close / start.close - 1) >= minPct / 100)
        legs.push({ from: { date: start.date, price: start.close }, to: { date: extreme.date, price: extreme.close }, change: extreme.close / start.close - 1 });
      start = extreme; extreme = p; direction = direction >= 0 ? -1 : 1;
    }
  }
  if (Math.abs(extreme.close / start.close - 1) >= minPct / 100)
    legs.push({ from: { date: start.date, price: start.close }, to: { date: extreme.date, price: extreme.close }, change: extreme.close / start.close - 1 });
  return legs;
}
