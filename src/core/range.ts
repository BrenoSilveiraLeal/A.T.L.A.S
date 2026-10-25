/**
 * Owner's rule (25/10/2026): "comprar na baixa, vender na alta" — and only then; days without a
 * purchase are fine. The agent watches the lowest and highest closes of the last `window`
 * sessions:
 * - BUYS only when the price is within `nearPct` of that low, the fall has stopped (with
 *   `confirmBuy`: the price is above the previous close) and, with `minUpShare`, the stock's own
 *   history agrees (most past visits to the low were followed by a rise over 3 months);
 * - SELLS everything only when the price is within `nearPct` of that high, the rise has stopped
 *   (with `confirmSell`: below the previous close) and never below what it paid plus fees.
 * Otherwise it waits. Pure: the caller passes the closes (oldest first, adjusted), the price now,
 * the position and, optionally, the history near the low (core/forecast nearLowHistory).
 */
export interface RangeOptions { window: number; nearPct: number; minGainPct: number; confirmBuy: boolean; confirmSell: boolean; minUpShare: number }
// Chosen on B3 history 2023–2026 (docs/BACKTEST_ACUMULAR.md): the history filter helps a little and
// waiting for the rise to stop sells closer to the top; waiting for the fall to stop missed buys.
export const RANGE_DEFAULTS: RangeOptions = { window: 126, nearPct: 2, minGainPct: 3, confirmBuy: false, confirmSell: true, minUpShare: 0.6 };
export const RANGE_VERSION = "paper-autopilot-range-6m-2pct/2.0.0";

export interface RangeInput {
  closes: readonly number[]; price: number; quantity: number; cost: number; cash: number; minOrder: number;
  history?: { samples: number; upShare: number; average: number } | null;
}
export type RangeDecision =
  | { action: "BUY" | "SELL" | "HOLD"; reason: string; low: number; high: number; buyBelow: number; sellAbove: number };

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function rangeLevels(closes: readonly number[], o: Pick<RangeOptions, "window" | "nearPct"> = RANGE_DEFAULTS) {
  const recent = closes.slice(-o.window);
  if (recent.length < Math.min(o.window, 40)) return null;
  const low = Math.min(...recent), high = Math.max(...recent);
  return { low, high, buyBelow: low * (1 + o.nearPct / 100), sellAbove: high * (1 - o.nearPct / 100) };
}

/** The stock's history near the low agrees with buying (or there is too little history to say). */
export function historyAgrees(h: { samples: number; upShare: number; average: number } | null | undefined, o: RangeOptions = RANGE_DEFAULTS) {
  return !(o.minUpShare > 0 && h && h.samples >= 3 && (h.upShare < o.minUpShare || h.average <= 0));
}

export function rangeDecision(i: RangeInput, o: RangeOptions = RANGE_DEFAULTS): RangeDecision {
  const levels = rangeLevels(i.closes, o);
  const months = Math.round(o.window / 21);
  if (!levels || !(i.price > 0)) return { action: "HOLD", reason: "histórico curto demais para saber o que é preço baixo", low: 0, high: 0, buyBelow: 0, sellAbove: 0 };
  const { low, high, buyBelow, sellAbove } = levels;
  const base = { low, high, buyBelow, sellAbove };
  const previous = i.closes[i.closes.length - 1];
  if (i.quantity > 0) {
    const average = i.cost / i.quantity, floor = average * (1 + o.minGainPct / 100);
    if (i.price >= sellAbove && i.price >= floor) {
      if (o.confirmSell && previous && i.price >= previous)
        return { action: "HOLD", ...base, reason: `perto da máxima de ${months} meses e ainda subindo (${brl(i.price)}): segura até a alta parar` };
      return { action: "SELL", ...base, reason: `${brl(i.price)} chegou perto da máxima de ${months} meses (${brl(high)}), a alta parou e está acima do que pagou (${brl(average)}): vende na alta` };
    }
    if (i.price >= sellAbove)
      return { action: "HOLD", ...base, reason: `perto da máxima, mas ${brl(i.price)} não paga o que custou (${brl(floor)} com taxas): segura` };
  }
  if (i.price <= buyBelow) {
    if (o.confirmBuy && previous && i.price <= previous)
      return { action: "HOLD", ...base, reason: `perto da mínima de ${months} meses, mas ainda caindo (${brl(i.price)}): espera a queda parar` };
    const h = i.history;
    if (h && !historyAgrees(h, o))
      return { action: "HOLD", ...base, reason: `perto da mínima, mas nas ${h.samples} vezes anteriores subiu só em ${Math.round(h.upShare * 100)}% (média ${(h.average * 100).toFixed(0)}%): não vale a pena` };
    if (i.cash < i.minOrder) return { action: "HOLD", ...base, reason: `preço bom (${brl(i.price)}, perto da mínima de ${brl(low)}), mas falta dinheiro para comprar` };
    return { action: "BUY", ...base, reason: `${brl(i.price)} está perto da mínima de ${months} meses (${brl(low)}) e a queda parou: compra na baixa` };
  }
  return { action: "HOLD", ...base, reason: i.quantity > 0
    ? `segurando: vende perto da máxima (a partir de ${brl(sellAbove)}); compra mais se cair até ${brl(buyBelow)}`
    : `esperando o preço cair até perto da mínima de ${months} meses: compra a partir de ${brl(buyBelow)} (agora ${brl(i.price)})` };
}
