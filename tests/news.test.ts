import { describe, expect, it } from "vitest";
import { tagHeadline, tagsFor } from "@/core/news";
import { COMPANIES } from "@/core/context";

const profiles = ["PETR4", "VALE3", "ITUB4"].map((ticker) => ({ ticker, profile: COMPANIES[ticker] }));

describe("office news TV", () => {
  it("reads company headlines as up or down", () => {
    expect(tagHeadline("Petrobras tem lucro recorde no trimestre", profiles)).toEqual([{ ticker: "PETR4", direction: "UP", why: "fala de Petrobras" }]);
    expect(tagHeadline("Ações do Itaú caem após multa", profiles)).toEqual([{ ticker: "ITUB4", direction: "DOWN", why: "fala de Itaú Unibanco" }]);
  });

  it("links oil news to oil companies", () => {
    const tags = tagHeadline("Preço do petróleo dispara com tensão no Oriente Médio", profiles);
    expect(tags).toContainEqual({ ticker: "PETR4", direction: "UP", why: "notícia do petróleo" });
    expect(tags.some((t) => t.ticker === "VALE3")).toBe(false);
  });

  it("reads rate decisions inversely and flags world stress", () => {
    expect(tagHeadline("Copom eleva a Selic para 15%", profiles)).toEqual([{ ticker: "*", direction: "DOWN", why: "juros" }]);
    expect(tagHeadline("Banco Central corta juros", profiles)).toEqual([{ ticker: "*", direction: "UP", why: "juros" }]);
    expect(tagHeadline("Por que Ibovespa caiu 1,15% hoje?", profiles)).toEqual([{ ticker: "*", direction: "DOWN", why: "economia" }]);
    expect(tagHeadline("Dólar cai para R$ 5,01", profiles)).toEqual([{ ticker: "*", direction: "UP", why: "dólar" }]);
    expect(tagHeadline("Terremoto atinge o Japão", profiles)).toEqual([{ ticker: "*", direction: "DOWN", why: "estresse no mundo" }]);
  });

  it("ignores unrelated headlines and orders an agent's tags", () => {
    expect(tagHeadline("Festival de cinema começa hoje", profiles)).toEqual([]);
    const tags = [{ ticker: "*", direction: "WATCH" as const, why: "economia" }, { ticker: "VALE3", direction: "DOWN" as const, why: "fala de Vale" }];
    expect(tagsFor("VALE3", tags).map((t) => t.ticker)).toEqual(["VALE3", "*"]);
    expect(tagsFor("PETR4", tags).map((t) => t.ticker)).toEqual(["*"]);
  });
});
