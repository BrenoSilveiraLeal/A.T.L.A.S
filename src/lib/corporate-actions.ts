import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchB3Events, b3EventsUrl } from "@/providers/b3-events";
import { applicableEvents, stockEventDates, type CorporateEvent } from "@/core/corporate-actions";
import { saoPauloClock } from "@/core/b3-calendar";
import { softCached } from "./context";

/**
 * Applies official B3 events (cash dividends/JCP, splits, groupings, bonus issues) to the
 * virtual positions of one asset before it is marked. Idempotent in the database.
 * Returns the record dates of stock events so the price-jump guard can tell an explained
 * jump from an unexplained one. A B3 outage never blocks the analysis.
 */
export async function applyPaperCorporateActions(db: SupabaseClient, owner: string, assetId: string, ticker: string, referencePrice: string) {
  const issuer = ticker.slice(0, 4);
  const events = await softCached<CorporateEvent[]>("b3", `EVENTS:${issuer}`, 12 * 3600000, 7 * 86400000, 100,
    b3EventsUrl(issuer), () => fetchB3Events(issuer), undefined, 1800);
  if (!events) return { applied: 0, knownDates: [] as string[], unavailable: true };
  const knownDates = stockEventDates(events, ticker);
  const first = await db.from("paper_fills").select("filled_at").eq("owner_id", owner).eq("asset_id", assetId)
    .order("filled_at", { ascending: true }).limit(1).maybeSingle();
  if (first.error) throw first.error;
  if (!first.data) return { applied: 0, knownDates, unavailable: false };
  const firstHolding = saoPauloClock(new Date(first.data.filled_at)).date;
  let applied = 0;
  for (const event of applicableEvents(events, ticker, firstHolding, saoPauloClock(new Date()).date)) {
    const result = await db.rpc("paper_apply_corporate_action", {
      p_owner_id: owner, p_asset_id: assetId, p_kind: event.kind, p_label: event.label, p_isin: event.isin,
      p_value: event.value, p_last_date_prior: event.lastDatePrior, p_payment_date: event.paymentDate,
      p_reference_price: referencePrice, p_source: b3EventsUrl(issuer),
    });
    if (result.error) throw result.error;
    if ((result.data as { applied?: boolean } | null)?.applied) applied++;
  }
  return { applied, knownDates, unavailable: false };
}
