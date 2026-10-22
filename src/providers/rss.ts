import "server-only";
import { ProviderError } from "./http";
import { decodeXml } from "./agencia-brasil";
import type { Headline } from "./gdelt";
import type { ProviderName } from "./types";

/**
 * Public market-news RSS feeds read like a personal feed reader: only title, link and
 * date are kept, shown privately to the owner with the source name and a link back.
 * InfoMoney is on by default (public feed, robots allow all). Money Times' terms forbid
 * reproduction without written authorization, so it stays off unless the owner enables it.
 */
export interface RssFeed { provider: ProviderName; url: string; origin: string; domain: string }
export const MARKET_FEEDS: Record<"infomoney" | "moneytimes", RssFeed> = {
  infomoney: { provider: "infomoney", url: "https://www.infomoney.com.br/feed/", origin: "https://www.infomoney.com.br/", domain: "infomoney.com.br" },
  moneytimes: { provider: "moneytimes", url: "https://www.moneytimes.com.br/feed/", origin: "https://www.moneytimes.com.br/", domain: "moneytimes.com.br" },
};
const MAX_BYTES = 3 * 1024 * 1024;
const tag = (item: string, name: string) => item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

export function parseRss(feed: RssFeed, xml: string, now: number): Headline[] {
  if (xml.length > MAX_BYTES || !/<rss[\s>]/.test(xml)) throw new ProviderError(feed.provider, "INVALID_RESPONSE");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 60).flatMap(([, item]) => {
    const title = decodeXml(tag(item, "title") ?? "");
    const url = decodeXml(tag(item, "link") ?? "");
    const published = Date.parse(decodeXml(tag(item, "pubDate") ?? ""));
    if (!title || !url.startsWith(feed.origin) || !Number.isFinite(published)) return [];
    if (published > now + 60_000) throw new ProviderError(feed.provider, "FUTURE_DATA");
    return [{ title: title.slice(0, 500), url, domain: feed.domain, language: "Portuguese", seenAt: new Date(published).toISOString() }];
  });
}

export async function fetchRss(feed: RssFeed, transport: typeof fetch = fetch): Promise<Headline[]> {
  let response: Response;
  try {
    response = await transport(feed.url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "ATLAS personal feed reader" } });
  } catch {
    throw new ProviderError(feed.provider, "TIMEOUT");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(feed.provider, "UNAVAILABLE", response.status);
  }
  return parseRss(feed, await response.text(), Date.now());
}

/** Feeds enabled for this installation (Money Times only with ATLAS_NEWS_MONEYTIMES=true). */
export function enabledMarketFeeds(env: Record<string, string | undefined> = process.env): RssFeed[] {
  return [MARKET_FEEDS.infomoney, ...(env.ATLAS_NEWS_MONEYTIMES === "true" ? [MARKET_FEEDS.moneytimes] : [])];
}
