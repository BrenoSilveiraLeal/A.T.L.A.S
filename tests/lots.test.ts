import { describe, expect, it } from "vitest";
import { splitLots } from "@/core/lots";

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
});
