import { describe, expect, it } from "vitest";
import { dividendRows } from "@/core/dividends";
import type { CorporateEvent } from "@/core/corporate-actions";

// Taesa's real Q2 2026 payout (B3, 27/10/2026): data com 14/08, paid 26/11.
const taesa = (label: string, value: string, lastDatePrior = "2026-08-14", paymentDate: string | null = "2026-11-26"): CorporateEvent =>
  ({ kind: "CASH", label, isin: "BRTAEEACNPR6", value, lastDatePrior, paymentDate });

describe("dividends and JCP on the real shares (owner, 29/10/2026)", () => {
  const fills = [{ side: "BUY" as const, quantity: 10, date: "2026-08-10" }, { side: "BUY" as const, quantity: 5, date: "2026-08-20" }];

  it("pays the shares held at the end of the data com, JCP net of 15%", () => {
    const rows = dividendRows(fills, [taesa("DIVIDENDO", "0.08025458488"), taesa("JRS CAP PROPRIO", "0.11982485996")], "BRTAEEACNPR");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ quantity: 10, gross: "0.80", tax: "0.00", net: "0.80", paymentDate: "2026-11-26" });
    // 10 × 0,1198 = 1,19 gross; 15% withheld at the source rounds up to 0,18.
    expect(rows[1]).toMatchObject({ quantity: 10, gross: "1.19", tax: "0.18", net: "1.01" });
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
