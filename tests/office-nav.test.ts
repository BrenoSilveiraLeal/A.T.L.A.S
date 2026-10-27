import { describe, expect, it } from "vitest";
import { NavGrid, type V2 } from "@/core/office-nav";

// A 10 x 10 room with a table in the middle and a wall with a door on the right.
const room = new NavGrid([0, 0, 10, 10], [[3, 3, 6, 6], [8, 0, 8.2, 4], [8, 5, 8.2, 10]]);

const crosses = (path: V2[], from: V2) => {
  let at = from;
  for (const p of path) {
    for (let s = 0; s <= 20; s++) {
      const x = at[0] + ((p[0] - at[0]) * s) / 20, z = at[1] + ((p[1] - at[1]) * s) / 20;
      if (x > 3 && x < 6 && z > 3 && z < 6) return true;
    }
    at = p;
  }
  return false;
};

describe("office floor: furniture and walls block the way", () => {
  it("walks around the table instead of through it", () => {
    const path = room.path([1, 4.5], [7, 4.5])!;
    expect(path.at(-1)).toEqual([7, 4.5]);
    expect(crosses(path, [1, 4.5])).toBe(false);
  });
  it("goes through the door to reach the other side of a wall", () => {
    const path = room.path([7, 2], [9.5, 2])!;
    expect(path.some(([, z]) => z > 4 && z < 5)).toBe(true);
  });
  it("first-person collision: the boss cannot stand inside the table or a wall", () => {
    expect(room.blocks(4.5, 4.5, 0.3)).toBe(true);
    expect(room.blocks(8.1, 2, 0.3)).toBe(true);
    expect(room.blocks(1, 1, 0.3)).toBe(false);
    expect(room.blocks(-0.1, 5, 0.3)).toBe(true);
  });
});
