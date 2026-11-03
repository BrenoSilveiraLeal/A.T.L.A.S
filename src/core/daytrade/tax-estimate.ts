import Decimal from "decimal.js";
import { saoPauloClock } from "@/core/b3-calendar";

/** Paper-only estimate from already closed simulated futures trades. Never use for filing or payment. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);

export interface PaperTaxFill {
  action: "ENTRY" | "EXIT";
  bar_at: string;
  reason: string;
  net_pnl: string | number | null;
}

export interface PaperTaxMonth {
  month: string;
  closedTrades: number;
  dayTradeResult: string;
  taxableAfterPaperLosses: string;
  paperLossCarry: string;
  estimatedTax: string;
  estimatedIrrfEquivalent: string;
  excludedOvernightCloses: number;
  excludedOvernightResult: string;
}

/**
 * Groups net EXIT results by São Paulo date, applies same-modality loss carry from the first
 * available paper month and calculates reference rates only. The caller must disclose that fills
 * do not prove real broker execution, withholding, prior losses, fees or tax eligibility.
 */
export function estimatePaperFuturesTax(
  fills: readonly PaperTaxFill[],
  rates: { dayTradeRate: number; withholdingRate: number },
): PaperTaxMonth[] {
  const dayRate = new D(rates.dayTradeRate), withholdingRate = new D(rates.withholdingRate);
  if (!dayRate.isFinite() || dayRate.lt(0) || dayRate.gt(1) || !withholdingRate.isFinite() || withholdingRate.lt(0) || withholdingRate.gt(1))
    throw new Error("INVALID_TAX_RATE");

  const days = new Map<string, { result: Decimal; trades: number; overnight: Decimal; overnightTrades: number }>();
  for (const fill of fills) {
    if (fill.action !== "EXIT" || fill.net_pnl === null) continue;
    const instant = Date.parse(fill.bar_at);
    const result = new D(fill.net_pnl);
    if (!Number.isFinite(instant) || !result.isFinite()) throw new Error("INVALID_PAPER_FILL");
    const date = saoPauloClock(new Date(instant)).date;
    const bucket = days.get(date) ?? { result: new D(0), trades: 0, overnight: new D(0), overnightTrades: 0 };
    if (fill.reason === "DAY_BOUNDARY_FLAT") {
      bucket.overnight = bucket.overnight.plus(result);
      bucket.overnightTrades += 1;
    } else {
      bucket.result = bucket.result.plus(result);
      bucket.trades += 1;
    }
    days.set(date, bucket);
  }

  const months = new Map<string, { result: Decimal; positiveDailyResults: Decimal; trades: number; overnight: Decimal; overnightTrades: number }>();
  for (const [date, daily] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const month = date.slice(0, 7);
    const bucket = months.get(month) ?? { result: new D(0), positiveDailyResults: new D(0), trades: 0, overnight: new D(0), overnightTrades: 0 };
    bucket.result = bucket.result.plus(daily.result);
    bucket.positiveDailyResults = bucket.positiveDailyResults.plus(D.max(daily.result, 0));
    bucket.trades += daily.trades;
    bucket.overnight = bucket.overnight.plus(daily.overnight);
    bucket.overnightTrades += daily.overnightTrades;
    months.set(month, bucket);
  }

  let paperLossCarry = new D(0);
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => {
    let taxable = new D(0);
    if (value.result.lt(0)) paperLossCarry = paperLossCarry.plus(value.result.neg());
    else {
      const applied = D.min(paperLossCarry, value.result);
      paperLossCarry = paperLossCarry.minus(applied);
      taxable = value.result.minus(applied);
    }
    return {
      month,
      closedTrades: value.trades,
      dayTradeResult: money(value.result),
      taxableAfterPaperLosses: money(taxable),
      paperLossCarry: money(paperLossCarry),
      estimatedTax: money(taxable.times(dayRate)),
      estimatedIrrfEquivalent: money(value.positiveDailyResults.times(withholdingRate)),
      excludedOvernightCloses: value.overnightTrades,
      excludedOvernightResult: money(value.overnight),
    };
  });
}
