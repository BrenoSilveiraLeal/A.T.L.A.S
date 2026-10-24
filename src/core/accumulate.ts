/**
 * "Acumular na baixa, vender na alta" (owner's strategy, 24/10/2026).
 * The agent keeps receiving its share of the monthly contribution and:
 * - BUYS only when the stock is cheap: at least `dipPct` below its 52-week high and, when it
 *   already holds shares, at least `averageDownPct` below its own average price (so every new
 *   purchase lowers the average). With `confirm`, it waits for the first up-day after a fall
 *   instead of catching a falling knife. Each order needs at least `minOrder` (brokerage < 1%).
 * - SELLS everything only when the gain over the average price (fees included) reaches
 *   `targetPct` AND the price has already turned down `turnPct` from its best close since the
 *   first purchase: it rides the rise and leaves near the top. Never below the price paid.
 * Pure function: the caller supplies closes (oldest first, split-adjusted) and the position.
 */
export interface AccumulateOptions {
  dipPct: number; averageDownPct: number; targetPct: number; turnPct: number; confirm: boolean; minOrder: number;
}
export const ACCUMULATE_DEFAULTS: AccumulateOptions = { dipPct: 15, averageDownPct: 5, targetPct: 40, turnPct: 8, confirm: true, minOrder: 100 };
export const ACCUMULATE_VERSION = "accumulate-dips/1.0.0";

export interface AccumulateInput {
  closes: readonly number[];
  price: number;
  /** Shares held and what they cost in total, fees included. */
  quantity: number; cost: number;
  /** Money the agent may still spend. */
  cash: number;
  /** Best close since the first purchase of the current position (null without position). */
  peakSinceEntry: number | null;
}
export type AccumulateDecision =
  | { action: "BUY"; spend: number; reason: string }
  | { action: "SELL"; reason: string }
  | { action: "HOLD"; reason: string };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function accumulateDecision(input: AccumulateInput, o: AccumulateOptions = ACCUMULATE_DEFAULTS): AccumulateDecision {
  const { closes, price, quantity, cost, cash } = input;
  if (closes.length < 60 || !(price > 0)) return { action: "HOLD", reason: "histórico curto demais para saber o que é barato" };
  const yearHigh = Math.max(...closes.slice(-252), price);
  const drop = 1 - price / yearHigh;
  const average = quantity > 0 ? cost / quantity : null;
  if (quantity > 0 && average !== null) {
    const gain = price / average - 1;
    const peak = Math.max(input.peakSinceEntry ?? price, price);
    const turned = 1 - price / peak;
    if (gain >= o.targetPct / 100 && turned >= o.turnPct / 100)
      return { action: "SELL", reason: `lucro de ${pct(gain)} sobre o preço médio e a ação já virou ${pct(turned)} do topo: vende na alta` };
    if (gain >= o.targetPct / 100) return { action: "HOLD", reason: `lucro de ${pct(gain)}; ainda subindo, segura até virar` };
  }
  const cheap = drop >= o.dipPct / 100;
  const belowAverage = average === null || price <= average * (1 - o.averageDownPct / 100);
  // First up-day after the fall: today above yesterday's close.
  const bounced = !o.confirm || price > closes[closes.length - 1];
  if (cash < o.minOrder) return { action: "HOLD", reason: `juntando dinheiro (tem R$ ${cash.toFixed(2)}, compra a partir de R$ ${o.minOrder})` };
  if (!cheap) return { action: "HOLD", reason: `não está barata: só ${pct(drop)} abaixo da máxima de 1 ano (compra a partir de ${o.dipPct}%)` };
  if (!belowAverage) return { action: "HOLD", reason: `barata, mas não abaixo do preço médio já pago (R$ ${average!.toFixed(2)})` };
  if (!bounced) return { action: "HOLD", reason: "ainda caindo: espera o primeiro dia de alta para comprar" };
  return { action: "BUY", spend: cash, reason: `${pct(drop)} abaixo da máxima de 1 ano${average ? ` e abaixo do preço médio (R$ ${average.toFixed(2)})` : ""}: compra na baixa` };
}
