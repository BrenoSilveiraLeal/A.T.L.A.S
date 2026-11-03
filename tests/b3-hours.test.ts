import { describe, expect, it } from "vitest";
import { b3Session, closingCall, safeWindow, sessionEnd } from "@/core/b3-calendar";
import { meetingDue, meetingStart } from "@/core/meeting";

// Ofício Circular 055/2026-VNC: from 03/11/2026 cash equities trade 10:00–17:55, closing call to 18:00.
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);

describe("B3 hours follow the official grid (03/11/2026: purchases stopped at 16:50 while the session ran to 18:00)", () => {
  it("closes at 17:00 until 02/11/2026 and at 18:00 from 03/11/2026", () => {
    expect([closingCall("2026-10-30"), sessionEnd("2026-10-30")]).toEqual(["16:55", "17:00"]);
    expect([closingCall("2026-11-03"), sessionEnd("2026-11-03")]).toEqual(["17:55", "18:00"]);
    expect(safeWindow("2026-11-03")).toEqual({ open: "10:05", close: "17:50" });
  });

  it("keeps trading open until 17:50 now, and 16:50 before the change", () => {
    expect(b3Session(at("2026-11-03", "17:30")).status).toBe("OPEN");
    expect(b3Session(at("2026-11-03", "17:50")).status).toBe("CLOSED");
    expect(b3Session(at("2026-10-30", "16:55")).status).toBe("CLOSED");
  });

  it("falls back to the shorter day once past the last date the grid is known for", () => {
    expect(closingCall("2027-04-01")).toBeNull();
    expect(safeWindow("2027-04-01").close).toBe("16:50");
    expect(sessionEnd("2027-04-01")).toBe("17:00");
  });

  it("holds the meeting 5 minutes after the real close", () => {
    expect(meetingStart("2026-11-03")).toBe("18:05");
    expect(meetingDue(at("2026-11-03", "17:30")).due).toBe(false);
    expect(meetingDue(at("2026-11-03", "18:06"))).toMatchObject({ due: true, gathering: true });
    expect(meetingStart("2026-10-30")).toBe("17:05");
  });
});

describe("purchases only in the last hour of the session (03/11/2026)", () => {
  it("opens the buy window an hour before the safe close", async () => {
    const { buyWindow } = await import("@/core/b3-calendar");
    expect(buyWindow(at("2026-11-04", "16:49"))).toEqual({ open: false, from: "16:50" });
    expect(buyWindow(at("2026-11-04", "17:10")).open).toBe(true);
    expect(buyWindow(at("2026-11-04", "17:51")).open).toBe(false);
    expect(buyWindow(at("2026-10-30", "16:00")).open).toBe(true);
  });
});
