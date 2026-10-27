import { describe, expect, it } from "vitest";
import { custodyShortfalls, liveFee, liveIntent, minimumSellPrice, quoteProblem, sendOutcome, sizeLiveBuy, sizeLiveSell } from "@/core/live";

describe("real-money sizing at Genial", () => {
  it("prices fees like the contract table", () => {
    expect(liveFee(150, 5)).toBeCloseTo(1.04, 2);
    expect(liveFee(3000, 100)).toBeCloseTo(3.89, 2);
  });

  it("buys fractional shares through the book with room for the fee", () => {
    expect(sizeLiveBuy(250, 300, "30.00")).toEqual({ quantity: 8, limit: "30.09" });
    expect(sizeLiveBuy(5000, 300, "30.00")).toEqual({ quantity: 9, limit: "30.09" });
    expect(sizeLiveBuy(5000, 5000, "30.00")).toEqual({ quantity: 100, limit: "30.09" });
  });

  it("refuses orders too small for the brokerage", () => {
    expect(sizeLiveBuy(60, 300, "30.00")).toEqual({ skip: expect.stringContaining("pequena demais") });
    expect(sizeLiveBuy(10, 300, "30.00")).toEqual({ skip: expect.stringContaining("não paga") });
  });

  it("sells standard lots first, then the fractional rest", () => {
    expect(sizeLiveSell(137, "32.00")).toEqual({ quantity: 100, limit: "31.90" });
    expect(sizeLiveSell(37, "32.00")).toEqual({ quantity: 37, limit: "31.90" });
    expect(sizeLiveSell(0, "32.00")).toBeNull();
  });

  it("rejects stale, one-sided or far-off quotes", () => {
    const now = Date.parse("2026-10-26T14:00:00Z");
    expect(quoteProblem({ bid: "29.9", ask: "30", quotedAt: "2026-10-26T13:59:50Z" }, "30.10", now)).toBeNull();
    expect(quoteProblem({ bid: null, ask: "30", quotedAt: "2026-10-26T13:59:50Z" }, null, now)).toContain("oferta");
    expect(quoteProblem({ bid: "29.9", ask: "30", quotedAt: "2026-10-26T13:50:00Z" }, null, now)).toContain("atrasada");
    expect(quoteProblem({ bid: "29.9", ask: "30", quotedAt: "2026-10-26T13:59:50Z" }, "33.00", now)).toContain("diferente");
  });

  it("flags only shares missing at the broker", () => {
    expect(custodyShortfalls({ PETR4: 37, VALE3: 10 }, [{ symbol: "PETR4", quantity: 137 }, { symbol: "VALE3", quantity: 5 }]))
      .toEqual([{ ticker: "VALE3", atlas: 10, broker: 5 }]);
  });
});

describe("real-money decisions", () => {
  const now = Date.parse("2026-10-26T14:00:00Z");
  const buy = { id: "p1", side: "BUY" as const, placedAt: "2026-10-26T13:50:00Z" };

  it("enters only on a fresh, unmirrored buy with no shares, and leaves on any sell", () => {
    expect(liveIntent(buy, 0, false, now)).toBe("BUY");
    expect(liveIntent(buy, 0, true, now)).toBeNull();
    expect(liveIntent(buy, 5, false, now)).toBeNull();
    expect(liveIntent({ ...buy, placedAt: "2026-10-26T13:00:00Z" }, 0, false, now)).toBeNull();
    expect(liveIntent({ ...buy, side: "SELL" }, 37, true, now)).toBe("SELL");
    expect(liveIntent({ ...buy, side: "SELL" }, 0, false, now)).toBeNull();
  });

  it("never treats an ambiguous send as rejected", () => {
    expect(sendOutcome("ORDER_REJECTED")).toBe("REJECTED");
    expect(sendOutcome("EXECUTION_DISABLED")).toBe("REJECTED");
    expect(sendOutcome("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")).toBe("UNKNOWN");
    expect(sendOutcome("SUBMITTED_ORDER_TERMS_MISMATCH")).toBe("UNKNOWN");
    expect(sendOutcome("TIMEOUT")).toBe("UNKNOWN");
  });
});

describe("never sell at a loss", () => {
  it("covers the price paid, both fees and 3% net profit", () => {
    // 5 shares that cost R$ 150,54 with fees: (150,54 + 0,99) / (5 × 0,9997) × 1,03 = 31,23.
    expect(minimumSellPrice(150.54, 5)).toBe("31.23");
    expect(minimumSellPrice(3009.9, 100)).toBe("31.05");
  });

  it("leaves at least 3% of what was paid after the sale's fees (Beatriz, 6 EQTL3 for R$ 215,26)", () => {
    const price = Number(minimumSellPrice(215.26, 6));
    const net = 6 * price * (1 - 3 / 10000) - 0.99 - 215.26;
    expect(price).toBe(37.14);
    expect(net).toBeGreaterThanOrEqual(215.26 * 0.03);
  });
});
