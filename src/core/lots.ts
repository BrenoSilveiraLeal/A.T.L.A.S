import Decimal from "decimal.js";
/**
 * B3 cash-equity order split confirmed by Genial (22/10/2026): standard symbols trade in
 * lots of 100; quantities of 1 to 99 go to the fractional symbol (suffix "F").
 * 137 PETR4 → 100 PETR4 + 37 PETR4F. Each leg is a separate order.
 */
export interface OrderLeg { symbol: string; quantity: number }

export function splitLots(ticker: string, quantity: number, roundLot = 100): OrderLeg[] {
  if (!/^[A-Z][A-Z0-9]{3}\d{1,2}$/.test(ticker)) throw new Error("INVALID_TICKER");
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
  const standard = Math.floor(quantity / roundLot) * roundLot;
  const fractional = quantity - standard;
  return [
    ...(standard ? [{ symbol: ticker, quantity: standard }] : []),
    ...(fractional ? [{ symbol: `${ticker}F`, quantity: fractional }] : []),
  ];
}

/**
 * Genial shows the standard and fractional legs as separate positions (PETR4 and PETR4F,
 * confirmed 23/10/2026). ATLAS keeps one position per ticker, so the legs are summed with a
 * quantity-weighted average price before reconciliation. The latest observation time wins.
 */
export function mergeFractionalPositions<T extends { symbol: string; quantity: number; averagePrice: string; observedAt: string }>(positions: readonly T[]): T[] {
  const merged = new Map<string, T>();
  for (const p of positions) {
    const symbol = /^[A-Z][A-Z0-9]{3}\d{1,2}F$/.test(p.symbol) ? p.symbol.slice(0, -1) : p.symbol;
    const prev = merged.get(symbol);
    if (!prev) { merged.set(symbol, { ...p, symbol }); continue; }
    const quantity = prev.quantity + p.quantity;
    const cost = new Decimal(prev.averagePrice).times(prev.quantity).plus(new Decimal(p.averagePrice).times(p.quantity));
    merged.set(symbol, { ...prev, quantity, averagePrice: quantity ? cost.div(quantity).toDecimalPlaces(8).toString() : "0",
      observedAt: prev.observedAt > p.observedAt ? prev.observedAt : p.observedAt });
  }
  return [...merged.values()];
}
