import { describe, expect, it } from "vitest";
import { floorEdge, FURNITURE, PLANTS, RUGS, type Box } from "@/components/daytrade/dash-layout";

/** Inside the rounded floor: each corner of the box within the floor's edge at its depth. */
const fits = (x0: number, x1: number, z0: number, z1: number) =>
  [z0, z1].every((z) => Math.abs(z) <= 14 && Math.max(Math.abs(x0), Math.abs(x1)) <= floorEdge(z, 0));

describe("DASH floor plan", () => {
  it("keeps every piece inside the tower's rounded corners", () => {
    const out = [...FURNITURE, ...RUGS].filter((b: Box) => !fits(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2));
    expect(out).toEqual([]);
    // A plant's leaves reach 0.8 m round its pot.
    expect(PLANTS.filter(([x, z]) => !fits(x - 0.8, x + 0.8, z - 0.8, z + 0.8))).toEqual([]);
  });

  it("measures the edge: straight along the sides, rounding off in the corners", () => {
    expect(floorEdge(0, 0)).toBe(24);
    expect(floorEdge(10, 0)).toBe(24);
    expect(floorEdge(14, 0)).toBe(20);
    expect(floorEdge(-13.4, 0)).toBeCloseTo(22.11, 2);
  });
});
