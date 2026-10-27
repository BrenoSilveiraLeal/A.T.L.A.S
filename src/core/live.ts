import Decimal from "decimal.js";

/**
 * Real-money sizing at Genial. Orders are one leg (standard lot of 100 or 1-99 on the "F"
 * symbol), IOC, priced a little through the live book so they fill now or not at all.
 * Brokerage: R$ 2,99 standard / R$ 0,99 fractional per order, plus B3 ~0,03%.
 */
export const LIVE = { bufferBps: 30, b3Bps: 3, lotFee: 2.99, fractionFee: 0.99, minOrder: 40, maxQuoteAgeMs: 60_000, maxDeviation: 0.03 } as const;

const D = Decimal.clone({ rounding: Decimal.ROUND_HALF_EVEN });
const tick = (v: Decimal, mode: "up" | "down") => v.toDecimalPlaces(2, mode === "up" ? Decimal.ROUND_UP : Decimal.ROUND_DOWN);

export function liveFee(value: number, quantity: number) {
  const b3 = Math.ceil(value * LIVE.b3Bps / 10000 * 100) / 100;
  return b3 + (quantity >= 100 ? LIVE.lotFee : 0) + (quantity % 100 ? LIVE.fractionFee : 0);
}

/** Largest single-leg buy that fits the room and the order cap, or why there is none. */
export function sizeLiveBuy(room: number, maxOrder: number, ask: string): { quantity: number; limit: string } | { skip: string } {
  const limit = tick(new D(ask).times(1 + LIVE.bufferBps / 10000), "up");
  const perShare = limit.times(1 + LIVE.b3Bps / 10000);
  const budget = Math.min(room, maxOrder + LIVE.fractionFee);
  const lots = Math.floor(new D(budget - LIVE.lotFee).div(perShare.times(100)).toNumber());
  const quantity = lots >= 1 && limit.times(lots * 100).lte(maxOrder) ? lots * 100
    : Math.min(99, Math.floor(new D(budget - LIVE.fractionFee).div(perShare).toNumber()));
  if (quantity <= 0) return { skip: `dinheiro da IA (R$ ${room.toFixed(2)}) não paga nem 1 ação a R$ ${limit.toFixed(2)}` };
  if (limit.times(quantity).gt(maxOrder)) return { skip: "acima do valor máximo por ordem" };
  if (limit.times(quantity).lt(LIVE.minOrder)) return { skip: `ordem de R$ ${limit.times(quantity).toFixed(2)} pequena demais: a corretagem passaria de 2,5%` };
  return { quantity, limit: limit.toFixed(2) };
}

/** Next sell leg for a held position (standard lots first, then the fractional rest). */
export function sizeLiveSell(held: number, bid: string): { quantity: number; limit: string } | null {
  if (held <= 0) return null;
  const limit = tick(new D(bid).times(1 - LIVE.bufferBps / 10000), "down");
  return { quantity: held >= 100 ? Math.floor(held / 100) * 100 : held, limit: limit.toFixed(2) };
}

/** Quote usable for a real order: both sides, fresh, and close to the simulation's price. */
export function quoteProblem(quote: { bid: string | null; ask: string | null; quotedAt: string }, reference: string | null, now: number): string | null {
  if (!quote.bid || !quote.ask) return "sem oferta no livro agora";
  if (now - Date.parse(quote.quotedAt) > LIVE.maxQuoteAgeMs) return "cotação do MetaTrader atrasada";
  if (reference && Math.abs(Number(quote.ask) / Number(reference) - 1) > LIVE.maxDeviation)
    return `preço do MetaTrader (R$ ${quote.ask}) muito diferente da simulação (R$ ${reference})`;
  return null;
}

/** Tickers where Genial shows fewer shares than ATLAS bought (the owner's own extras are fine). */
export function custodyShortfalls(atlas: Record<string, number>, broker: readonly { symbol: string; quantity: number }[]) {
  return Object.entries(atlas).filter(([ticker, qty]) => qty > (broker.find((p) => p.symbol === ticker)?.quantity ?? 0))
    .map(([ticker, qty]) => ({ ticker, atlas: qty, broker: broker.find((p) => p.symbol === ticker)?.quantity ?? 0 }));
}

/**
 * What the agent should do with real money now, from its latest autopilot decision:
 * enter only on a fresh BUY (default 20 min) with no position and not yet mirrored; leave on
 * any SELL while shares remain (later legs and IOC leftovers included).
 */
export function liveIntent(latest: { id: string; side: "BUY" | "SELL"; placedAt: string } | null, held: number, mirrored: boolean, now: number, windowMs = 20 * 60000): "BUY" | "SELL" | null {
  if (!latest) return null;
  if (latest.side === "SELL") return held > 0 ? "SELL" : null;
  return held === 0 && !mirrored && now - Date.parse(latest.placedAt) <= windowMs ? "BUY" : null;
}

/** Bridge errors raised before anything reaches the broker; everything else may have been sent. */
const NOT_SENT = new Set(["EXECUTION_DISABLED", "GATEWAY_HALTED", "ORDER_IDENTITY_MISMATCH", "UNSUPPORTED_ORDER_TERMS", "USE_FRACTIONAL_SYMBOL",
  "USE_STANDARD_LOT_SYMBOL", "LIMIT_DAY_NOT_SUPPORTED", "ORDER_CHECK_REJECTED", "ORDER_REJECTED", "DAY_TRADE_ENVIRONMENT_SUBMIT_UNSUPPORTED",
  "UNAPPROVED_INSTRUMENT", "INSTRUMENT_NOT_VERIFIED_B3_CASH_EQUITY",
  // 27/10/2026: MetaTrader's "Algo Trading" switch off; checked before order_send, so nothing left.
  "TERMINAL_TRADING_DISABLED",
  // 27/10/2026: order_check failed in the terminal, before anything was sent.
  "ORDER_CHECK_FAILED"]);
/** The terminal refused because automatic trading is switched off: the owner's switch, not the agent's fault. */
export const TRADING_SWITCH_OFF = "TERMINAL_TRADING_DISABLED";
export const sendOutcome = (code: string): "REJECTED" | "UNKNOWN" => (NOT_SENT.has(code) ? "REJECTED" : "UNKNOWN");

/**
 * "Never sell at a loss": the lowest sell price per share that gives back everything paid
 * (cost already includes the buy fees) after the sell's brokerage and B3 fees, plus a margin.
 * Owner, 27/10/2026: "se o lucro for de R$ 3, vendi por zero" — the margin is net profit after both
 * fees, 3% of what was paid (was 0,5%).
 */
export function minimumSellPrice(cost: number, quantity: number, marginPct = 3): string {
  const fixed = (quantity >= 100 ? LIVE.lotFee : 0) + (quantity % 100 ? LIVE.fractionFee : 0);
  const price = ((cost + fixed) / (quantity * (1 - LIVE.b3Bps / 10000))) * (1 + marginPct / 100);
  return (Math.ceil(price * 100 - 1e-9) / 100).toFixed(2);
}
