import { describe, expect, it } from "vitest";
import { swings } from "@/core/swings";

const series = (closes: number[]) => closes.map((close, i) => ({ date: `2026-05-${String(i + 1).padStart(2, "0")}`, close }));

describe("main rises and falls", () => {
  it("finds a fall and the rise after it, ignoring small wiggles", () => {
    const legs = swings(series([86, 84, 85, 80, 75, 70, 72, 65, 61.5, 63, 66, 70]));
    expect(legs.map((l) => [l.from.price, l.to.price, Math.round(l.change * 100)])).toEqual([[86, 61.5, -28], [61.5, 70, 14]]);
    expect(legs[0].to.date).toBe("2026-05-09");
  });
  it("returns nothing when the price barely moves", () => {
    expect(swings(series([50, 51, 50.5, 52, 51]))).toEqual([]);
  });
});
