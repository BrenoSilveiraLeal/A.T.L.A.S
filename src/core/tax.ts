import Decimal from "decimal.js";
import { saoPauloClock } from "./b3-calendar";

/**
 * Monthly Brazilian income-tax estimate for B3 cash equities (pessoa física).
 * Rules in force in 2026 (MP 1.303/2025 was not converted into law):
 * - Swing ("operações comuns"): 15%; gains exempt when the month's swing sales are ≤ R$ 20.000.
 * - Day trade (buy and sell of the same asset on the same day): 20%, no exemption.
 * - Losses carry forward within the same kind only. IRRF: 0,005% of swing sales, 1% of day-trade gain.
 * - DARF code 6015; amounts below R$ 10 accumulate to the next month.
 * Fractional tickers (suffix F) are the same asset as the standard ticker.
 * This is an estimate for the owner and an accountant, never a filed declaration.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export const TAX_RULES = { swingRate: "0.15", dayTradeRate: "0.20", swingExemptSales: "20000",
  swingIrrf: "0.00005", dayTradeIrrf: "0.01", darfMinimum: "10", darfCode: "6015" } as const;

export interface TaxFill {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: string;
  fees: string;
  executedAt: string;
}

export interface TaxMonth {
  month: string;
  swingSales: string;
  swingResult: string;
  swingExempt: boolean;
  dayTradeResult: string;
  swingLossCarry: string;
  dayTradeLossCarry: string;
  taxDue: string;
  irrfEstimate: string;
  darf: string;
  carriedTax: string;
  darfDueDate: string | null;
  shortSaleDetected: boolean;
}

export class TaxError extends Error {
  constructor(readonly code: string) { super(code); }
}

const baseSymbol = (symbol: string) => symbol.replace(/F$/, "");
const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);

export function estimateMonthlyTax(fills: readonly TaxFill[]): TaxMonth[] {
  const sorted = [...fills].sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
  const position = new Map<string, { quantity: Decimal; cost: Decimal }>();
  const months = new Map<string, { swingSales: Decimal; swingResult: Decimal; dayTradeResult: Decimal; short: boolean }>();
  // Group by São Paulo trading day and asset: day trade is decided per day, not per fill.
  const days = new Map<string, TaxFill[]>();
  for (const fill of sorted) {
    if (!Number.isSafeInteger(fill.quantity) || fill.quantity <= 0 || !(new D(fill.price).gt(0)) || new D(fill.fees).lt(0) ||
      Number.isNaN(Date.parse(fill.executedAt))) throw new TaxError("INVALID_FILL");
    const key = `${saoPauloClock(new Date(fill.executedAt)).date}|${baseSymbol(fill.symbol)}`;
    days.set(key, [...(days.get(key) ?? []), fill]);
  }
  for (const [key, dayFills] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [date, symbol] = key.split("|");
    const month = date.slice(0, 7);
    const bucket = months.get(month) ?? { swingSales: new D(0), swingResult: new D(0), dayTradeResult: new D(0), short: false };
    months.set(month, bucket);
    const side = (s: "BUY" | "SELL") => dayFills.filter((f) => f.side === s).reduce((t, f) => ({
      quantity: t.quantity.plus(f.quantity), gross: t.gross.plus(new D(f.price).times(f.quantity)), fees: t.fees.plus(f.fees),
    }), { quantity: new D(0), gross: new D(0), fees: new D(0) });
    const buy = side("BUY"), sell = side("SELL");
    // Per-share net values: buy fees raise cost, sell fees lower proceeds.
    const buyUnit = buy.quantity.gt(0) ? buy.gross.plus(buy.fees).div(buy.quantity) : new D(0);
    const sellUnit = sell.quantity.gt(0) ? sell.gross.minus(sell.fees).div(sell.quantity) : new D(0);
    const sellPrice = sell.quantity.gt(0) ? sell.gross.div(sell.quantity) : new D(0);
    const matched = D.min(buy.quantity, sell.quantity);
    bucket.dayTradeResult = bucket.dayTradeResult.plus(sellUnit.minus(buyUnit).times(matched));
    const held = position.get(symbol) ?? { quantity: new D(0), cost: new D(0) };
    const extraBuy = buy.quantity.minus(matched), extraSell = sell.quantity.minus(matched);
    if (extraBuy.gt(0)) {
      held.quantity = held.quantity.plus(extraBuy);
      held.cost = held.cost.plus(buyUnit.times(extraBuy));
    }
    if (extraSell.gt(0)) {
      if (extraSell.gt(held.quantity)) { bucket.short = true; throw new TaxError("SHORT_SALE_UNSUPPORTED"); }
      const average = held.cost.div(held.quantity);
      bucket.swingSales = bucket.swingSales.plus(sellPrice.times(extraSell));
      bucket.swingResult = bucket.swingResult.plus(sellUnit.minus(average).times(extraSell));
      held.cost = held.cost.minus(average.times(extraSell));
      held.quantity = held.quantity.minus(extraSell);
      if (held.quantity.isZero()) held.cost = new D(0);
    }
    position.set(symbol, held);
  }

  let swingCarry = new D(0), dayCarry = new D(0), pending = new D(0);
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
    const exempt = m.swingSales.lte(TAX_RULES.swingExemptSales) && m.swingResult.gt(0);
    let swingTaxable = new D(0);
    if (m.swingResult.lt(0)) swingCarry = swingCarry.plus(m.swingResult.neg());
    else if (!exempt) {
      const used = D.min(swingCarry, m.swingResult);
      swingCarry = swingCarry.minus(used);
      swingTaxable = m.swingResult.minus(used);
    }
    let dayTaxable = new D(0);
    if (m.dayTradeResult.lt(0)) dayCarry = dayCarry.plus(m.dayTradeResult.neg());
    else {
      const used = D.min(dayCarry, m.dayTradeResult);
      dayCarry = dayCarry.minus(used);
      dayTaxable = m.dayTradeResult.minus(used);
    }
    const tax = swingTaxable.times(TAX_RULES.swingRate).plus(dayTaxable.times(TAX_RULES.dayTradeRate));
    const irrf = m.swingSales.times(TAX_RULES.swingIrrf).plus(D.max(m.dayTradeResult, 0).times(TAX_RULES.dayTradeIrrf));
    const owed = D.max(tax.minus(irrf), 0).plus(pending);
    const payable = owed.toDecimalPlaces(2).gte(TAX_RULES.darfMinimum);
    pending = payable ? new D(0) : owed;
    return {
      month, swingSales: money(m.swingSales), swingResult: money(m.swingResult), swingExempt: exempt,
      dayTradeResult: money(m.dayTradeResult), swingLossCarry: money(swingCarry), dayTradeLossCarry: money(dayCarry),
      taxDue: money(tax), irrfEstimate: money(irrf), darf: payable ? money(owed) : "0.00", carriedTax: money(pending),
      darfDueDate: payable ? lastWeekdayOfNextMonth(month) : null, shortSaleDetected: m.short,
    };
  });
}

/** Last business day of the following month, ignoring holidays (confirm before paying). */
export function lastWeekdayOfNextMonth(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, mon + 1, 0)); // day 0 of month+2 = last day of month+1
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
