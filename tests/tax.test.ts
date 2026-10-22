import { describe, expect, it } from "vitest";
import { estimateMonthlyTax, lastWeekdayOfNextMonth, TaxError, type TaxFill } from "@/core/tax";

const fill = (symbol: string, side: "BUY" | "SELL", quantity: number, price: string, executedAt: string, fees = "0"): TaxFill =>
  ({ symbol, side, quantity, price, fees, executedAt });

describe("monthly income-tax estimate", () => {
  it("exempts swing gains when monthly sales stay within R$ 20.000", () => {
    const [month] = estimateMonthlyTax([
      fill("TEST3", "BUY", 100, "10.00", "2026-10-05T14:00:00Z", "1.00"),
      fill("TEST3", "SELL", 100, "12.00", "2026-10-20T14:00:00Z", "1.00"),
    ]);
    expect(month).toMatchObject({ month: "2026-10", swingSales: "1200.00", swingResult: "198.00", swingExempt: true, darf: "0.00" });
  });

  it("taxes swing gains at 15% above the exemption and deducts the 0,005% IRRF", () => {
    const months = estimateMonthlyTax([
      fill("TEST3", "BUY", 2000, "10.00", "2026-10-05T14:00:00Z"),
      fill("TEST3", "SELL", 2000, "12.00", "2026-11-05T14:00:00Z"),
    ]);
    expect(months[1]).toMatchObject({ swingSales: "24000.00", swingResult: "4000.00", swingExempt: false,
      taxDue: "600.00", irrfEstimate: "1.20", darf: "598.80", darfDueDate: "2026-12-31" });
  });

  it("separates same-day round trips as day trade at 20% with 1% IRRF", () => {
    const [month] = estimateMonthlyTax([
      fill("TEST3", "BUY", 100, "10.00", "2026-10-06T13:00:00Z"),
      fill("TEST3", "SELL", 100, "11.00", "2026-10-06T18:00:00Z"),
    ]);
    expect(month).toMatchObject({ dayTradeResult: "100.00", swingSales: "0.00", taxDue: "20.00", irrfEstimate: "1.00", darf: "19.00" });
  });

  it("keeps the overnight remainder at the swing average cost", () => {
    const months = estimateMonthlyTax([
      fill("TEST3", "BUY", 100, "10.00", "2026-10-06T13:00:00Z"),
      fill("TEST3", "BUY", 300, "10.00", "2026-10-07T13:00:00Z"),
      fill("TEST3", "SELL", 200, "11.00", "2026-10-07T18:00:00Z"),
    ]);
    // Oct 7: 200 bought & sold the same day (day trade +200); 100 extra stay at R$ 10.
    expect(months[0]).toMatchObject({ dayTradeResult: "200.00", swingResult: "0.00" });
  });

  it("carries swing losses forward even from exempt months", () => {
    const months = estimateMonthlyTax([
      fill("TEST3", "BUY", 1000, "10.00", "2026-08-03T14:00:00Z"),
      fill("TEST3", "SELL", 1000, "9.00", "2026-08-20T14:00:00Z"),
      fill("TEST3", "BUY", 2500, "10.00", "2026-09-01T14:00:00Z"),
      fill("TEST3", "SELL", 2500, "12.00", "2026-09-21T14:00:00Z"),
    ]);
    expect(months[0]).toMatchObject({ swingResult: "-1000.00", swingLossCarry: "1000.00", darf: "0.00" });
    expect(months[1]).toMatchObject({ swingResult: "5000.00", swingLossCarry: "0.00", taxDue: "600.00" });
  });

  it("accumulates a DARF below R$ 10 into the next month", () => {
    const months = estimateMonthlyTax([
      fill("TEST3", "BUY", 10, "10.00", "2026-10-06T13:00:00Z"),
      fill("TEST3", "SELL", 10, "12.00", "2026-10-06T18:00:00Z"),
      fill("TEST3", "BUY", 100, "10.00", "2026-11-06T13:00:00Z"),
      fill("TEST3", "SELL", 100, "11.00", "2026-11-06T18:00:00Z"),
    ]);
    expect(months[0]).toMatchObject({ darf: "0.00", carriedTax: "3.80" });
    expect(months[1]).toMatchObject({ darf: "22.80", carriedTax: "0.00" });
  });

  it("treats fractional tickers as the same asset and refuses short sales", () => {
    const [month] = estimateMonthlyTax([
      fill("TEST3F", "BUY", 50, "10.00", "2026-10-05T14:00:00Z"),
      fill("TEST3", "SELL", 50, "11.00", "2026-10-08T14:00:00Z"),
    ]);
    expect(month.swingResult).toBe("50.00");
    expect(() => estimateMonthlyTax([fill("TEST3", "SELL", 1, "10.00", "2026-10-05T14:00:00Z")])).toThrow(TaxError);
  });

  it("finds the last weekday of the following month", () => {
    expect(lastWeekdayOfNextMonth("2026-10")).toBe("2026-11-30");
    expect(lastWeekdayOfNextMonth("2026-01")).toBe("2026-02-27");
    expect(lastWeekdayOfNextMonth("2026-12")).toBe("2027-01-29");
  });
});
