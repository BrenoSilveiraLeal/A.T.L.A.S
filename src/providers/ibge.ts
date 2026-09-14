import "server-only";
import { z } from "zod";
import { getJson, parseResponse, ProviderError } from "./http";
import { canonicalNewsUrl, deduplicateNews, newsHash, plainText } from "./news-normalization";
import { checkedTimestamp, parseBrazilDate } from "./validation";
import type { NewsArticle } from "./types";

const newsSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(), titulo: z.string().min(1).max(2000),
    introducao: z.string().max(20_000), data_publicacao: z.string(),
    link: z.string().url().max(4000), editorias: z.string().max(1000),
  })).max(20),
});

export async function fetchNews(): Promise<NewsArticle[]> {
  const url = new URL("https://servicodados.ibge.gov.br/api/v3/noticias/");
  url.searchParams.set("qtd", "20");
  const payload = parseResponse("ibge", newsSchema, await getJson("ibge", url));
  const now = Date.now();
  const retrievedAt = new Date(now).toISOString();
  const articles = payload.items.map((item): NewsArticle => {
    const title = plainText(item.titulo);
    const summary = plainText(item.introducao);
    if (!title) throw new ProviderError("ibge", "INVALID_RESPONSE");
    const contentHash = newsHash(title, summary);
    return {
      id: `ibge:${item.id}`, source: "IBGE", sourceUrl: url.toString(), url: canonicalNewsUrl(item.link),
      title, summary, publishedAt: checkedTimestamp("ibge", parseBrazilDate("ibge", item.data_publicacao, true), now),
      retrievedAt, contentHash, eventClusterId: `exact:${contentHash}`,
      companies: [], tickers: [], category: item.editorias.split(",").includes("economicas") ? "MACRO" : "INSTITUTIONAL",
      relevance: null, sentiment: null, confidence: null, expectedImpact: null, impactHorizon: null, analysisStatus: "UNCLASSIFIED",
    };
  });
  return deduplicateNews(articles).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
