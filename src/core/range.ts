/**
 * Owner's rule (25/10/2026): "comprar na baixa, vender na alta" literally. The agent watches the
 * lowest and highest closes of the last `window` sessions:
 * - BUYS only when the price comes within `nearPct` of that low (and it has the money);
 * - SELLS everything only when the price comes within `nearPct` of that high, and never below
 *   what it paid plus fees (`minGainPct` over the average price).
 * Otherwise it waits. Pure: the caller passes the closes (oldest first, adjusted), the price now
 * and the position.
 */
export interface RangeOptions { window: number; nearPct: number; minGainPct: number }
// 6 months and 2%: the best of 9 variants on B3 history 2023–2026 (docs/BACKTEST_ACUMULAR.md).
export const RANGE_DEFAULTS: RangeOptions = { window: 126, nearPct: 2, minGainPct: 3 };
export const RANGE_VERSION = "paper-autopilot-range-6m-2pct/1.0.0";

export interface RangeInput { closes: readonly number[]; price: number; quantity: number; cost: number; cash: number; minOrder: number }
export type RangeDecision =
  | { action: "BUY" | "SELL" | "HOLD"; reason: string; low: number; high: number; buyBelow: number; sellAbove: number };

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function rangeLevels(closes: readonly number[], o: RangeOptions = RANGE_DEFAULTS) {
  const recent = closes.slice(-o.window);
  if (recent.length < Math.min(o.window, 40)) return null;
  const low = Math.min(...recent), high = Math.max(...recent);
  return { low, high, buyBelow: low * (1 + o.nearPct / 100), sellAbove: high * (1 - o.nearPct / 100) };
}

export function rangeDecision(i: RangeInput, o: RangeOptions = RANGE_DEFAULTS): RangeDecision {
  const levels = rangeLevels(i.closes, o);
  const months = Math.round(o.window / 21);
  if (!levels || !(i.price > 0)) return { action: "HOLD", reason: "histórico curto demais para saber o que é preço baixo", low: 0, high: 0, buyBelow: 0, sellAbove: 0 };
  const { low, high, buyBelow, sellAbove } = levels;
  const base = { low, high, buyBelow, sellAbove };
  if (i.quantity > 0) {
    const average = i.cost / i.quantity, floor = average * (1 + o.minGainPct / 100);
    if (i.price >= sellAbove && i.price >= floor)
      return { action: "SELL", ...base, reason: `${brl(i.price)} chegou perto da máxima de ${months} meses (${brl(high)}) e está acima do que pagou (${brl(average)}): vende na alta` };
    if (i.price >= sellAbove)
      return { action: "HOLD", ...base, reason: `perto da máxima, mas ${brl(i.price)} não paga o que custou (${brl(floor)} com taxas): segura` };
  }
  if (i.price <= buyBelow) {
    if (i.cash < i.minOrder) return { action: "HOLD", ...base, reason: `preço bom (${brl(i.price)}, perto da mínima de ${brl(low)}), mas falta dinheiro para comprar` };
    return { action: "BUY", ...base, reason: `${brl(i.price)} está perto da mínima de ${months} meses (${brl(low)}): compra na baixa` };
  }
  return { action: "HOLD", ...base, reason: i.quantity > 0
    ? `segurando: vende perto da máxima (a partir de ${brl(sellAbove)}); compra mais se cair até ${brl(buyBelow)}`
    : `esperando o preço cair até perto da mínima de ${months} meses: compra a partir de ${brl(buyBelow)} (agora ${brl(i.price)})` };
}
