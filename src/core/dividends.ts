import Decimal from "decimal.js";
import type { CorporateEvent } from "./corporate-actions";

/**
 * Dividends and JCP on the real shares (owner, 29/10/2026: "dividendos é o que enriquecem"). Pure:
 * from the agent's real fills and B3's official cash events (with their payment dates), what each
 * event pays on the shares held at the end of its "data com" (last day with the right). JCP comes
 * with income tax withheld at the source (JCP_TAX); dividends are exempt below R$ 50 mil a month from
 * one company, far above this account. The net counts as cash only from its payment date.
 */
/** IRRF applied to JCP paid from 2026-01-01; payments before that date used 15%. */
export const JCP_TAX = 0.175;
export interface DividendFill { side: "BUY" | "SELL"; quantity: number; date: string }
export interface DividendRow {
  label: string; isin: string; lastDatePrior: string; paymentDate: string; rate: string;
  quantity: number; gross: string; tax: string; net: string;
}

export function dividendAmounts(rate: string, quantity: number, label: string, paymentDate: string | null) {
  const gross = new Decimal(rate).times(quantity).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const taxRate = paymentDate && paymentDate < "2026-01-01" ? 0.15 : JCP_TAX;
  const tax = /JRS CAP PROPRIO/.test(label) ? gross.times(taxRate).toDecimalPlaces(2, Decimal.ROUND_UP) : new Decimal(0);
  return { gross: gross.toFixed(2), tax: tax.toFixed(2), net: gross.minus(tax).toFixed(2) };
}

export interface DividendAnnouncement extends DividendRow {
  key: string; ticker: string; currentQuantity: number; final: boolean;
}

/** Includes announcements without entitlement, so a new shareholder can see why a payment is excluded. */
export function dividendAnnouncements(ticker: string, fills: readonly DividendFill[], events: readonly CorporateEvent[], prefix: string | null, today: string): DividendAnnouncement[] {
  if (!prefix) return [];
  const currentQuantity = Math.max(0, fills.reduce((q, f) => q + (f.side === "BUY" ? f.quantity : -f.quantity), 0));
  const seen = new Set<string>();
  return events.flatMap((event) => {
    if (event.kind !== "CASH" || !event.isin.startsWith(prefix)) return [];
    const key = [ticker, event.label, event.lastDatePrior, event.paymentDate ?? "", new Decimal(event.value).toString()].join(":");
    if (seen.has(key)) return [];
    seen.add(key);
    const quantity = Math.max(0, fills.filter((f) => f.date <= event.lastDatePrior).reduce((q, f) => q + (f.side === "BUY" ? f.quantity : -f.quantity), 0));
    return [{ key, ticker, label: event.label, isin: event.isin, lastDatePrior: event.lastDatePrior,
      paymentDate: event.paymentDate && !event.paymentDate.startsWith("9999") ? event.paymentDate : "", rate: event.value,
      quantity, currentQuantity, final: event.lastDatePrior < today, ...dividendAmounts(event.value, quantity, event.label, event.paymentDate) }];
  }).sort((a, b) => b.lastDatePrior.localeCompare(a.lastDatePrior));
}

export function dividendRows(fills: readonly DividendFill[], events: readonly CorporateEvent[], isinPrefix: string | null): DividendRow[] {
  if (!isinPrefix || !fills.length) return [];
  const first = fills.reduce((d, f) => (f.date < d ? f.date : d), fills[0].date);
  const rows: DividendRow[] = [];
  for (const e of events) {
    if (e.kind !== "CASH" || !e.paymentDate || !e.isin.startsWith(isinPrefix) || e.lastDatePrior < first) continue;
    if (e.paymentDate.startsWith("9999")) continue; // "a definir"
    // Shares bought up to and including the data com have the right; trades after it do not.
    const quantity = fills.filter((f) => f.date <= e.lastDatePrior).reduce((q, f) => q + (f.side === "BUY" ? f.quantity : -f.quantity), 0);
    if (quantity <= 0) continue;
    rows.push({ label: e.label, isin: e.isin, lastDatePrior: e.lastDatePrior, paymentDate: e.paymentDate, rate: e.value, quantity,
      ...dividendAmounts(e.value, quantity, e.label, e.paymentDate) });
  }
  return rows;
}
