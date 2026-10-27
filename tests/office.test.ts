import { describe, expect, it } from "vitest";
import { placeAgent, type OfficeInput } from "@/core/office";

const now = Date.parse("2026-10-23T15:00:00Z");
const base: OfficeInput = { id: "a", status: "IDLE", enabled: true, autopilot: true, holding: 0, openOrder: null,
  lastAnalysisAt: "2026-10-23T14:00:00Z", freshNews: false, marketOpen: true, now };

describe("office placement", () => {
  it("sends eliminated agents out and analysing agents to the meeting", () => {
    expect(placeAgent({ ...base, status: "DEAD" }).zone).toBe("OUT");
    expect(placeAgent({ ...base, status: "ANALYZING" }).zone).toBe("MEETING");
    expect(placeAgent({ ...base, lastAnalysisAt: "2026-10-23T14:58:30Z" }).zone).toBe("MEETING");
    expect(placeAgent({ ...base, freshNews: true }).activity).toContain("notícia");
  });

  it("puts agents at the computer when they have work", () => {
    expect(placeAgent({ ...base, openOrder: { side: "BUY" } })).toEqual({ zone: "DESK", activity: expect.stringContaining("compra") });
    expect(placeAgent({ ...base, holding: 43 }).activity).toContain("43 ações");
  });

  it("keeps everyone at the computer during the working day, with a short walk now and then", () => {
    const work = { ...base, workTime: true, now: Date.parse("2026-10-27T15:00:00Z") };
    const atDesk = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => placeAgent({ ...work, id }));
    expect(atDesk.filter((p) => p.zone === "DESK").length).toBeGreaterThanOrEqual(6);
    expect(atDesk.find((p) => p.zone === "DESK")?.activity).toContain("No computador");
    // Over a working hour each agent spends a few minutes away from the desk, never most of the time.
    const minutes = Array.from({ length: 60 }, (_, m) => placeAgent({ ...work, now: work.now + m * 60000 }).zone !== "DESK").filter(Boolean).length;
    expect(minutes).toBeGreaterThan(0); expect(minutes).toBeLessThanOrEqual(6);
    expect(placeAgent({ ...work, marketOpen: false }).activity).toMatch(/abertura|volta/);
  });

  it("lets agents rest when there is nothing to do, always in the same spot", () => {
    const closed = placeAgent({ ...base, marketOpen: false, holding: 10 });
    expect(["COFFEE", "POOL"]).toContain(closed.zone);
    expect(closed.activity).toContain("Bolsa fechada");
    expect(placeAgent({ ...base, marketOpen: false }).zone).toBe(closed.zone);
    expect(placeAgent({ ...base, autopilot: false, holding: 5 }).activity).toContain("piloto");
    const zones = new Set(["a", "b", "c", "d", "e", "f"].map((id) => placeAgent({ ...base, id, marketOpen: false }).zone));
    expect(zones).toEqual(new Set(["COFFEE", "POOL"]));
  });
});
