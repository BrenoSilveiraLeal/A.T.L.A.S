import { describe, expect, it } from "vitest";
import { committee } from "@/core/committee";
import { STEADY_RULE } from "@/core/autopilot";

const base = { context: { action: "ALLOW" as const, summary: "" }, health: { level: "SAUDAVEL" as const, reason: "Lucro de R$ 110 bi." },
  holding: 0, averageCost: null, price: 30, budgetRoom: 99, rule: STEADY_RULE };

describe("meeting-room committee", () => {
  it("buys when the share of the contribution is ready and nobody objects", () => {
    const c = committee(base);
    expect(c.verdict).toBe("COMPRAR");
    expect(c.opinions.map((o) => o.vote)).toEqual(["A_FAVOR", "A_FAVOR", "A_FAVOR"]);
  });

  it("vetoes the purchase for bad news or a company in danger", () => {
    expect(committee({ ...base, health: { level: "PERIGO", reason: "Patrimônio negativo." } }).summary).toContain("Balanço contra");
    expect(committee({ ...base, context: { action: "BLOCK_BUY", summary: "fato relevante" } }).verdict).toBe("ESPERAR");
  });

  it("holds while saving up and prepares the sale above the target", () => {
    expect(committee({ ...base, holding: 3, averageCost: 30, budgetRoom: 33 }).verdict).toBe("SEGURAR");
    const high = committee({ ...base, holding: 3, averageCost: 30, price: 49, budgetRoom: 0 });
    expect([high.verdict, high.opinions[2].text]).toEqual(["VENDER_NA_ALTA", expect.stringContaining("+60%")]);
  });
});
