import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allocatePot, opportunityScore, type Candidate } from "@/core/boss";
import { agentLevels } from "./levels";
import { cachedCompanyHealth } from "./company-health";
import { consensusFor } from "./forecast";
import { forecastOpinion, type ConsensusView } from "@/core/forecast";
import { historyAgrees, turnState } from "@/core/range";

/**
 * The boss's view of the team: which agents' stocks are in their buy zone now (price near the
 * 6-month low and already turning up, company not in danger), ranked best first. Prices are the latest each agent
 * recorded; `overrides` replaces them (e.g. the live MetaTrader quote). The levels are cached for
 * 60 s so every decision in the same minute sees the same picture.
 */
interface Watch { agentId: string; ticker: string; price: number; low: number; high: number; buyBelow: number; turnCloses: number[]; attention: boolean; consensus: ConsensusView | null }
let cache: { at: number; owner: string; rows: Watch[] } | null = null;

async function watchList(db: SupabaseClient, owner: string): Promise<Watch[]> {
  if (cache && cache.owner === owner && Date.now() - cache.at < 60000) return cache.rows;
  const [agents, assets, vitals, health] = await Promise.all([
    db.from("agents").select("id,status,enabled,autopilot,asset_id").eq("owner_id", owner),
    db.from("assets").select("id,ticker").eq("owner_id", owner),
    db.from("paper_agent_vitals").select("agent_id,mark_price").eq("owner_id", owner),
    cachedCompanyHealth(db, owner).catch(() => null),
  ]);
  if (agents.error || assets.error || vitals.error) throw new Error("BOSS_DATABASE_UNAVAILABLE");
  const rows: Watch[] = [];
  for (const agent of agents.data) {
    if (["DEAD", "FIRED"].includes(agent.status) || agent.enabled === false || agent.autopilot === false) continue;
    const ticker = assets.data.find((a) => a.id === agent.asset_id)?.ticker;
    const levels = ticker ? await agentLevels(db, ticker).catch(() => null) : null;
    if (!ticker || !levels?.available || !levels.range) continue;
    const level = health?.[ticker]?.level;
    // A company in danger, or a stock whose past visits to the low were not followed by rises.
    if (level === "PERIGO" || !historyAgrees(levels.history)) continue;
    const mark = vitals.data.find((v) => v.agent_id === agent.id)?.mark_price;
    rows.push({ agentId: agent.id, ticker, price: Number(mark ?? levels.lastClose), low: levels.range.low, high: levels.range.high,
      buyBelow: levels.range.buyBelow, turnCloses: levels.turnCloses, attention: level === "ATENCAO", consensus: await consensusFor(ticker).catch(() => null) });
  }
  cache = { at: Date.now(), owner, rows };
  return rows;
}

export async function teamCandidates(db: SupabaseClient, owner: string, overrides: Record<string, number> = {}): Promise<Candidate[]> {
  return (await watchList(db, owner))
    .map((w) => ({ ...w, price: overrides[w.ticker] ?? w.price }))
    // In its buy zone, already turning up, and not vetoed by the analysts' forecast.
    .filter((w) => w.price <= w.buyBelow && turnState(w.turnCloses, w.price).turned && forecastOpinion(w.price, w.consensus).vote !== "CONTRA")
    .map((w) => ({ agentId: w.agentId, price: w.price, fee: 0.99,
      score: opportunityScore(w.price, w.low, w.high, w.attention, forecastOpinion(w.price, w.consensus).upside) }));
}

/** How much of the free pot the boss releases to this agent now (0 when it is not its turn). */
export async function bossRelease(db: SupabaseClient, owner: string, agentId: string, pool: number, overrides: Record<string, number> = {}) {
  return allocatePot(pool, await teamCandidates(db, owner, overrides))[agentId] ?? 0;
}
