/** Selection of official B3 corporate events that affect a virtual position. */
export interface CorporateEvent {
  kind: "CASH" | "SPLIT" | "GROUPING" | "BONUS";
  label: string;
  isin: string;
  value: string;
  lastDatePrior: string;
  paymentDate: string | null;
}

/**
 * ISIN prefix for B3 share tickers: 3 = ON (ACNOR), 4 = PN (ACNPR), 5 = PNA (ACNPA),
 * 6 = PNB (ACNPB). Units, BDRs and fractional suffixes are not mapped (null = unknown).
 */
export function isinPrefix(ticker: string): string | null {
  const match = /^([A-Z]{4})([3-6])$/.exec(ticker);
  if (!match) return null;
  const share = { "3": "ACNOR", "4": "ACNPR", "5": "ACNPA", "6": "ACNPB" }[match[2] as "3" | "4" | "5" | "6"];
  return `BR${match[1]}${share}`;
}

/**
 * Events to apply, oldest first: only for this share class, with a record date ("data com")
 * on or after the first virtual purchase, stock events after their ex-date and cash events
 * on or after payment. Re-applying is harmless: the database keeps each event once.
 */
export function applicableEvents(events: readonly CorporateEvent[], ticker: string, firstHolding: string, today: string): CorporateEvent[] {
  const prefix = isinPrefix(ticker);
  if (!prefix) return [];
  return events
    .filter((e) => e.isin.startsWith(prefix) && e.lastDatePrior >= firstHolding &&
      (e.kind === "CASH" ? e.paymentDate !== null && e.paymentDate <= today : e.lastDatePrior < today))
    .sort((a, b) => a.lastDatePrior.localeCompare(b.lastDatePrior) || a.kind.localeCompare(b.kind));
}

/** Record dates of stock events for this share class, used to explain price jumps. */
export function stockEventDates(events: readonly CorporateEvent[], ticker: string): string[] {
  const prefix = isinPrefix(ticker);
  return prefix ? events.filter((e) => e.kind !== "CASH" && e.isin.startsWith(prefix)).map((e) => e.lastDatePrior) : [];
}
