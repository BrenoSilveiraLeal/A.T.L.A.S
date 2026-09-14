import "server-only";
import { createHash } from "node:crypto";
import type { NewsArticle } from "./types";
import { ProviderError } from "./http";

export function plainText(value: string): string {
  // Output is text only. Consumers must use normal escaped React text nodes, never innerHTML.
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function newsHash(title: string, summary: string): string {
  const normalized = `${title} ${summary}`
    .normalize("NFKC")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function canonicalNewsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError("ibge", "INVALID_RESPONSE");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "ibge.gov.br" || url.hostname.endsWith(".ibge.gov.br"))
  ) {
    throw new ProviderError("ibge", "INVALID_RESPONSE");
  }
  url.protocol = "https:";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || key === "fbclid")
      url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

/** Exact republications share one observation; semantic event clustering remains pending. */
export function deduplicateNews(articles: NewsArticle[]): NewsArticle[] {
  const urls = new Set<string>();
  const hashes = new Set<string>();
  return articles.filter((article) => {
    if (urls.has(article.url) || hashes.has(article.contentHash)) return false;
    urls.add(article.url);
    hashes.add(article.contentHash);
    return true;
  });
}
