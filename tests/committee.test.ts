import { describe, expect, it } from "vitest";
import { committee } from "@/core/committee";

const range = { low: 40, high: 60, buyBelow: 40.8, sellAbove: 58.8 };
const base = { context: { action: "ALLOW" as const, summary: "" }, health: { level: "SAUDAVEL" as const, reason: "Lucro de R$ 45 bi." },
  holding: 0, averageCost: null, price: 50, budgetRoom: 50, range, minGainPct: 3 };

describe("council: buy near the 6-month low, sell near the 6-month high", () => {
  it("waits while the stock is expensive, even with money", () => {
    const c = committee(base);
    expect(c.verdict).toBe("ESPERAR");
    expect(c.opinions.find((o) => o.role === "Estratégia")?.text).toContain("40,80");
  });

  it("buys near the low when the boss has money and nobody objects", () => {
    expect(committee({ ...base, price: 40.5 }).verdict).toBe("COMPRAR");
    expect(committee({ ...base, price: 40.5, budgetRoom: 0 }).verdict).toBe("ESPERAR");
    expect(committee({ ...base, price: 40.5, health: { level: "PERIGO", reason: "Patrimônio negativo." } }).summary).toContain("Balanço contra");
    expect(committee({ ...base, price: 40.5, context: { action: "BLOCK_BUY", summary: "fato relevante" } }).verdict).toBe("ESPERAR");
  });

  it("sells near the high only above what it paid", () => {
    expect(committee({ ...base, holding: 1, averageCost: 41, price: 59 }).verdict).toBe("VENDER_NA_ALTA");
    expect(committee({ ...base, holding: 1, averageCost: 58.5, price: 59 }).verdict).toBe("SEGURAR");
  });
});

describe("council: the forecast specialist", () => {
  it("vetoes a purchase when analysts recommend selling", () => {
    const forecast = { targetMean: 35, targetLow: 30, targetHigh: 40, recommendation: "sell", analysts: 8 };
    const c = committee({ ...base, price: 40.5, forecast });
    expect([c.verdict, c.summary]).toEqual(["ESPERAR", expect.stringContaining("Previsão contra")]);
  });
});
