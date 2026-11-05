import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dividendAnnouncements } from "@/core/dividends";
import { isinPrefix, type CorporateEvent } from "@/core/corporate-actions";
import { saoPauloClock } from "@/core/b3-calendar";
import { b3EventsUrl, fetchB3Events } from "@/providers/b3-events";
import { allLiveFills } from "./live-fills";
import { softCached } from "./context";
import { ApiError } from "./auth";

/** Announcements are read-only projections. A past payment date alone is never receipt evidence. */
export async function loadDividendAgenda(db: SupabaseClient, owner: string) {
  const fills = await allLiveFills(db, owner);
  const today = saoPauloClock(new Date()).date;
  const tickers = [...new Set(fills.map((f) => f.ticker))];
  const sources = await Promise.all(tickers.map(async (ticker) => {
    const issuer = ticker.slice(0, 4), source = b3EventsUrl(issuer);
    const events = await softCached<CorporateEvent[]>("b3", `EVENTS:${issuer}`, 6 * 3600000, 7 * 86400000, 100,
      source, () => fetchB3Events(issuer), undefined, 1800).catch(() => null);
    const trades = fills.filter((f) => f.ticker === ticker).map((f) => ({ side: f.side, quantity: f.quantity, date: saoPauloClock(new Date(f.executed_at)).date }));
    return { ticker, source, available: events !== null,
      events: dividendAnnouncements(ticker, trades, events ?? [], isinPrefix(ticker), today) };
  }));
  return { today, checkedAt: new Date().toISOString(), sources };
}

export const dividendReceiptSchema = z.object({
  id: z.string().regex(/^\d{1,18}$/), receivedOn: z.iso.date(), amount: z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/),
});

export async function confirmDividendReceipt(db: SupabaseClient, owner: string, raw: unknown) {
  const input = dividendReceiptSchema.parse(raw);
  const result = await db.rpc("confirm_live_dividend_receipt", { p_owner_id: owner, p_id: input.id, p_received_on: input.receivedOn, p_amount: input.amount });
  if (result.error) throw new ApiError(409, "DIVIDEND_RECEIPT_REFUSED", "Confira a data e o valor: o crédito precisa constar no extrato, ocorrer após a data de pagamento e não superar o valor bruto.");
  return { recorded: true };
}
