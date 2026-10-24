import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assessCompanyHealth, type CompanyHealth, type YearFigures } from "@/core/company-health";
import { companyProfile } from "@/core/context";
import { fetchCvmDfpArchive, parseCvmDfpArchive } from "@/providers/cvm";
import { softCached } from "./context";

const PROVIDER = "cvm-dfp";
const SOURCE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/";
export type TeamHealth = Record<string, CompanyHealth & { checkedAt: string }>;

/**
 * Weekly health check of the team's companies from the last two annual statements (two ~13 MB
 * downloads for all companies). Runs from the scheduler, never inside an agent's decision.
 */
export async function refreshCompanyHealth(db: SupabaseClient, owner: string) {
  const assets = await db.from("assets").select("ticker").eq("owner_id", owner);
  if (assets.error) throw assets.error;
  const tickers = [...new Set(assets.data.map((a) => String(a.ticker)))].sort();
  if (!tickers.length) return null;
  return softCached(PROVIDER, `HEALTH:V1:${tickers.join(",")}`, 7 * 86400000, 60 * 86400000, 4, SOURCE,
    () => assessTeam(tickers), undefined, 6 * 3600);
}

async function assessTeam(tickers: readonly string[]): Promise<TeamHealth> {
  const year = new Date().getUTCFullYear();
  const archives = await Promise.all([year - 1, year - 2].map(async (y) => ({ year: y, bytes: await fetchCvmDfpArchive(y).catch(() => null) })));
  const checkedAt = new Date().toISOString();
  const result: TeamHealth = {};
  for (const ticker of tickers) {
    const profile = companyProfile(ticker);
    const figures: YearFigures[] = [];
    let company = profile.name;
    for (const { year: y, bytes } of archives) {
      if (!bytes || !profile.cvmCode) continue;
      for (const scope of ["CONSOLIDATED", "INDIVIDUAL"] as const) {
        try {
          const f = parseCvmDfpArchive(bytes, { cvmCode: profile.cvmCode, year: y, scope }, checkedAt);
          const num = (v: { value: string } | null | undefined) => (v ? Number(v.value) : null);
          if (y === year - 1 || company === profile.name) company = f.document.companyName;
          figures.push({ year: y, revenue: num(f.metrics.revenue), netIncome: num(f.metrics.netIncome), equity: num(f.metrics.equity),
            netDebt: f.derived.netBorrowings === null ? null : Number(f.derived.netBorrowings) });
          break;
        } catch { /* try the individual statements, then give up on this year */ }
      }
    }
    result[ticker] = { ...assessCompanyHealth(company, figures), checkedAt };
  }
  return result;
}

/** Latest stored check (no download): what the agents use before buying. */
export async function cachedCompanyHealth(db: SupabaseClient, owner: string): Promise<TeamHealth | null> {
  const found = await db.from("market_data_cache").select("payload").eq("owner_id", owner).eq("provider", PROVIDER)
    .eq("data_kind", "READ_CACHE_V1").order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
  if (found.error) throw found.error;
  return (found.data?.payload as TeamHealth | undefined) ?? null;
}
