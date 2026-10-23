import { describe, expect, it } from "vitest";
import { mergeFractionalPositions, splitLots } from "@/core/lots";

describe("standard and fractional lots", () => {
  it("splits a quantity into the standard lot and the F symbol", () => {
    expect(splitLots("PETR4", 137)).toEqual([{ symbol: "PETR4", quantity: 100 }, { symbol: "PETR4F", quantity: 37 }]);
    expect(splitLots("VALE3", 300)).toEqual([{ symbol: "VALE3", quantity: 300 }]);
    expect(splitLots("ITUB4", 42)).toEqual([{ symbol: "ITUB4F", quantity: 42 }]);
  });

  it("refuses invalid tickers and quantities", () => {
    expect(() => splitLots("PETR4F", 10)).toThrow("INVALID_TICKER");
    expect(() => splitLots("PETR4", 0)).toThrow("INVALID_QUANTITY");
    expect(() => splitLots("PETR4", 1.5)).toThrow("INVALID_QUANTITY");
  });

  it("merges the standard and fractional legs shown separately by Genial", () => {
    const merged = mergeFractionalPositions([
      { symbol: "PETR4", quantity: 100, averagePrice: "30", observedAt: "2026-10-23T13:00:00Z" },
      { symbol: "PETR4F", quantity: 37, averagePrice: "31", observedAt: "2026-10-23T13:00:05Z" },
      { symbol: "VALE3F", quantity: 10, averagePrice: "60", observedAt: "2026-10-23T13:00:00Z" },
    ]);
    expect(merged).toEqual([
      { symbol: "PETR4", quantity: 137, averagePrice: "30.27007299", observedAt: "2026-10-23T13:00:05Z" },
      { symbol: "VALE3", quantity: 10, averagePrice: "60", observedAt: "2026-10-23T13:00:00Z" },
    ]);
  });
});
