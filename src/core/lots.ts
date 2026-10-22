/**
 * B3 cash-equity order split confirmed by Genial (22/10/2026): standard symbols trade in
 * lots of 100; quantities of 1 to 99 go to the fractional symbol (suffix "F").
 * 137 PETR4 → 100 PETR4 + 37 PETR4F. Each leg is a separate order.
 */
export interface OrderLeg { symbol: string; quantity: number }

export function splitLots(ticker: string, quantity: number, roundLot = 100): OrderLeg[] {
  if (!/^[A-Z]{4}\d{1,2}$/.test(ticker)) throw new Error("INVALID_TICKER");
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("INVALID_QUANTITY");
  const standard = Math.floor(quantity / roundLot) * roundLot;
  const fractional = quantity - standard;
  return [
    ...(standard ? [{ symbol: ticker, quantity: standard }] : []),
    ...(fractional ? [{ symbol: `${ticker}F`, quantity: fractional }] : []),
  ];
}
