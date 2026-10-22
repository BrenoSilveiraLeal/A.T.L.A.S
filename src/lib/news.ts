import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAgenciaBrasilHeadlines } from "@/providers/agencia-brasil";
import { fetchBcbNews } from "@/providers/bcb-news";
import type { Headline } from "@/providers/gdelt";
import type { CvmCompany, CvmMaterialFact } from "@/providers/cvm";
import { headlineTone, resolveCompany } from "@/core/context";
import { tagHeadline, type NewsProfile, type NewsTag } from "@/core/news";
import { cachedOnly, softCached } from "./context";

const SOURCES: Record<string, string> = { "agenciabrasil.ebc.com.br": "Agência Brasil", "bcb.gov.br": "Banco Central" };
const KEEP_DAYS = 30;

interface NewsRow { owner_id: string; url: string; title: string; source: string; published_at: string; tags: NewsTag[] }

/**
 * Collects the latest free headlines, tags them per agent ticker and stores them once.
 * Agência Brasil and Banco Central are fetched (hourly cache); GDELT and CVM are read only
 * from the scheduler's cache so the TV never spends their tight rate allowance.
 */
async function refreshNews(db: SupabaseClient, ownerId: string) {
  const year = new Date().getUTCFullYear();
  const [assets, agency, bcb, market, ipe] = await Promise.all([
    db.from("assets").select("ticker,company_name").eq("owner_id", ownerId).eq("active", true),
    softCached("agenciabrasil", "HEADLINES", 3600000, 12 * 3600000, 200, "https://agenciabrasil.ebc.com.br/", () => fetchAgenciaBrasilHeadlines()),
    softCached("bcb", "NEWS", 3600000, 3 * 86400000, 50, "https://www.bcb.gov.br/", () => fetchBcbNews()),
    cachedOnly<Headline[]>("gdelt", "MARKET", 12 * 3600000),
    cachedOnly<{ facts: CvmMaterialFact[]; companies: CvmCompany[] }>("cvm-ipe", `IPE2:${year}`, 8 * 86400000),
  ]);
  if (assets.error) throw assets.error;
  const profiles: (NewsProfile & { cvmCode: string | null })[] = assets.data.map((a) => {
    const profile = resolveCompany(a.ticker, a.company_name, ipe?.companies ?? null);
    return { ticker: a.ticker, profile, cvmCode: profile.cvmCode };
  });
  const company = await Promise.all(profiles.map((p) => cachedOnly<Headline[]>("gdelt", `COMPANY:${p.ticker}`, 12 * 3600000)));
  const since = Date.now() - 2 * 86400000;
  const rows = new Map<string, NewsRow>();
  for (const h of [agency, bcb, market, ...company].flatMap((list) => list ?? [])) {
    if (Date.parse(h.seenAt) < since || !/^https:\/\//.test(h.url) || h.url.length > 1000) continue;
    rows.set(h.url, { owner_id: ownerId, url: h.url, title: h.title.slice(0, 500), source: (SOURCES[h.domain] ?? h.domain).slice(0, 80),
      published_at: h.seenAt, tags: tagHeadline(h.title, profiles) });
  }
  const sinceDay = new Date(since).toISOString().slice(0, 10);
  for (const fact of ipe?.facts ?? []) {
    const owner = profiles.find((p) => p.cvmCode && p.cvmCode === fact.cvmCode);
    if (!owner || fact.deliveredOn < sinceDay || !/^https:\/\//.test(fact.url)) continue;
    const { severe } = headlineTone(fact.subject);
    rows.set(fact.url, { owner_id: ownerId, url: fact.url, title: `Fato relevante de ${owner.profile.name}: ${fact.subject}`.slice(0, 500),
      source: "CVM", published_at: new Date(`${fact.deliveredOn}T12:00:00-03:00`).toISOString(),
      tags: [{ ticker: owner.ticker, direction: severe ? "DOWN" : "WATCH", why: "fato relevante" }] });
  }
  if (rows.size) {
    const saved = await db.from("news_items").upsert([...rows.values()], { onConflict: "owner_id,url", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
  }
  await db.from("news_items").delete().eq("owner_id", ownerId).lt("published_at", new Date(Date.now() - KEEP_DAYS * 86400000).toISOString());
}

/** Latest stored headlines; refreshes at most every 5 minutes (any viewer or tick). */
export async function loadNews(db: SupabaseClient, ownerId: string, ticker?: string) {
  const allowed = await db.rpc("consume_rate_limit", { p_key: `news:refresh:${ownerId}`, p_limit: 1, p_window_seconds: 300 });
  if (!allowed.error && allowed.data) await refreshNews(db, ownerId).catch(() => undefined);
  const rows = await db.from("news_items").select("url,title,source,published_at,tags").eq("owner_id", ownerId)
    .order("published_at", { ascending: false }).limit(300);
  if (rows.error) throw rows.error;
  // A ticker view lists its own news plus market-wide news.
  const items = ticker ? rows.data.filter((r) => (r.tags as NewsTag[]).some((t) => t.ticker === ticker || t.ticker === "*")) : rows.data.slice(0, 60);
  return { items };
}
