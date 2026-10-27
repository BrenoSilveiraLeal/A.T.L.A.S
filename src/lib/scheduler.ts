import "server-only";
import { z } from "zod";
import { adminClient } from "./supabase";
import { required } from "./env";
import { ProviderError } from "@/providers";
import { readQuote, readHistory, readNews, readMacro } from "./data";
import { analyzeAsset } from "@/core/analysis";
import { loadAgentObservationConfiguration } from "./agent-config";
import { runPaperAutopilot } from "./autopilot";
import { notify } from "./notify";
import { loadNews } from "./news";
import { refreshCompanyHealth } from "./company-health";
import { scoutList } from "./forecast";
import { contextFor, contextSummary, loadContextSources, type ContextSources } from "./context";
import { storeBars } from "./market-bars";
import { holdTeamMeeting } from "./meeting";
import { notifyBigMoves } from "./movers";

const jobSchema = z.object({
  job_id: z.uuid(),
  agent_id: z.uuid(),
  lease_token: z.uuid(),
});
export async function runScheduler() {
  const db = adminClient(),
    owner = required("ATLAS_OWNER_ID");
  // With real money on, only the owner's computer decides: it is the only place a real order can go
  // out (MetaTrader). Deciding in the cloud while the bridge is off made the agents' book believe
  // in a purchase that never happened at Genial (26/10/2026).
  if (process.env.VERCEL) {
    const live = await db.from("live_settings").select("enabled").eq("owner_id", owner).maybeSingle();
    if (live.data?.enabled) return { skipped: "LOCAL_EXECUTION" as const, jobs: [] };
  }
  // Distributed rate cap prevents repeated scheduler requests from exhausting provider quotas.
  const rate = await db.rpc("consume_rate_limit", {
    p_key: "atlas-scheduler",
    p_limit: 1,
    p_window_seconds: 55,
  });
  if (rate.error) throw rate.error;
  if (!rate.data) {
    // Another scheduler (e.g. the cloud one) already ran this minute's analyses. The light,
    // idempotent extras still run here: they are each rate-limited or once per month.
    await loadNews(db, owner).catch(() => undefined);
    await refreshCompanyHealth(db, owner).catch(() => undefined);
    // The assistant's daily scan (~60 light requests): only on the owner's computer, never inside Vercel's 60 s.
    if (!process.env.VERCEL) await scoutList(db, owner).catch(() => undefined);
    await holdTeamMeeting(db, owner).catch(() => undefined);
    if (!process.env.VERCEL) await notifyBigMoves(db, owner).catch(() => undefined);
    return { skipped: "RECENT_TICK", jobs: [] };
  }
  // Housekeeping is bounded and never deletes decisions, orders or financial evidence.
  // A maintenance failure degrades health without preventing read-only analysis.
  const maintenanceRate = await db.rpc("consume_rate_limit", {
    p_key: `atlas-cache-maintenance:${owner}`,
    p_limit: 1,
    p_window_seconds: 3600,
  });
  let maintenanceFailed = Boolean(maintenanceRate.error);
  if (!maintenanceFailed && maintenanceRate.data) {
    const cleanup = await db.rpc("prune_market_data_cache", {
      p_owner_id: owner,
      p_limit: 500,
    });
    maintenanceFailed = Boolean(cleanup.error);
  }
  const claimed = await db.rpc("claim_due_agents", {
    p_owner_id: owner,
    p_limit: 3,
    p_lease_seconds: 120,
  });
  if (claimed.error) throw claimed.error;
  const jobs = z.array(jobSchema).parse(claimed.data);
  if (!jobs.length) {
    await health(
      maintenanceFailed ? "YELLOW" : "GREEN",
      maintenanceFailed
        ? "Scheduler acessível; limpeza do cache indisponível. Confira a migration de retenção."
        : "Scheduler acessível; nenhum agente aguardando análise.",
    );
    await holdTeamMeeting(db, owner).catch(() => undefined);
    if (!process.env.VERCEL) await notifyBigMoves(db, owner).catch(() => undefined);
    return { jobs: [] };
  }
  const [news, macro] = await Promise.allSettled([readNews(), readMacro()]);
  const errors = [
    maintenanceFailed ? "CACHE_MAINTENANCE_FAILED" : "",
    news.status === "rejected" ? "NEWS_UNAVAILABLE" : "",
    macro.status === "rejected" ? "MACRO_UNAVAILABLE" : "",
  ].filter(Boolean);
  // Context is loaded once per tick, before the parallel analyses: GDELT needs paced requests.
  let sources: ContextSources = { facts: null, companies: null, names: new Map(), agency: null, extra: null, market: null, dollar: null, brent: null, company: new Map() };
  try {
    const claimedAgents = await db.from("agents").select("asset_id").eq("owner_id", owner).in("id", jobs.map((j) => j.agent_id));
    const claimedAssets = claimedAgents.error ? null : await db.from("assets").select("ticker,company_name").eq("owner_id", owner)
      .in("id", claimedAgents.data.map((a) => a.asset_id));
    if (claimedAssets && !claimedAssets.error)
      sources = await loadContextSources(claimedAssets.data.map((a) => ({ ticker: a.ticker, company: a.company_name })));
  } catch {
    errors.push("CONTEXT_UNAVAILABLE");
  }
  const results = await Promise.all(
    jobs.map(async (job) => {
      let label = "Agente";
      try {
        const agent = await db
          .from("agents")
          .select("asset_id,name")
          .eq("id", job.agent_id)
          .eq("owner_id", owner)
          .single();
        if (agent.error) throw agent.error;
        const asset = await db
          .from("assets")
          .select("id,ticker")
          .eq("id", agent.data.asset_id)
          .eq("owner_id", owner)
          .eq("active", true)
          .single();
        if (asset.error) throw asset.error;
        label = `${agent.data.name} (${asset.data.ticker})`;
        const configuration = await loadAgentObservationConfiguration(
          db,
          owner,
          job.agent_id,
        );
        const [quote, history] = await Promise.all([
          readQuote(asset.data.ticker),
          readHistory(asset.data.ticker),
        ]);
        // Grow the long history; a storage failure never blocks the analysis.
        await storeBars(db, history).catch(() => 0);
        const newsData = news.status === "fulfilled" ? news.value : [],
          macroData = macro.status === "fulfilled" ? macro.value : [];
        const result = analyzeAsset({
          ticker: asset.data.ticker,
          now: new Date().toISOString(),
          quote,
          history,
          news: newsData,
          macro: macroData,
          contextErrors: errors,
        });
        const context = contextFor(asset.data.ticker, sources);
        const commit = await db.rpc("finish_agent_analysis", {
          p_owner_id: owner,
          p_job_id: job.job_id,
          p_lease_token: job.lease_token,
          p_result: result,
          p_inputs: {
            quote,
            history,
            news: newsData.slice(0, 5),
            macro: macroData,
            configuration,
            context,
          },
        });
        if (commit.error) throw commit.error;
        // Virtual book only. A paper failure never turns a committed analysis into a failure.
        let paper: Awaited<ReturnType<typeof runPaperAutopilot>> | { status: "FAILED" };
        try {
          paper = await runPaperAutopilot(db, {
            owner, jobId: job.job_id, agentId: job.agent_id, assetId: asset.data.id,
            ticker: asset.data.ticker, quote, history,
            context: { action: context.action, summary: contextSummary(context) },
          });
        } catch {
          paper = { status: "FAILED" };
        }
        return {
          jobId: job.job_id,
          decisionId: commit.data,
          status: "SUCCEEDED",
          label,
          paper,
        };
      } catch (error) {
        // Keep the real reason (27/10/2026: every non-provider failure showed only ANALYSIS_FAILED).
        const detail = error instanceof Error ? error.message
          : error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
        const code =
          error instanceof ProviderError
            ? `${error.provider}:${error.code}`
            : `ANALYSIS_FAILED: ${(detail.match(/ATLAS_[A-Z_]+/)?.[0] ?? detail).slice(0, 120)}`;
        console.error(JSON.stringify({ component: "analysis", agent: label, error: detail.slice(0, 400) }));
        const failed = await db.rpc("complete_agent_job", {
          p_owner_id: owner,
          p_job_id: job.job_id,
          p_lease_token: job.lease_token,
          p_status: "FAILED",
          p_error: code,
        });
        // If the DB is unavailable the lease expires; a later worker must re-claim it.
        return {
          jobId: job.job_id,
          status: "FAILED",
          label,
          code,
          statePersisted: !failed.error && failed.data === true,
        };
      }
    }),
  );
  const paperFailed = results.some((r) => "paper" in r && r.paper?.status === "FAILED");
  if (paperFailed) errors.push("PAPER_AUTOPILOT_FAILED");
  await health(
    results.some((r) => r.status === "FAILED")
      ? "RED"
      : errors.length
        ? "YELLOW"
        : "GREEN",
    `Análises: ${results.filter((r) => r.status === "SUCCEEDED").length}/${jobs.length}. Contexto indisponível: ${errors.join(", ") || "nenhum"}.`,
  );
  // Owner notifications are best effort and only for events that need attention.
  const alerts: string[] = [];
  const notes: string[] = [];
  for (const r of results) {
    if (r.status === "FAILED" && "code" in r) alerts.push(`Falha na análise de ${r.label}: ${r.code}`);
    if (!("paper" in r) || !r.paper) continue;
    const paper = r.paper;
    if ("corporateActions" in paper && (paper.corporateActions ?? 0) > 0)
      notes.push(`${r.label}: ${paper.corporateActions} evento(s) oficial(is) da B3 aplicado(s) (dividendos ou ajuste de ações).`);

    if (paper.status === "ORDER_OPENED")
      notes.push(`${r.label}: decidiu ${paper.side === "BUY" ? "comprar" : "vender"} ${paper.quantity} a até R$ ${paper.limitPrice} (a ordem vai para a Genial).`);
    if (paper.status === "ELIMINATED") alerts.push(`${r.label} atingiu o limite de perda.`);
    if (paper.status === "FAILED") alerts.push(`Piloto automático falhou para ${r.label}.`);
    if (paper.status === "CORPORATE_ACTION_SUSPECTED") alerts.push(`${r.label} PAUSADO: ${paper.reason} Confira a posição antes de retomar.`);
  }
  if (alerts.length) await notify({ level: "error", title: "Problema nas análises das IAs", lines: alerts, dedupeKey: `scheduler:${alerts.join("|").slice(0, 120)}`, windowSeconds: 3600 });
  if (notes.length) await notify({ level: "info", title: "Atividade das IAs", lines: notes });
  // Keeps the office TV filled even with the panel closed (refresh at most every 5 min).
  await loadNews(db, owner).catch(() => undefined);
  // No simulated contribution: the agents' money comes only from real deposits (register_deposit).
  // Company health from the annual statements: downloads at most once a week.
  await refreshCompanyHealth(db, owner).catch(() => undefined);
  // End-of-day team meeting (once per trading day after the close).
  await holdTeamMeeting(db, owner).catch(() => undefined);
  if (!process.env.VERCEL) await notifyBigMoves(db, owner).catch(() => undefined);
  return { jobs: results };

  async function health(status: string, message: string) {
    const now = new Date();
    const result = await db.from("system_health").upsert(
      {
        owner_id: owner,
        component: "SCHEDULER",
        status,
        message,
        checked_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 180000).toISOString(),
      },
      { onConflict: "owner_id,component" },
    );
    if (result.error) throw result.error;
  }
}
