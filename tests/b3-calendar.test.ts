import { describe, expect, it } from "vitest";
import { b3Session } from "@/core/b3-calendar";

// São Paulo is UTC-3 all year (no daylight saving since 2019).
const at = (local: string) => new Date(`${local}-03:00`);

describe("B3 session guard", () => {
  it("opens only inside the conservative window on business days", () => {
    expect(b3Session(at("2026-10-22T10:04:00")).status).toBe("CLOSED");
    expect(b3Session(at("2026-10-22T10:05:00")).status).toBe("OPEN");
    expect(b3Session(at("2026-10-22T16:49:00")).status).toBe("OPEN");
    expect(b3Session(at("2026-10-22T16:50:00")).status).toBe("CLOSED");
    expect(b3Session(at("2026-10-22T05:54:00")).status).toBe("CLOSED");
  });

  it("closes on weekends and official holidays", () => {
    expect(b3Session(at("2026-10-24T12:00:00")).reason).toContain("Fim de semana");
    expect(b3Session(at("2026-11-20T12:00:00")).reason).toContain("Consciência Negra");
    expect(b3Session(at("2026-02-16T12:00:00")).status).toBe("CLOSED");
    expect(b3Session(at("2026-07-09T12:00:00")).status).toBe("OPEN"); // São Paulo municipal holiday, B3 opens
  });

  it("respects the Ash Wednesday late open", () => {
    expect(b3Session(at("2026-02-18T12:00:00")).status).toBe("CLOSED");
    expect(b3Session(at("2026-02-18T13:05:00")).status).toBe("OPEN");
  });

  it("flags provisional years and blocks unknown ones", () => {
    expect(b3Session(at("2027-03-26T12:00:00"))).toMatchObject({ status: "CLOSED", provisional: true });
    expect(b3Session(at("2028-03-01T12:00:00")).status).toBe("UNKNOWN");
    expect(b3Session(new Date("invalid")).status).toBe("UNKNOWN");
  });
});
