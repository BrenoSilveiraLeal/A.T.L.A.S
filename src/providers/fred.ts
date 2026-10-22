import "server-only";
import { ProviderError } from "./http";

/**
 * Daily Brent crude (US$/barrel) from FRED, series DCOILBRENTEU (source: U.S. EIA,
 * public domain; FRED asks for attribution). Public CSV, no key, no cost.
 */
export interface CommodityPoint { date: string; value: string }
export const BRENT_SOURCE = "https://fred.stlouisfed.org/series/DCOILBRENTEU";

export function parseFredCsv(csv: string, today: string): CommodityPoint[] {
  const lines = csv.trim().split(/\r?\n/);
  if (!/^(DATE|observation_date),DCOILBRENTEU$/.test(lines[0] ?? "")) throw new ProviderError("fred", "INVALID_RESPONSE");
  const points: CommodityPoint[] = [];
  for (const line of lines.slice(1)) {
    const [date, value] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new ProviderError("fred", "INVALID_RESPONSE");
    if (date > today) throw new ProviderError("fred", "FUTURE_DATA");
    if (value === "." || value === "") continue; // FRED marks holidays as "."
    if (!/^\d{1,4}(\.\d{1,4})?$/.test(value)) throw new ProviderError("fred", "INVALID_RESPONSE");
    points.push({ date, value });
  }
  if (!points.length) throw new ProviderError("fred", "EMPTY_DATA");
  return points;
}

export async function fetchBrent(transport: typeof fetch = fetch): Promise<CommodityPoint[]> {
  const start = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  let response: Response;
  try {
    response = await transport(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU&cosd=${start}`,
      { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ProviderError("fred", "TIMEOUT");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError("fred", "UNAVAILABLE", response.status);
  }
  const text = await response.text();
  if (text.length > 200_000) throw new ProviderError("fred", "INVALID_RESPONSE");
  return parseFredCsv(text, new Date().toISOString().slice(0, 10));
}
