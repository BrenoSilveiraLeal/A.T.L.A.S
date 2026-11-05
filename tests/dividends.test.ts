import { describe, expect, it } from "vitest";
import { dividendRows, dividendAnnouncements, dividendAmounts } from "@/core/dividends";
import type { CorporateEvent } from "@/core/corporate-actions";

// Taesa's real Q2 2026 payout (B3, 27/10/2026): data com 14/08, paid 26/11.
const taesa = (label: string, value: string, lastDatePrior = "2026-08-14", paymentDate: string | null = "2026-11-26"): CorporateEvent =>
  ({ kind: "CASH", label, isin: "BRTAEEACNPR6", value, lastDatePrior, paymentDate });

describe("dividends and JCP on the real shares (owner, 29/10/2026)", () => {
  const fills = [{ side: "BUY" as const, quantity: 10, date: "2026-08-10" }, { side: "BUY" as const, quantity: 5, date: "2026-08-20" }];

  it("pays the shares held at the end of the data com, JCP net of the 2026 withholding rate", () => {
    const rows = dividendRows(fills, [taesa("DIVIDENDO", "0.08025458488"), taesa("JRS CAP PROPRIO", "0.11982485996")], "BRTAEEACNPR");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ quantity: 10, gross: "0.80", tax: "0.00", net: "0.80", paymentDate: "2026-11-26" });
    expect(rows[1]).toMatchObject({ quantity: 10, gross: "1.19", tax: "0.21", net: "0.98" });
  });

  it("counts a purchase on the data com itself, not one after it, and subtracts sales", () => {
    expect(dividendRows([{ side: "BUY", quantity: 4, date: "2026-08-14" }], [taesa("DIVIDENDO", "1")], "BRTAEEACNPR")[0].quantity).toBe(4);
    expect(dividendRows([{ side: "BUY", quantity: 4, date: "2026-08-15" }], [taesa("DIVIDENDO", "1", "2026-08-20")], "BRTAEEACNPR")[0].quantity).toBe(4);
    const sold = [...fills, { side: "SELL" as const, quantity: 10, date: "2026-08-12" }];
    expect(dividendRows(sold, [taesa("DIVIDENDO", "1")], "BRTAEEACNPR")).toEqual([]);
  });

  it("skips other share classes, events before the first purchase and payments not yet dated", () => {
    const other = { ...taesa("DIVIDENDO", "1"), isin: "BRTAEEACNOR9" };
    expect(dividendRows(fills, [other], "BRTAEEACNPR")).toEqual([]);
    expect(dividendRows(fills, [taesa("DIVIDENDO", "1", "2026-05-14")], "BRTAEEACNPR")).toEqual([]);
    expect(dividendRows(fills, [taesa("DIVIDENDO", "1", "2026-08-14", null), taesa("DIVIDENDO", "1", "2026-08-14", "9999-12-31")], "BRTAEEACNPR")).toEqual([]);
  });
});

it("shows an announcement even when the owner bought after its data com, without crediting it", () => {
  const result = dividendAnnouncements("TAEE4", [{ side: "BUY", quantity: 6, date: "2026-10-27" }], [taesa("JRS CAP PROPRIO", "0.13329262950", "2025-12-29", "2026-12-30")], "BRTAEEACNPR", "2026-11-05");
  expect(result[0]).toMatchObject({ quantity: 0, currentQuantity: 6, net: "0.00", final: true, paymentDate: "2026-12-30" });
});

it("keeps announcements without a payment date and marks the record-date position as provisional", () => {
  const result = dividendAnnouncements("TAEE4", [{ side: "BUY", quantity: 5, date: "2026-11-04" }], [taesa("DIVIDENDO", "0.50", "2026-11-10", null)], "BRTAEEACNPR", "2026-11-05");
  expect(result[0]).toMatchObject({ quantity: 5, gross: "2.50", paymentDate: "", final: false });
  expect(dividendAmounts("1", 10, "JRS CAP PROPRIO", "2025-11-10")).toMatchObject({ tax: "1.50", net: "8.50" });
});
