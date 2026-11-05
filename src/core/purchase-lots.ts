import Decimal from "decimal.js";

export interface PurchaseFill {
  side: string; quantity: number; price: string | number; fee: string | number; executed_at: string;
}

/** Historical purchases grouped by actual execution price, with fees kept separate. */
export function purchaseLots(fills: readonly PurchaseFill[]) {
  const groups = new Map<string, { quantity: number; price: string; fees: Decimal; firstAt: string; lastAt: string }>();
  for (const fill of fills) {
    if (fill.side !== "BUY") continue;
    const price = new Decimal(fill.price), fee = new Decimal(fill.fee);
    if (!price.isFinite() || price.lte(0) || !fee.isFinite() || fee.lt(0) || !Number.isSafeInteger(fill.quantity) || fill.quantity <= 0)
      throw new Error("INVALID_PURCHASE_FILL");
    const key = price.toString();
    const group = groups.get(key) ?? { quantity: 0, price: key, fees: new Decimal(0), firstAt: fill.executed_at, lastAt: fill.executed_at };
    group.quantity += fill.quantity;
    group.fees = group.fees.plus(fee);
    group.firstAt = group.firstAt < fill.executed_at ? group.firstAt : fill.executed_at;
    group.lastAt = group.lastAt > fill.executed_at ? group.lastAt : fill.executed_at;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(a.price) - Number(b.price)).map((g) => ({
    ...g, fees: g.fees.toFixed(2), total: new Decimal(g.price).times(g.quantity).plus(g.fees).toFixed(2),
  }));
}
