import { describe, expect, it } from "vitest";
import { applicableEvents, isinPrefix, stockEventDates, type CorporateEvent } from "@/core/corporate-actions";
import { corporateActionSuspected } from "@/core/autopilot";
import { parseB3Events } from "@/providers/b3-events";
import type { MarketHistory } from "@/providers/types";

const event = (patch: Partial<CorporateEvent>): CorporateEvent => ({ kind: "CASH", label: "DIVIDENDO", isin: "BRPETRACNPR6",
  value: "0.47", lastDatePrior: "2026-10-01", paymentDate: "2026-10-15", ...patch });

describe("B3 corporate events", () => {
  it("parses official cash and stock events, skipping unknown labels and unset payments", () => {
    const events = parseB3Events([{ code: "MGLU", cashDividends: [
      { isinCode: "BRMGLUACNOR2", label: "DIVIDENDO", rate: "0,08130019210", lastDatePrior: "24/04/2026", paymentDate: "08/05/2026" },
      { isinCode: "BRMGLUACNOR2", label: "JRS CAP PROPRIO", rate: "0,1", lastDatePrior: "24/04/2026", paymentDate: "" },
      { isinCode: "BRMGLUACNOR2", label: "RESTITUICAO CAPITAL", rate: "1", lastDatePrior: "24/04/2026", paymentDate: "08/05/2026" },
    ], stockDividends: [
      { isinCode: "BRMGLUACNOR2", label: "GRUPAMENTO", factor: "0,10000000000", lastDatePrior: "24/05/2024" },
      { isinCode: "BRMGLUACNOR2", label: "DESDOBRAMENTO", factor: "300,00000000000", lastDatePrior: "13/10/2020" },
    ] }]);
    expect(events).toEqual([
      { kind: "CASH", label: "DIVIDENDO", isin: "BRMGLUACNOR2", value: "0.08130019210", lastDatePrior: "2026-04-24", paymentDate: "2026-05-08" },
      { kind: "GROUPING", label: "GRUPAMENTO", isin: "BRMGLUACNOR2", value: "0.10000000000", lastDatePrior: "2024-05-24", paymentDate: null },
      { kind: "SPLIT", label: "DESDOBRAMENTO", isin: "BRMGLUACNOR2", value: "300.00000000000", lastDatePrior: "2020-10-13", paymentDate: null },
    ]);
    expect(() => parseB3Events({})).toThrow("INVALID_RESPONSE");
  });

  it("maps share classes to ISIN prefixes", () => {
    expect([isinPrefix("PETR4"), isinPrefix("VALE3"), isinPrefix("ITSA5"), isinPrefix("TAEE11"), isinPrefix("PETR4F")])
      .toEqual(["BRPETRACNPR", "BRVALEACNOR", "BRITSAACNPA", null, null]);
  });

  it("selects only due events of this class after the first virtual purchase, oldest first", () => {
    const events = [
      event({ lastDatePrior: "2026-09-20", paymentDate: "2026-10-30" }),           // not paid yet
      event({ isin: "BRPETRACNOR9" }),                                              // other class (ON)
      event({ lastDatePrior: "2026-08-01", paymentDate: "2026-08-20" }),           // before first purchase
      event({ kind: "SPLIT", label: "DESDOBRAMENTO", value: "100", lastDatePrior: "2026-10-05", paymentDate: null }),
      event({}),
    ];
    const due = applicableEvents(events, "PETR4", "2026-09-01", "2026-10-22");
    expect(due.map((e) => [e.kind, e.lastDatePrior])).toEqual([["CASH", "2026-10-01"], ["SPLIT", "2026-10-05"]]);
    expect(stockEventDates(events, "PETR4")).toEqual(["2026-10-05"]);
  });

  it("lets an official event explain a price jump that would otherwise pause the agent", () => {
    const bar = (day: string, close: string, adjusted: string) => ({ timestamp: `${day}T03:00:00.000Z`, open: close, high: close, low: close, close, adjustedClose: adjusted, volume: 1 });
    const history: MarketHistory = { ticker: "TEST3", interval: "1d", range: "3mo", retrievedAt: "2026-10-22T12:00:00Z",
      source: "https://example.test", feed: "EOD", tradable: false,
      bars: [bar("2026-10-19", "20.00", "10.00"), bar("2026-10-20", "10.10", "10.10")] };
    expect(corporateActionSuspected(history, "10.10")).toContain("desdobramento");
    expect(corporateActionSuspected(history, "10.10", ["2026-10-19"])).toBeNull();
  });
});
