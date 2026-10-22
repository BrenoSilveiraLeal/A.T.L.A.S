import "server-only";
import { ProviderError } from "./http";
import type { Headline } from "./gdelt";

/**
 * Agência Brasil (EBC, public broadcaster) RSS feeds. EBC allows free non-commercial
 * reuse with the source cited; ATLAS is personal and keeps only title, link and date,
 * always labelled "Agência Brasil". No key, no cost. Each feed lists the latest ~10 items.
 */
export const AGENCIA_BRASIL_FEEDS = ["economia", "internacional", "geral", "ultimasnoticias"] as const;
const ORIGIN = "https://agenciabrasil.ebc.com.br/";
const MAX_BYTES = 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
export const decodeXml = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  }).replace(/\s+/g, " ").trim();
const tag = (item: string, name: string) => item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

export function parseAgenciaBrasilRss(xml: string, now: number): Headline[] {
  if (xml.length > MAX_BYTES || !/<rss[\s>]/.test(xml)) throw new ProviderError("agenciabrasil", "INVALID_RESPONSE");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 50).flatMap(([, item]) => {
    const title = decodeXml(tag(item, "title") ?? "");
    const url = decodeXml(tag(item, "link") ?? "");
    const published = Date.parse(decodeXml(tag(item, "pubDate") ?? ""));
    if (!title || !url.startsWith(ORIGIN) || !Number.isFinite(published)) return [];
    if (published > now + 60_000) throw new ProviderError("agenciabrasil", "FUTURE_DATA");
    return [{ title: title.slice(0, 500), url, domain: "agenciabrasil.ebc.com.br", language: "Portuguese",
      seenAt: new Date(published).toISOString() }];
  });
}

export async function fetchAgenciaBrasilHeadlines(transport: typeof fetch = fetch): Promise<Headline[]> {
  const results = await Promise.all(AGENCIA_BRASIL_FEEDS.map(async (feed) => {
    let response: Response;
    try {
      response = await transport(`${ORIGIN}rss/${feed}/feed.xml`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ProviderError("agenciabrasil", "TIMEOUT");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError("agenciabrasil", "UNAVAILABLE", response.status);
    }
    return parseAgenciaBrasilRss(await response.text(), Date.now());
  }));
  // The same story often appears in several feeds.
  const unique = new Map(results.flat().map((h) => [h.url, h]));
  return [...unique.values()].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
}
