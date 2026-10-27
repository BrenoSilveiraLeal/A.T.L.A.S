import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { moveStep } from "@/lib/movers";

describe("big moves of the team's stocks", () => {
  it("counts 3% steps of today's move, up or down", () => {
    expect([moveStep(0.029), moveStep(0.031), moveStep(-0.065), moveStep(-0.45)]).toEqual([0, 1, 2, 15]);
  });
});
