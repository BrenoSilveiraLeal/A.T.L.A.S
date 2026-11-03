import { describe, expect, it } from "vitest";
import { INITIAL_STATUS } from "@/core/daytrade/desks";
import { newsWorker, type MarketEvent, type NewsSnapshot } from "@/core/daytrade/agents";
import { parseBcbIcs } from "@/lib/daytrade/news";

const now = "2026-11-03T13:00:00.000Z";

function snapshot(events: MarketEvent[] = [], overrides: Partial<NewsSnapshot> = {}): NewsSnapshot {
  return { events, complete: true, source: "BCB calendar, BCB news, RSS", refreshedAt: now, ...overrides };
}

function event(impact: MarketEvent["impact"], kind: MarketEvent["kind"] = "NEWS"): MarketEvent {
  return {
    kind, title: `Evento ${impact}`, at: now, impact,
    provenance: { source: "BCB", receivedAt: now, delayMs: 0, simulated: false },
  };
}

describe("DASH news and calendar gate", () => {
  it("fails closed when feed coverage is incomplete or stale", () => {
    const incomplete = newsWorker.step(snapshot([], { complete: false }), { status: INITIAL_STATUS, now, limits: null });
    const stale = newsWorker.step(snapshot([], { refreshedAt: "2026-11-03T12:00:00.000Z" }), { status: INITIAL_STATUS, now, limits: null });
    expect(incomplete.state).toBe("BLOCKED");
    expect(incomplete.output?.blockEntries).toBe(true);
    expect(stale.state).toBe("BLOCKED");
    expect(stale.output?.sizeFactor).toBe(0);
  });

  it("blocks high-impact and halt events while shrinking medium-impact exposure", () => {
    const high = newsWorker.step(snapshot([event("HIGH")]), { status: INITIAL_STATUS, now, limits: null });
    const halt = newsWorker.step(snapshot([event("LOW", "HALT")]), { status: INITIAL_STATUS, now, limits: null });
    const medium = newsWorker.step(snapshot([event("MEDIUM")]), { status: INITIAL_STATUS, now, limits: null });
    expect(high.output?.blockEntries).toBe(true);
    expect(halt.output?.blockEntries).toBe(true);
    expect(medium.state).toBe("WORKING");
    expect(medium.output?.sizeFactor).toBe(0.5);
  });

  it("parses a complete BCB all-day event and rejects malformed event records", () => {
    const calendar = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "SUMMARY:Reuniao do Copom",
      "DTSTART;VALUE=DATE:20261103", "DTEND;VALUE=DATE:20261104", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    expect(parseBcbIcs(calendar)).toEqual([
      { title: "Reuniao do Copom", start: "2026-11-03T09:00:00-03:00", allDay: true },
    ]);
    expect(() => parseBcbIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No date\nEND:VEVENT\nEND:VCALENDAR")).toThrow();
    expect(parseBcbIcs("BEGIN:VCALENDAR\nEND:VCALENDAR")).toEqual([]);
  });
});
