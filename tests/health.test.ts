import { describe, expect, it } from "vitest";
import { normalizeHealth } from "@/lib/health";

const now = Date.parse("2026-09-14T15:00:00Z");
const evidence = {
  component: "SCHEDULER",
  status: "GREEN",
  message: "Worker completed its check.",
  checked_at: "2026-09-14T14:59:00Z",
  expires_at: "2026-09-14T15:02:00Z",
};

describe("health evidence freshness", () => {
  it("preserves a current status with its age and original evidence", () => {
    expect(normalizeHealth(evidence, now)).toMatchObject({
      status: "GREEN",
      reported_status: "GREEN",
      freshness: "CURRENT",
      age_seconds: 60,
      checked_at: evidence.checked_at,
      expires_at: evidence.expires_at,
    });
  });
  it("expires exactly at the deadline, without claiming current health", () => {
    const result = normalizeHealth(evidence, Date.parse(evidence.expires_at));
    expect(result).toMatchObject({
      status: "UNKNOWN",
      reported_status: "GREEN",
      reported_message: evidence.message,
      freshness: "EXPIRED",
    });
    expect(result.message).toContain("expirada");
    expect(evidence.status).toBe("GREEN");
  });
  it("normalizes equivalent offset timestamps and PostgreSQL microseconds", () => {
    expect(
      normalizeHealth(
        {
          ...evidence,
          checked_at: "2026-09-14T11:59:00.000000-03:00",
          expires_at: "2026-09-14T12:02:00.000000-03:00",
        },
        now,
      ),
    ).toMatchObject({ status: "GREEN", freshness: "CURRENT", age_seconds: 60 });
  });
  it("rejects a heartbeat checked in the future", () => {
    expect(
      normalizeHealth(
        {
          ...evidence,
          checked_at: "2026-09-14T15:01:00Z",
        },
        now,
      ),
    ).toMatchObject({
      status: "UNKNOWN",
      freshness: "FUTURE",
      age_seconds: null,
    });
  });
  it.each([
    { checked_at: "2026-09-14T14:59:00" },
    { checked_at: "2026-02-30T14:59:00Z" },
    { expires_at: null },
    { expires_at: "2026-09-14T14:58:00Z" },
    { status: "SUCCESS_ASSUMED" },
  ])("marks malformed or ambiguous evidence UNKNOWN: %j", (patch) => {
    expect(normalizeHealth({ ...evidence, ...patch }, now)).toMatchObject({
      status: "UNKNOWN",
      freshness: "INVALID",
    });
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1e100])(
    "fails closed for an invalid evaluation clock: %s",
    (clock) => {
      expect(normalizeHealth(evidence, clock)).toMatchObject({
        status: "UNKNOWN",
        freshness: "INVALID",
        evaluated_at: null,
      });
    },
  );
  it.each(["RED", "YELLOW", "UNCONFIGURED"])(
    "does not elevate a current %s state",
    (status) => {
      expect(normalizeHealth({ ...evidence, status }, now).status).toBe(status);
    },
  );
});
