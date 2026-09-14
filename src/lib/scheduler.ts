import "server-only";
import { z } from "zod";
import { adminClient } from "./supabase";
import { required } from "./env";
import { ProviderError } from "@/providers";
import { readQuote, readHistory, readNews, readMacro } from "./data";
import { analyzeAsset } from "@/core/analysis";

const jobSchema = z.object({ job_id: z.uuid(), agent_id: z.uuid(), lease_token: z.uuid() });
export async function runScheduler() {
  const db = adminClient(), owner = required("ATLAS_OWNER_ID");
  // Distributed rate cap prevents repeated scheduler requests from exhausting provider quotas.
  const rate = await db.rpc("consume_rate_limit", { p_key: "atlas-scheduler", p_limit: 1, p_window_seconds: 55 });
  if (rate.error) throw rate.error;
  if (!rate.data) return { skipped: "RECENT_TICK", jobs: [] };
  const claimed = await db.rpc("claim_due_agents", { p_owner_id: owner, p_limit: 3, p_lease_seconds: 120 });
  if (claimed.error) throw claimed.error;
  const jobs = z.array(jobSchema).parse(claimed.data);
  if (!jobs.length) { await health("GREEN", "Scheduler acessível; nenhum agente aguardando análise."); return { jobs: [] }; }
  const [news, macro] = await Promise.allSettled([readNews(), readMacro()]);
  const errors = [news.status === "rejected" ? "NEWS_UNAVAILABLE" : "", macro.status === "rejected" ? "MACRO_UNAVAILABLE" : ""].filter(Boolean);
  const results = await Promise.all(jobs.map(async job => {
    try {
      const agent = await db.from("agents").select("asset_id").eq("id", job.agent_id).eq("owner_id", owner).single();
      if (agent.error) throw agent.error;
      const asset = await db.from("assets").select("id,ticker").eq("id", agent.data.asset_id).eq("owner_id", owner).eq("active", true).single();
      if (asset.error) throw asset.error;
      const [quote, history] = await Promise.all([readQuote(asset.data.ticker), readHistory(asset.data.ticker)]);
      const newsData = news.status === "fulfilled" ? news.value : [], macroData = macro.status === "fulfilled" ? macro.value : [];
      const result = analyzeAsset({ ticker: asset.data.ticker, now: new Date().toISOString(), quote, history, news: newsData, macro: macroData, contextErrors: errors });
      const commit = await db.rpc("finish_agent_analysis", { p_owner_id: owner, p_job_id: job.job_id, p_lease_token: job.lease_token, p_result: result, p_inputs: { quote, history, news: newsData.slice(0, 5), macro: macroData } });
      if (commit.error) throw commit.error;
      return { jobId: job.job_id, decisionId: commit.data, status: "SUCCEEDED" };
    } catch (error) {
      const code = error instanceof ProviderError ? `${error.provider}:${error.code}` : "ANALYSIS_FAILED";
      const failed = await db.rpc("complete_agent_job", { p_owner_id: owner, p_job_id: job.job_id, p_lease_token: job.lease_token, p_status: "FAILED", p_error: code });
      // If the DB is unavailable the lease expires; a later worker must re-claim it.
      return { jobId: job.job_id, status: "FAILED", code, statePersisted: !failed.error && failed.data === true };
    }
  }));
  await health(results.some(r => r.status === "FAILED") ? "RED" : errors.length ? "YELLOW" : "GREEN", `Análises: ${results.filter(r => r.status === "SUCCEEDED").length}/${jobs.length}. Contexto indisponível: ${errors.join(", ") || "nenhum"}.`);
  return { jobs: results };

  async function health(status: string, message: string) {
    const now = new Date();
    const result = await db.from("system_health").upsert({ owner_id: owner, component: "SCHEDULER", status, message, checked_at: now.toISOString(), expires_at: new Date(now.getTime() + 180000).toISOString() }, { onConflict: "owner_id,component" });
    if (result.error) throw result.error;
  }
}
