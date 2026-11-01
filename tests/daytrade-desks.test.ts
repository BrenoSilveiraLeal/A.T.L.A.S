import { describe, expect, it } from "vitest";
import { DESKS, deskState, INITIAL_STATUS, ORDER_STATES, SECTORS } from "@/core/daytrade/desks";

describe("DASH office", () => {
  it("has the sectors the owner asked for, each with someone in it", () => {
    expect(SECTORS.map((s) => s.id)).toEqual(["chefia", "supervisao", "dados", "noticias", "estrategia", "risco", "execucao", "registro"]);
    for (const s of SECTORS) expect(DESKS.some((d) => d.sector === s.id)).toBe(true);
    expect(DESKS.find((d) => d.id === "chief")?.sector).toBe("chefia");
    expect(DESKS.find((d) => d.id === "supervisor")?.sector).toBe("supervisao");
    expect(new Set(DESKS.map((d) => d.id)).size).toBe(DESKS.length);
    expect(new Set(DESKS.map((d) => d.person.name)).size).toBe(DESKS.length);
  });

  it("keeps every order state apart", () => {
    expect(ORDER_STATES.map((s) => s.id)).toEqual(["PROPOSED", "SENT", "ACCEPTED", "REJECTED", "PARTIAL", "FILLED"]);
  });

  it("starts simulated, with nothing connected and nothing traded", () => {
    expect(INITIAL_STATUS).toMatchObject({ mode: "SIMULATED", market: "UNVERIFIED", data: "NONE", broker: null, instrument: null, signals: 0 });
    expect(Object.values(INITIAL_STATUS.orders).every((n) => n === 0)).toBe(true);
  });

  it("keeps the desks idle without a trustworthy feed", () => {
    expect(deskState(INITIAL_STATUS)).toBe("IDLE");
    expect(deskState({ ...INITIAL_STATUS, data: "SIMULATED" })).toBe("WATCHING");
  });
});
