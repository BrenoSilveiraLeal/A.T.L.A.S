import "server-only";
import { z } from "zod";
import { ProviderError } from "./http";

/**
 * Headlines from the open GDELT DOC 2.0 API (no key, no cost). GDELT asks for at most
 * one request every 5 seconds, so this makes exactly ONE attempt and never retries;
 * callers cache results. Tone endpoints are not used: they are throttled more often.
 */
export interface Headline {
  title: string;
  url: string;
  domain: string;
  language: string;
  seenAt: string;
}

const articleSchema = z.object({
  url: z.url({ protocol: /^https?$/ }), title: z.string().max(1000), domain: z.string().max(300),
  language: z.string().max(60), seendate: z.string().regex(/^\d{8}T\d{6}Z$/),
}).loose();
const responseSchema = z.object({ articles: z.array(articleSchema).max(250).optional() }).loose();
const MAX_BYTES = 1024 * 1024;

export function gdeltUrl(query: string, timespan = "24h", maxRecords = 50) {
  if (!query.trim() || query.length > 300 || !/^\d{1,3}[hd]$/.test(timespan) || maxRecords < 1 || maxRecords > 250)
    throw new ProviderError("gdelt", "INVALID_INPUT");
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.search = new URLSearchParams({ query, mode: "artlist", format: "json", sort: "datedesc",
    timespan, maxrecords: String(maxRecords) }).toString();
  return url;
}

export function parseGdeltHeadlines(body: string, now: number): Headline[] {
  let json: unknown;
  try { json = JSON.parse(body); } catch {
    // GDELT answers throttled requests with a plain-text notice and HTTP 200.
    throw new ProviderError("gdelt", /limit requests/i.test(body) ? "RATE_LIMITED" : "INVALID_RESPONSE");
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError("gdelt", "INVALID_RESPONSE");
  return (parsed.data.articles ?? []).map((a) => {
    const d = a.seendate;
    const seenAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`;
    if (Number.isNaN(Date.parse(seenAt))) throw new ProviderError("gdelt", "INVALID_RESPONSE");
    if (Date.parse(seenAt) > now + 60_000) throw new ProviderError("gdelt", "FUTURE_DATA");
    // GDELT tokenizes punctuation with spaces ("0 . 9 %"); collapse for readability.
    const title = a.title.replace(/\s+([.,;:!?%])/g, "$1").replace(/\s+/g, " ").trim();
    return { title, url: a.url, domain: a.domain, language: a.language, seenAt };
  });
}

export async function fetchHeadlines(query: string, timespan = "24h", maxRecords = 50, transport: typeof fetch = fetch): Promise<Headline[]> {
  const url = gdeltUrl(query, timespan, maxRecords);
  let response: Response;
  try {
    response = await transport(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new ProviderError("gdelt", "TIMEOUT");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError("gdelt", response.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE", response.status);
  }
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new ProviderError("gdelt", "INVALID_RESPONSE");
  return parseGdeltHeadlines(text, Date.now());
}
