import Decimal from "decimal.js";

/** Keep amounts as decimal strings at every I/O boundary. No JS float coercion. */
const FinancialDecimal = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_EVEN });
const AMOUNT = /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,8})?$/;

export type DecimalString = string;

export function decimal(value: DecimalString): Decimal {
  if (typeof value !== "string" || !AMOUNT.test(value)) {
    throw new Error("INVALID_DECIMAL: expected a plain decimal string, at most 18 integer and 8 fractional digits");
  }
  const result = new FinancialDecimal(value);
  if (!result.isFinite()) throw new Error("INVALID_DECIMAL");
  return result;
}

/** Explicit accounting quantization; never converts through Number. */
export function money(value: Decimal | DecimalString): DecimalString {
  const parsed = typeof value === "string" ? decimal(value) : value;
  if (!parsed.isFinite()) throw new Error("INVALID_DECIMAL");
  const quantized = parsed.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed();
  decimal(quantized);
  return quantized === "-0" ? "0" : quantized;
}

export function sum(values: readonly DecimalString[]): DecimalString {
  return money(values.reduce((total, value) => total.plus(decimal(value)), decimal("0")));
}

export function isNonNegativeAmount(value: unknown): value is DecimalString {
  try { return typeof value === "string" && decimal(value).gte(0); } catch { return false; }
}

export function isPositiveAmount(value: unknown): value is DecimalString {
  try { return typeof value === "string" && decimal(value).gt(0); } catch { return false; }
}

export function isShareQuantity(value: unknown, allowZero = false): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

/** Offset is mandatory: timestamps without a timezone are ambiguous. */
export function timestamp(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("INVALID_TIMESTAMP");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    throw new Error("INVALID_TIMESTAMP");
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("INVALID_TIMESTAMP");
  return result;
}
