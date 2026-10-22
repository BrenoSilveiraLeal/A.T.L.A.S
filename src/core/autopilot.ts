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
  slippageBps: number;
  stopLossPct: number;
  /** Rule-based context; it can only brake: block buys, halve size or force an exit. */
  context?: { action: ContextAction; summary: string };
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
  const closes = bars.map((bar) => bar.close);
  const fast = closes.length >= 50 ? sma(closes, 20).at(-1)! : null;
  const slow = closes.length >= 50 ? sma(closes, 50).at(-1)! : null;
  const indicators = { sma20: fast, sma50: slow, price: price.toFixed(2) };
  const hold = (reason: string): AutopilotDecision => ({ action: "HOLD", reason: `${input.ticker}: ${reason}`, indicators });
  if (input.hasOpenOrder) return hold("ordem virtual aberta aguardando preenchimento.");
  const sellAll = (why: string): AutopilotDecision => ({ action: "SELL", quantity: input.position.quantity,
    limitPrice: D.max(toTick(price.times(1 - (input.slippageBps + LIMIT_BUFFER_BPS) / 10000), tick, "down"), tick).toFixed(2),
    referencePrice: price.toDecimalPlaces(2).toFixed(2), indicators,
    reason: `${input.ticker}: venda virtual automática (${why}). Regra ${AUTOPILOT_VERSION}, simulação.` });
  if (input.context?.action === "EXIT" && input.position.quantity > 0) return sellAll(`contexto: ${input.context.summary}`);
  if (!fast || !slow) return hold(`histórico de ${closes.length} pregões; são necessários 50 para SMA20/SMA50.`);
  const trend = `SMA20 ${new D(fast).toFixed(2)} / SMA50 ${new D(slow).toFixed(2)}, preço ${price.toFixed(2)}`;
  const referencePrice = price.toDecimalPlaces(2).toFixed(2);
  const buffer = (input.slippageBps + LIMIT_BUFFER_BPS) / 10000;

  if (input.position.quantity > 0) {
    const average = new D(input.position.averageCost);
    const stop = average.times(1 - input.stopLossPct / 100);
    const exit = price.lte(stop) ? `stop de ${input.stopLossPct}% sobre custo ${average.toFixed(2)}`
      : new D(fast).lt(slow) ? "tendência virou para baixo" : null;
    if (!exit) return hold(`mantém posição; ${trend}.`);
    return sellAll(`${exit}; ${trend}`);
  }
  if (!(new D(fast).gt(slow) && price.gt(fast))) return hold(`sem sinal de entrada; ${trend}.`);
  if (input.context?.action === "BLOCK_BUY" || input.context?.action === "EXIT")
    return hold(`sinal de compra bloqueado pelo contexto: ${input.context.summary}`);
  const limit = toTick(price.times(1 + buffer), tick, "up");
  const fullRoom = D.min(new D(input.budgetRoom), new D(input.maxOrderValue), new D(input.availableCash));
  const room = input.context?.action === "REDUCE" ? fullRoom.div(2) : fullRoom;
  const perShare = limit.times(1 + input.feeBps / 10000);
  const lots = room.lte(0) ? 0 : room.div(perShare.times(input.lotSize)).floor().toNumber();
  // Order value is checked against the limit price, which is what the risk review uses.
  const quantity = Math.min(lots * input.lotSize, 1000000);
  if (quantity < input.lotSize || limit.times(quantity).gt(input.maxOrderValue))
    return hold(`sinal de compra, mas orçamento/caixa virtual não cobre um lote a ${limit.toFixed(2)}.`);
  return { action: "BUY", quantity, limitPrice: limit.toFixed(2), referencePrice, indicators,
    reason: `${input.ticker}: compra virtual automática (tendência de alta${input.context?.action === "REDUCE" ? `, tamanho reduzido à metade: ${input.context.summary}` : ""}); ${trend}. Regra ${AUTOPILOT_VERSION}, simulação.` };
}
