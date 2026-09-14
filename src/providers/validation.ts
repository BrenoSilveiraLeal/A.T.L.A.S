import "server-only";
import Decimal from "decimal.js";
import { z } from "zod";
import { ProviderError } from "./http";
import type { ProviderName } from "./types";

export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}\d{1,2}F?$/);
export const decimalSchema = z
  .union([
    z.number().finite(),
    z
      .string()
      .max(40)
      .regex(/^-?\d+(?:\.\d+)?$/),
  ])
  .transform((value) => new Decimal(value).toFixed());
export const positivePriceSchema = decimalSchema.refine((value) =>
  new Decimal(value).gt(0),
);
export const isoTimestampSchema = z.iso.datetime({ offset: true });

export function checkedTicker(ticker: string): string {
  const parsed = tickerSchema.safeParse(ticker);
  if (!parsed.success) throw new ProviderError("brapi", "INVALID_INPUT");
  return parsed.data;
}

export function checkedTimestamp(
  provider: ProviderName,
  value: string | number,
  now: number,
): string {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0)
    throw new ProviderError(provider, "INVALID_RESPONSE");
  if (timestamp > now) throw new ProviderError(provider, "FUTURE_DATA");
  return new Date(timestamp).toISOString();
}

const brazilParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsAt(timestamp: number) {
  return Object.fromEntries(
    brazilParts
      .formatToParts(timestamp)
      .map(({ type, value }) => [type, value]),
  );
}

export function brazilDate(timestamp: number): string {
  const p = partsAt(timestamp);
  return `${p.year}-${p.month}-${p.day}`;
}

/** IBGE local publication times and SGS reference dates use Brazilian civil time. */
export function parseBrazilDate(
  provider: ProviderName,
  value: string,
  withTime = false,
): string {
  const match = value.match(
    withTime
      ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/
      : /^(\d{2})\/(\d{2})\/(\d{4})$/,
  );
  if (!match) throw new ProviderError(provider, "INVALID_RESPONSE");
  const [, day, month, year, hour = "00", minute = "00", second = "00"] = match;
  const wall = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  // Confirm the conversion using IANA timezone data; this also rejects invalid dates.
  for (const offsetHours of [3, 2]) {
    const timestamp = wall + offsetHours * 60 * 60 * 1000;
    const p = partsAt(timestamp);
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    ) {
      return new Date(timestamp).toISOString();
    }
  }
  throw new ProviderError(provider, "INVALID_RESPONSE");
}
