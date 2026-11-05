import { describe, expect, it } from "vitest";
import { ELEVATOR, floorLevel, OFFICES, officeOnFloor, parseFloor, TOWER, wallSegments, windowBays } from "@/core/building";

describe("ATLAS tower", () => {
  it("groups the three offices in consecutive middle floors, dividends at the bottom", () => {
    expect(OFFICES.map((o) => [o.id, o.floor])).toEqual([["dividendos", 8], ["dash", 9], ["coin", 10]]);
    expect(OFFICES.every((o) => o.floor > 1 && o.floor < TOWER.floors)).toBe(true);
  });

  it("carries the owner's names for DASH and COIN", () => {
    expect(officeOnFloor(9)).toMatchObject({ fullName: "Day-trading Analysis & Strategy Hub", tagline: "Núcleo de Análise e Estratégia de Day Trade" });
    expect(officeOnFloor(10)).toMatchObject({ fullName: "Crypto Operations & Intelligence Network", tagline: "Rede de Inteligência e Operações com Criptoativos" });
  });

  it("opens the current office at its own route and DASH at /daytrade; COIN stays closed", () => {
    expect(officeOnFloor(8)).toMatchObject({ status: "ACTIVE", href: "/app" });
    expect(officeOnFloor(9)).toMatchObject({ status: "BUILDING", href: "/daytrade" });
    expect(officeOnFloor(10)).toMatchObject({ status: "LOCKED", href: null });
  });

  it("puts the elevator where the office's entrance was, on the front wall", () => {
    // The rounded façade's straight front starts at x=-20; the shaft must not cross the curve.
    expect(ELEVATOR.x - ELEVATOR.width / 2).toBeCloseTo(-20);
    expect(ELEVATOR.x + ELEVATOR.width / 2).toBeCloseTo(-17);
    expect(Math.abs(ELEVATOR.x) + ELEVATOR.width / 2).toBeLessThanOrEqual(TOWER.width / 2);
  });

  it("places floors above the lobby", () => {
    expect(floorLevel(0)).toBe(0);
    expect(floorLevel(1)).toBe(TOWER.lobby);
    expect(floorLevel(8)).toBeCloseTo(TOWER.lobby + 7 * TOWER.storey);
  });

  it("accepts only selectable floors from the query", () => {
    expect(parseFloor("9")).toBe(9);
    expect(parseFloor("3")).toBeNull();
    expect(parseFloor("9; drop")).toBeNull();
    expect(parseFloor(null)).toBeNull();
  });
});

describe("window bays", () => {
  it("opens every bay of a clear wall, with bays close to the tower's", () => {
    const bays = windowBays(48);
    expect(bays).toHaveLength(16);
    expect(bays.every((b) => b.glass)).toBe(true);
    expect(bays[0].from).toBeCloseTo(-24);
    expect(bays.at(-1)!.to).toBeCloseTo(24);
  });

  it("keeps the wall solid where something hangs on it", () => {
    const bays = windowBays(48, [[-1, 1]]);
    const solid = bays.filter((b) => !b.glass);
    expect(solid.length).toBeGreaterThan(0);
    expect(solid.every((b) => b.from < 1.15 && b.to > -1.15)).toBe(true);
    expect(bays.filter((b) => b.glass)).toHaveLength(16 - solid.length);
  });

  it("keeps only a pier behind a poster and glazes the rest of the wall", () => {
    const pieces = wallSegments(48, [[-0.7, 0.7]]);
    const solid = pieces.filter((p) => !p.glass);
    expect(solid).toHaveLength(1);
    expect(solid[0].from).toBeCloseTo(-0.8);
    expect(solid[0].to).toBeCloseTo(0.8);
    const glass = pieces.filter((p) => p.glass).reduce((sum, p) => sum + p.to - p.from, 0);
    expect(glass).toBeCloseTo(48 - 1.6);
    // Pieces cover the wall end to end, in order.
    expect(pieces[0].from).toBeCloseTo(-24);
    expect(pieces.at(-1)!.to).toBeCloseTo(24);
    pieces.slice(1).forEach((p, i) => expect(p.from).toBeCloseTo(pieces[i].to));
  });

  it("fills glass slivers between close items with wall", () => {
    const pieces = wallSegments(12, [[-2, -0.4], [0.2, 2]]);
    expect(pieces.filter((p) => !p.glass)).toHaveLength(1);
    expect(pieces.every((p) => !p.glass || p.to - p.from >= 0.5)).toBe(true);
  });

  it("ignores degenerate input", () => {
    expect(windowBays(0)).toEqual([]);
    expect(windowBays(2)).toHaveLength(1);
  });
});
