import Decimal from "decimal.js";

/** Format decimal strings without losing cents through JavaScript Number. */
export function formatDecimal(value: unknown, places = 2): string {
  if (!Number.isInteger(places) || places < 0 || places > 10) return "—";
  if (typeof value !== "string" && typeof value !== "number") return "—";
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
  )
    return "—";
  const raw = String(value);
  if (!/^-?\d{1,28}(?:\.\d{1,10})?$/.test(raw)) return "—";
  const fixed = new Decimal(raw).toFixed(places, Decimal.ROUND_HALF_UP);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

export function formatBrl(value: unknown): string {
  const amount = formatDecimal(value);
  return amount === "—" ? amount : `R$ ${amount}`;
}
