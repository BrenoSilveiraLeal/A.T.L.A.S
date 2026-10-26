/**
 * Owner's rule (25/10/2026): "comprar na baixa, vender na alta" — and only then; days without a
 * purchase are fine. The agent watches the lowest and highest closes of the last `window`
 * sessions:
 * - BUYS only when the price is within `buyZonePct` of that low, the fall has turned into a rise
 *   (owner, 26/10/2026: "enquanto estiver caindo, não compra; quando começar a subir, compra" —
 *   `confirmBuy` with `turnPct`) and, with `minUpShare`, the stock's own history agrees (most past
 *   visits to the low were followed by a rise over 3 months). Holding already, it buys more only
 *   after a new dip below the average price (`rebuyBelowAvgPct`) and a new turn;
 * - SELLS everything only when the price is within `nearPct` of that high, the rise has stopped
 *   (with `confirmSell`: below the previous close) and never below what it paid plus fees.
 * Otherwise it waits. Pure: the caller passes the closes (oldest first, adjusted), the price now,
 * the position and, optionally, the history near the low (core/forecast nearLowHistory).
 */
export interface RangeOptions {
  window: number; nearPct: number; minGainPct: number; confirmBuy: boolean; confirmSell: boolean; minUpShare: number;
  /** Buy zone: up to this % above the 6-month low (defaults to nearPct). */
  buyZonePct?: number;
  /** With confirmBuy, the turn: price up today and at least turnPct above the lowest close of the last turnLookback sessions. */
  turnPct?: number; turnLookback?: number;
  /** Holding already: buy more only after the price fell this % below the average price (a new dip, then a new turn). */
  rebuyBelowAvgPct?: number;
}
// Chosen on B3 history 2023–2026: the history filter helps a little and waiting for the rise to stop
// sells closer to the top (docs/BACKTEST_ACUMULAR.md); buying up to 5% above the low after a 1% turn,
// re-buying only 3% below the average, matched or beat the 2% rule in every period on 50 stocks
// (docs/BACKTEST_VIRADA.md).
export const RANGE_DEFAULTS: RangeOptions = { window: 126, nearPct: 2, minGainPct: 3, confirmBuy: true, confirmSell: true, minUpShare: 0.6,
  buyZonePct: 5, turnPct: 1, turnLookback: 10, rebuyBelowAvgPct: 3 };
export const RANGE_VERSION = "paper-autopilot-range-6m-turn/3.0.0";

export interface RangeInput {
  closes: readonly number[]; price: number; quantity: number; cost: number; cash: number; minOrder: number;
  history?: { samples: number; upShare: number; average: number } | null;
}
export type RangeDecision =
  | { action: "BUY" | "SELL" | "HOLD"; reason: string; low: number; high: number; buyBelow: number; sellAbove: number };

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function rangeLevels(closes: readonly number[], o: Pick<RangeOptions, "window" | "nearPct" | "buyZonePct"> = RANGE_DEFAULTS) {
  const recent = closes.slice(-o.window);
  if (recent.length < Math.min(o.window, 40)) return null;
  const low = Math.min(...recent), high = Math.max(...recent);
  return { low, high, buyBelow: low * (1 + (o.buyZonePct ?? o.nearPct) / 100), sellAbove: high * (1 - o.nearPct / 100) };
}

/**
 * Has the fall turned into a rise? The bottom is the lowest close of the last `turnLookback`
 * sessions; the turn needs the price above yesterday's close and `turnPct` above that bottom.
 */
export function turnState(closes: readonly number[], price: number, o: Pick<RangeOptions, "turnPct" | "turnLookback"> = RANGE_DEFAULTS) {
  const recent = closes.slice(-(o.turnLookback ?? 10));
  const bottom = Math.min(price, ...recent), previous = closes[closes.length - 1];
  const rise = bottom > 0 ? price / bottom - 1 : 0;
  return { bottom, rise, turned: previous !== undefined && price > previous && rise * 100 >= (o.turnPct ?? 0) };
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
    if (o.confirmBuy) {
      const t = turnState(i.closes, i.price, o);
      if (!t.turned) return { action: "HOLD", ...base, reason: previous && i.price <= previous
        ? `perto da mínima de ${months} meses, mas ainda caindo (${brl(i.price)}): espera a queda parar e virar para cima`
        : `perto da mínima e parou de cair, mas ainda não virou: compra quando passar de ${brl(t.bottom * (1 + (o.turnPct ?? 0) / 100))} subindo` };
    }
    if (i.quantity > 0 && o.rebuyBelowAvgPct !== undefined && i.price > (i.cost / i.quantity) * (1 - o.rebuyBelowAvgPct / 100))
      return { action: "HOLD", ...base, reason: `já tem ${i.quantity} (preço médio ${brl(i.cost / i.quantity)}): compra mais só se cair abaixo de ${brl((i.cost / i.quantity) * (1 - o.rebuyBelowAvgPct / 100))} e virar de novo` };
    const h = i.history;
    if (h && !historyAgrees(h, o))
      return { action: "HOLD", ...base, reason: `perto da mínima, mas nas ${h.samples} vezes anteriores subiu só em ${Math.round(h.upShare * 100)}% (média ${(h.average * 100).toFixed(0)}%): não vale a pena` };
    if (i.cash < i.minOrder) return { action: "HOLD", ...base, reason: `preço bom (${brl(i.price)}, perto da mínima de ${brl(low)}), mas falta dinheiro para comprar` };
    return { action: "BUY", ...base, reason: o.confirmBuy
      ? `${brl(i.price)} ainda está perto da mínima de ${months} meses (${brl(low)}), a queda parou e já virou para cima: compra na baixa`
      : `${brl(i.price)} está perto da mínima de ${months} meses (${brl(low)}): compra na baixa` };
  }
  return { action: "HOLD", ...base, reason: i.quantity > 0
    ? `segurando: vende perto da máxima (a partir de ${brl(sellAbove)}); compra mais se cair até ${brl(buyBelow)}`
    : `esperando o preço cair até perto da mínima de ${months} meses: compra a partir de ${brl(buyBelow)} (agora ${brl(i.price)})` };
}
