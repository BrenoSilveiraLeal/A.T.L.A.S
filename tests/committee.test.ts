import { describe, expect, it } from "vitest";
import { analysts, committee } from "@/core/committee";

const range = { low: 40, high: 60, buyBelow: 40.8, sellAbove: 58.8 };
const base = { context: { action: "ALLOW" as const, summary: "" }, health: { level: "SAUDAVEL" as const, reason: "Lucro de R$ 45 bi." },
  holding: 0, averageCost: null, price: 50, budgetRoom: 50, range, minGainPct: 3 };

describe("council: buy near the 6-month low, sell near the 6-month high", () => {
  it("waits while the stock is expensive, even with money", () => {
    const c = committee(base);
    expect(c.verdict).toBe("ESPERAR");
    expect(c.opinions.find((o) => o.role === "Realista")?.text).toContain("40,80");
  });

  it("buys near the low when the boss has money and nobody objects", () => {
    expect(committee({ ...base, price: 40.5 }).verdict).toBe("COMPRAR");
    expect(committee({ ...base, price: 40.5, budgetRoom: 0 }).verdict).toBe("ESPERAR");
    expect(committee({ ...base, price: 40.5, health: { level: "PERIGO", reason: "Patrimônio negativo." } }).summary).toContain("Pessimista contra");
    expect(committee({ ...base, price: 40.5, context: { action: "BLOCK_BUY", summary: "fato relevante" } }).verdict).toBe("ESPERAR");
  });

  it("waits while the price is still falling, buys once it turns up", () => {
    const falling = committee({ ...base, price: 40.2, recent: [45, 43, 41, 40.5] });
    expect([falling.verdict, falling.summary]).toEqual(["ESPERAR", "Decisão: esperar a queda virar para cima."]);
    expect(committee({ ...base, price: 40.5, recent: [45, 43, 41, 40] }).verdict).toBe("COMPRAR");
    expect(committee({ ...base, price: 40.5, recent: [45, 43, 41, 40], holding: 1, averageCost: 41 }).verdict).toBe("SEGURAR");
  });

  it("sells near the high only above what it paid", () => {
    expect(committee({ ...base, holding: 1, averageCost: 41, price: 59 }).verdict).toBe("VENDER_NA_ALTA");
    expect(committee({ ...base, holding: 1, averageCost: 58.5, price: 59 }).verdict).toBe("SEGURAR");
  });
});

describe("council: analysts against", () => {
  it("vetoes a purchase when analysts recommend selling", () => {
    const forecast = { targetMean: 35, targetLow: 30, targetHigh: 40, recommendation: "sell", analysts: 8 };
    const c = committee({ ...base, price: 40.5, forecast });
    expect([c.verdict, c.summary]).toEqual(["ESPERAR", expect.stringContaining("Pessimista contra")]);
  });
});

describe("council: four analysts, four sides (owner, 27/10/2026)", () => {
  const forecast = { targetMean: 50, targetLow: 42, targetHigh: 58, recommendation: "buy", analysts: 10 };
  const history = { samples: 6, upShare: 0.8, average: 0.12 };

  it("has an optimist, a pessimist, a world-risk analyst and a realist", () => {
    expect(committee({ ...base, price: 40.5 }).opinions.map((o) => o.role)).toEqual(["Otimista", "Pessimista", "Riscos do mundo", "Realista"]);
  });

  it("buys the whole amount only when nobody sees risk", () => {
    const c = analysts({ ...base, price: 40.5, forecast, history, market: { falling: 1, total: 16 } });
    expect([c.optimist.vote, c.pessimist.vote, c.world.vote, c.consensus.fraction]).toEqual(["A_FAVOR", "A_FAVOR", "A_FAVOR", 1]);
  });

  it("buys in parts when the whole market falls together", () => {
    const shock = { falling: 12, total: 16 };
    const c = analysts({ ...base, price: 40.5, forecast, history, market: shock });
    expect([c.world.vote, c.consensus.fraction]).toEqual(["NEUTRO", 0.5]);
    expect(c.world.text).toContain("12 de 16");
    // Caution from both the pessimist and the world: a third.
    const both = analysts({ ...base, price: 40.5, forecast, history, market: shock, health: { level: "ATENCAO", reason: "dívida subindo" } });
    expect(both.consensus.fraction).toBeCloseTo(1 / 3);
    expect(committee({ ...base, price: 40.5, forecast, history, market: shock }).summary).toBe("Decisão: comprar metade agora, aos poucos.");
  });

  it("with caution and no reason to rise, a third", () => {
    const c = analysts({ ...base, price: 40.5, health: null, market: { falling: 10, total: 16 } });
    expect([c.optimist.vote, c.consensus.fraction]).toEqual(["NEUTRO", 1 / 3]);
  });

  it("a collapse or bad news vetoes, whatever the optimist says", () => {
    expect(analysts({ ...base, price: 40.5, forecast, history, collapse: 0.7 }).consensus.fraction).toBe(0);
    expect(analysts({ ...base, price: 40.5, forecast, history, context: { action: "BLOCK_BUY", summary: "fato relevante" } }).consensus.veto).toContain("Riscos do mundo");
  });
});
