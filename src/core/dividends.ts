import Decimal from "decimal.js";
import type { CorporateEvent } from "./corporate-actions";

/**
 * Dividends and JCP on the real shares (owner, 29/10/2026: "dividendos é o que enriquecem"). Pure:
 * from the agent's real fills and B3's official cash events (with their payment dates), what each
 * event pays on the shares held at the end of its "data com" (last day with the right). JCP comes
 * with income tax withheld at the source (JCP_TAX); dividends are exempt below R$ 50 mil a month from
 * one company, far above this account. The net counts as cash only from its payment date.
 */
export const JCP_TAX = 0.15;
export interface DividendFill { side: "BUY" | "SELL"; quantity: number; date: string }
export interface DividendRow {
  label: string; isin: string; lastDatePrior: string; paymentDate: string; rate: string;
  quantity: number; gross: string; tax: string; net: string;
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
    const gross = new Decimal(e.value).times(quantity).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const tax = /JRS CAP PROPRIO/.test(e.label) ? gross.times(JCP_TAX).toDecimalPlaces(2, Decimal.ROUND_UP) : new Decimal(0);
    rows.push({ label: e.label, isin: e.isin, lastDatePrior: e.lastDatePrior, paymentDate: e.paymentDate, rate: e.value, quantity,
      gross: gross.toFixed(2), tax: tax.toFixed(2), net: gross.minus(tax).toFixed(2) });
  }
  return rows;
}
