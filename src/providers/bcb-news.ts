import "server-only";
import { ProviderError } from "./http";
import { decodeXml } from "./agencia-brasil";
import type { Headline } from "./gdelt";

/**
 * Banco Central news feed (Atom, public, no key): Copom, rates, inflation reports.
 * Only title, link and date are kept, labelled "Banco Central".
 */
const FEED = "https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias";
const MAX_BYTES = 2 * 1024 * 1024;
const tag = (entry: string, name: string) => entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

export function parseBcbNewsAtom(xml: string, now: number): Headline[] {
  if (xml.length > MAX_BYTES || !/<feed[\s>]/.test(xml)) throw new ProviderError("bcb", "INVALID_RESPONSE");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 50).flatMap(([, entry]) => {
    const title = decodeXml(tag(entry, "title") ?? "");
    const url = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    const published = Date.parse(decodeXml(tag(entry, "updated") ?? ""));
    if (!title || !url.startsWith("https://www.bcb.gov.br/") || !Number.isFinite(published)) return [];
    if (published > now + 60_000) throw new ProviderError("bcb", "FUTURE_DATA");
    return [{ title: title.slice(0, 500), url, domain: "bcb.gov.br", language: "Portuguese", seenAt: new Date(published).toISOString() }];
  });
}

export async function fetchBcbNews(transport: typeof fetch = fetch): Promise<Headline[]> {
  let response: Response;
  try {
    response = await transport(FEED, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ProviderError("bcb", "TIMEOUT");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError("bcb", "UNAVAILABLE", response.status);
  }
  return parseBcbNewsAtom(await response.text(), Date.now());
}
