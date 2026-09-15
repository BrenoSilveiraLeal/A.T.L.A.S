import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });
const statuses = new Set(["GREEN", "YELLOW", "RED", "UNCONFIGURED"]);
type Freshness = "CURRENT" | "EXPIRED" | "FUTURE" | "INVALID";

function parseTimestamp(value: unknown): number | null {
  if (!timestampSchema.safeParse(value).success) return null;
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A persisted success is evidence of a past check, not an indefinite heartbeat. */
export function normalizeHealth<T extends Record<string, unknown>>(
  row: T,
  now = Date.now(),
) {
  const checked = parseTimestamp(row.checked_at);
  const expires = parseTimestamp(row.expires_at);
  const validNow =
    Number.isFinite(now) && !Number.isNaN(new Date(now).getTime());
  const reportedStatus = typeof row.status === "string" ? row.status : null;
  let freshness: Freshness = "CURRENT";
  if (
    !validNow ||
    checked === null ||
    expires === null ||
    expires <= checked ||
    !reportedStatus ||
    !statuses.has(reportedStatus)
  ) {
    freshness = "INVALID";
  } else if (checked > now) {
    freshness = "FUTURE";
  } else if (expires <= now) {
    freshness = "EXPIRED";
  }
  const explanation = {
    EXPIRED:
      "Verificação expirada. O estado atual deste componente não foi confirmado.",
    FUTURE:
      "Horário da verificação está no futuro. O estado atual não foi confirmado.",
    INVALID:
      "Evidência de saúde inválida ou incompleta. O estado atual não foi confirmado.",
  };
  return {
    ...row,
    status: freshness === "CURRENT" ? reportedStatus : "UNKNOWN",
    reported_status: reportedStatus,
    message: freshness === "CURRENT" ? row.message : explanation[freshness],
    reported_message: row.message ?? null,
    freshness,
    age_seconds:
      checked !== null && validNow && checked <= now
        ? Math.floor((now - checked) / 1000)
        : null,
    evaluated_at: validNow ? new Date(now).toISOString() : null,
  };
}
