import Decimal from "decimal.js";
import type { MarketHistory, MarketQuote } from "@/providers/types";
import { sma } from "./research";
import type { ContextAction } from "./context";

/**
 * Deterministic paper-only rule. It is not a validated strategy and never feeds live
 * execution: its proposals go to paper_review_proposal, which applies the paper risk limits.
 * Long-only: enter when SMA20 > SMA50 and price > SMA20; exit on SMA20 < SMA50 or stop loss.
 */
export const AUTOPILOT_VERSION = "paper-autopilot-sma20x50/1.0.0";
/**
 * Best rule in the 2023–2026 official backtest (docs/BACKTEST_STRATEGIES.md), still below
 * CDI and buy-and-hold: hold; sell after a 15% fall from the highest close since entry;
 * re-enter on a new 20-day closing high. The first entry is immediate.
 */
export const TRAILING_VERSION = "paper-autopilot-trailing15/1.0.0";
/**
 * Owner's rule (24/10/2026): "comprar na baixa, vender na alta" done the way that held up on
 * B3 history 2023–2026 (docs/BACKTEST_ACUMULAR.md): the agent buys with every share of the
 * monthly contribution as soon as it has R$ 100 (fixed money buys more shares when the price is
 * low, which lowers the average), holds through falls, and sells everything only after a big
 * gain over its average (`targetPct`) once the price has turned `turnPct` down from its top.
 * Never at a loss. The only rule tested that beat the CDI in both 2023–24 and 2025–26.
 */
export const STEADY_VERSION = "paper-autopilot-monthly-sell-high/1.0.0";
const D = Decimal.clone({ precision: 32, rounding: Decimal.ROUND_HALF_EVEN });
const LIMIT_BUFFER_BPS = 20;

export interface AutopilotInput {
  ticker: string;
  quote: MarketQuote;
  history: MarketHistory;
  now: string;
  position: { quantity: number; averageCost: string };
  hasOpenOrder: boolean;
  /** Agent budget minus its current cost basis and pending buy reservations. */
  budgetRoom: string;
  maxOrderValue: string;
  availableCash: string;
  lotSize: number;
  tickSize: string;
  feeBps: number;
  /**
   * Genial brokerage per order (swing, no RLP): R$ 2,99 standard lot + R$ 0,99 fractional.
   * Worst case for one buy is both legs; the order is skipped when it is too small for the fee.
   */
  fixedFee?: number;
  minOrderValue?: number;
  /** Owner rule: never sell below this price (what was paid plus fees and a small margin). */
  minSellPrice?: string;
  slippageBps: number;
  stopLossPct: number;
  /** Rule-based context; it can only brake: block buys, halve size or force an exit. */
  context?: { action: ContextAction; summary: string };
  /**
   * Trailing-stop rule inputs from the long adjusted history: highest close since the
   * current position was opened (null without position), highest close of the prior
   * 20 sessions and whether this agent ever held the asset.
   */
  trailing?: { peak: string | null; priorHigh: string; everHeld: boolean; trailPct: number };
  /** Owner's monthly rule: highest close since the position was opened and the sell trigger. */
  steady?: { peak: string | null; targetPct: number; turnPct: number };
}

export function ruleVersion(input: Pick<AutopilotInput, "steady" | "trailing">) {
  return input.steady ? STEADY_VERSION : input.trailing ? TRAILING_VERSION : AUTOPILOT_VERSION;
}

export type AutopilotDecision =
  | { action: "HOLD"; reason: string; indicators: Record<string, string | null> }
  | { action: "BUY" | "SELL"; quantity: number; limitPrice: string; referencePrice: string; reason: string;
      indicators: Record<string, string | null> };

export class AutopilotError extends Error {
  constructor(readonly code: string) { super(code); }
}

function toTick(value: Decimal, tick: Decimal, direction: "up" | "down") {
  const steps = value.div(tick);
  return (direction === "up" ? steps.ceil() : steps.floor()).times(tick);
}

export function autopilotDecision(input: AutopilotInput): AutopilotDecision {
  const now = Date.parse(input.now);
  const bars = input.history.bars;
  if (input.quote.ticker !== input.ticker || input.history.ticker !== input.ticker)
    throw new AutopilotError("ASSET_MISMATCH");
  const quoteAt = Date.parse(input.quote.dataTimestamp), retrievedAt = Date.parse(input.history.retrievedAt);
  if (!Number.isFinite(now) || !Number.isFinite(quoteAt) || !Number.isFinite(retrievedAt) ||
    quoteAt > now || quoteAt < now - 72 * 3600000 || retrievedAt > now || retrievedAt < now - 24 * 3600000)
    throw new AutopilotError("STALE_MARKET_DATA");
  if (bars.length && Date.parse(bars[bars.length - 1].timestamp) < now - 7 * 86400000)
    throw new AutopilotError("STALE_HISTORY_BARS");
  const tick = new D(input.tickSize), price = new D(input.quote.price);
  if (!price.isFinite() || price.lte(0) || !tick.isFinite() || tick.lte(0) || !Number.isSafeInteger(input.lotSize) || input.lotSize < 1)
    throw new AutopilotError("INVALID_PRICE");
  // Split/dividend-adjusted closes keep the averages continuous across corporate actions.
  const closes = bars.map((bar) => bar.adjustedClose ?? bar.close);
  const fast = closes.length >= 50 ? sma(closes, 20).at(-1)! : null;
  const slow = closes.length >= 50 ? sma(closes, 50).at(-1)! : null;
  const indicators = { sma20: fast, sma50: slow, price: price.toFixed(2) };
  const hold = (reason: string): AutopilotDecision => ({ action: "HOLD", reason: `${input.ticker}: ${reason}`, indicators });
  if (input.hasOpenOrder) return hold("ordem virtual aberta aguardando preenchimento.");
  const sellAll = (why: string): AutopilotDecision => {
    const limit = D.max(toTick(price.times(1 - (input.slippageBps + LIMIT_BUFFER_BPS) / 10000), tick, "down"), tick);
    if (input.minSellPrice && limit.lt(input.minSellPrice))
      return hold(`queria vender (${why}), mas R$ ${limit.toFixed(2)} fica abaixo do que pagou com as taxas (mínimo R$ ${input.minSellPrice}). Segura até subir.`);
    return { action: "SELL", quantity: input.position.quantity, limitPrice: limit.toFixed(2),
      referencePrice: price.toDecimalPlaces(2).toFixed(2), indicators,
      reason: `${input.ticker}: venda virtual automática (${why}). Regra ${ruleVersion(input)}, simulação.` };
  };
  if (input.context?.action === "EXIT" && input.position.quantity > 0) return sellAll(`contexto: ${input.context.summary}`);
  const buy = (why: string): AutopilotDecision => {
    if (input.context?.action === "BLOCK_BUY" || input.context?.action === "EXIT")
      return hold(`sinal de compra bloqueado pelo contexto: ${input.context.summary}`);
    const limit = toTick(price.times(1 + (input.slippageBps + LIMIT_BUFFER_BPS) / 10000), tick, "up");
    const fullRoom = D.min(new D(input.budgetRoom), new D(input.maxOrderValue), new D(input.availableCash)).minus(input.fixedFee ?? 0);
    const room = input.context?.action === "REDUCE" ? fullRoom.div(2) : fullRoom;
    const perShare = limit.times(1 + input.feeBps / 10000);
    const lots = room.lte(0) ? 0 : room.div(perShare.times(input.lotSize)).floor().toNumber();
    // Order value is checked against the limit price, which is what the risk review uses.
    const quantity = Math.min(lots * input.lotSize, 1000000);
    if (quantity < input.lotSize || limit.times(quantity).gt(input.maxOrderValue))
      return hold(`sinal de compra, mas orçamento/caixa virtual não cobre um lote a ${limit.toFixed(2)}.`);
    if (input.minOrderValue && limit.times(quantity).lt(input.minOrderValue))
      return hold(`sinal de compra, mas a ordem (R$ ${limit.times(quantity).toFixed(2)}) é pequena demais: a corretagem pesaria mais de 1%. Espera juntar pelo menos R$ ${input.minOrderValue.toFixed(2)}.`);
    return { action: "BUY", quantity, limitPrice: limit.toFixed(2), referencePrice: price.toDecimalPlaces(2).toFixed(2), indicators,
      reason: `${input.ticker}: compra virtual automática (${why}${input.context?.action === "REDUCE" ? `, tamanho reduzido à metade: ${input.context.summary}` : ""}). Regra ${ruleVersion(input)}, simulação.` };
  };
  if (input.steady) {
    const st = input.steady;
    if (input.position.quantity > 0) {
      const average = new D(input.position.averageCost);
      const peak = D.max(new D(st.peak ?? price), price);
      const gain = price.div(average).minus(1), turned = new D(1).minus(price.div(peak));
      if (gain.gte(st.targetPct / 100) && turned.gte(st.turnPct / 100))
        return sellAll(`subiu ${gain.times(100).toFixed(1)}% sobre o preço médio e já virou ${turned.times(100).toFixed(1)}% do topo de R$ ${peak.toFixed(2)}: vende na alta`);
      const room = new D(input.budgetRoom);
      if (room.gte(input.minOrderValue ?? 0) && room.gt(0)) return buy(`parte do aporte mensal: acumula mais ações (preço médio R$ ${average.toFixed(2)}, agora R$ ${price.toFixed(2)})`);
      return hold(gain.gte(st.targetPct / 100)
        ? `lucro de ${gain.times(100).toFixed(1)}%; ainda subindo, segura até virar ${st.turnPct}% do topo.`
        : `segurando e juntando o aporte; vende só com +${st.targetPct}% sobre o preço médio (R$ ${average.times(1 + st.targetPct / 100).toFixed(2)}) depois de virar ${st.turnPct}% do topo.`);
    }
    if (new D(input.budgetRoom).gte(input.minOrderValue ?? 0)) return buy("parte do aporte mensal: começa a acumular");
    return hold(`juntando o aporte mensal até ter R$ ${(input.minOrderValue ?? 0).toFixed(2)} para comprar.`);
  }
  if (input.trailing) {
    const t = input.trailing;
    if (input.position.quantity > 0) {
      const peak = D.max(new D(t.peak ?? price), price);
      const stop = peak.times(1 - t.trailPct / 100);
      if (price.lte(stop)) return sellAll(`caiu ${t.trailPct}% do topo de R$ ${peak.toFixed(2)} desde a compra`);
      return hold(`mantém posição; topo desde a compra R$ ${peak.toFixed(2)}, vende se cair a R$ ${stop.toFixed(2)}.`);
    }
    if (!t.everHeld) return buy("primeira entrada da regra de segurar com stop móvel");
    if (price.gt(t.priorHigh)) return buy(`nova máxima de 20 pregões acima de R$ ${new D(t.priorHigh).toFixed(2)}`);
    return hold(`fora da ação desde o stop; volta a comprar acima da máxima de 20 pregões (R$ ${new D(t.priorHigh).toFixed(2)}).`);
  }
  if (!fast || !slow) return hold(`histórico de ${closes.length} pregões; são necessários 50 para SMA20/SMA50.`);
  const trend = `SMA20 ${new D(fast).toFixed(2)} / SMA50 ${new D(slow).toFixed(2)}, preço ${price.toFixed(2)}`;

  if (input.position.quantity > 0) {
    const average = new D(input.position.averageCost);
    const stop = average.times(1 - input.stopLossPct / 100);
    const exit = price.lte(stop) ? `stop de ${input.stopLossPct}% sobre custo ${average.toFixed(2)}`
      : new D(fast).lt(slow) ? "tendência virou para baixo" : null;
    if (!exit) return hold(`mantém posição; ${trend}.`);
    return sellAll(`${exit}; ${trend}`);
  }
  if (!(new D(fast).gt(slow) && price.gt(fast))) return hold(`sem sinal de entrada; ${trend}.`);
  return buy(`tendência de alta; ${trend}`);
}

/**
 * Flags a probable split, reverse split or bonus issue: a raw price jump above 30% that
 * the adjusted series does not show, or a live quote far from the last close. Virtual
 * positions keep pre-event cost, so marking them would fake a gain or loss (and could
 * eliminate an agent). Callers pause marking and trading and alert the owner.
 */
export function corporateActionSuspected(history: MarketHistory, quotePrice: string, knownEventDates: readonly string[] = []): string | null {
  // A jump within 6 days after an official record date is explained by that event.
  const explained = (day: string) => knownEventDates.some((d) => day > d && Date.parse(day) - Date.parse(d) <= 6 * 86400000);
  const bars = history.bars.slice(-11);
  for (let i = 1; i < bars.length; i++) {
    if (explained(bars[i].timestamp.slice(0, 10))) continue;
    const raw = Number(bars[i].close) / Number(bars[i - 1].close) - 1;
    const previousAdjusted = bars[i - 1].adjustedClose, adjusted = bars[i].adjustedClose;
    const adjustedMove = previousAdjusted && adjusted ? Number(adjusted) / Number(previousAdjusted) - 1 : raw;
    if (Math.abs(raw) > 0.3 && Math.abs(adjustedMove) < 0.1)
      return `${history.ticker}: preço bruto variou ${(raw * 100).toFixed(0)}% em ${bars[i].timestamp.slice(0, 10)} sem variação equivalente no preço ajustado (provável desdobramento/grupamento/bonificação).`;
  }
  const last = bars.at(-1);
  if (last && !explained(new Date().toISOString().slice(0, 10))) {
    const gap = Number(quotePrice) / Number(last.close) - 1;
    if (Math.abs(gap) > 0.3)
      return `${history.ticker}: cotação ${quotePrice} difere ${(gap * 100).toFixed(0)}% do último fechamento ${last.close} (possível evento corporativo ou dado inconsistente).`;
  }
  return null;
}

