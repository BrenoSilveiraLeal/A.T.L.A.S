import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planContribution, saoPauloMonth, type ContributionAgent } from "@/core/contribution";
import { ApiError } from "./auth";
import { sendAlert } from "./alerts";

export const contributionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), amount: z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/), day: z.number().int().min(1).max(28) }),
  z.object({ action: z.literal("apply") }),
]);

const MESSAGES: Record<string, string> = {
  ATLAS_INVALID_CONTRIBUTION_PLAN: "Informe um valor entre R$ 0 e R$ 100.000 e um dia entre 1 e 28.",
  ATLAS_PAPER_ACCOUNT_REQUIRED: "Crie a carteira virtual em Simulação antes do primeiro aporte.",
  ATLAS_AGENT_ELIMINATED: "Uma IA eliminada não recebe aporte. Atualize a página.",
  ATLAS_CONTRIBUTION_OVERALLOCATED: "A divisão passou do valor do aporte.",
};
function checked<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) {
    const code = result.error.message.match(/ATLAS_[A-Z_]+/)?.[0];
    if (code) throw new ApiError(409, code, MESSAGES[code] ?? "Aporte recusado.");
    throw new Error("CONTRIBUTION_DATABASE_UNAVAILABLE");
  }
  return result.data as NonNullable<T>;
}

/** Active team: alive, analysing and with autopilot on (retired agents get no share). */
async function teamFor(db: SupabaseClient, ownerId: string): Promise<ContributionAgent[]> {
  const [agents, assets] = await Promise.all([
    db.from("agents").select("id,name,status,enabled,autopilot,asset_id").eq("owner_id", ownerId),
    db.from("assets").select("id,ticker").eq("owner_id", ownerId),
  ]);
  for (const r of [agents, assets]) if (r.error) throw new Error("CONTRIBUTION_DATABASE_UNAVAILABLE");
  return agents.data!.map((a) => ({
    id: a.id, name: a.name, ticker: assets.data!.find((x) => x.id === a.asset_id)?.ticker ?? "",
    alive: !["DEAD", "FIRED"].includes(a.status), active: a.enabled !== false && a.autopilot !== false,
  }));
}

export async function loadContribution(db: SupabaseClient, ownerId: string, now = new Date()) {
  const { month, day } = saoPauloMonth(now);
  const [plan, history] = await Promise.all([
    db.from("contribution_plans").select("monthly_amount,day,updated_at").eq("owner_id", ownerId).maybeSingle(),
    db.from("contributions").select("*").eq("owner_id", ownerId).order("month", { ascending: false }).limit(12),
  ]);
  if (plan.error || history.error) throw new Error("CONTRIBUTION_DATABASE_UNAVAILABLE");
  const amount = Number(plan.data?.monthly_amount ?? 0);
  const applied = history.data.find((h) => h.month === month) ?? null;
  const suggestion = amount > 0 && !applied ? planContribution(amount, await teamFor(db, ownerId)) : null;
  return { month, today: day, amount, day: plan.data?.day ?? 5, configured: amount > 0, applied, suggestion, history: history.data };
}

async function applyNow(db: SupabaseClient, ownerId: string, now = new Date()) {
  const state = await loadContribution(db, ownerId, now);
  if (state.applied) return state.applied;
  if (!state.suggestion) throw new ApiError(409, "CONTRIBUTION_PLAN_REQUIRED", "Defina o valor do aporte mensal primeiro.");
  return checked(await db.rpc("apply_contribution", { p_owner_id: ownerId, p_month: state.month, p_amount: state.amount,
    p_allocation: state.suggestion.rows.map((r) => ({ agentId: r.agentId, amount: r.amount.toFixed(2) })) }));
}

export async function mutateContribution(db: SupabaseClient, ownerId: string, raw: unknown) {
  const input = contributionSchema.parse(raw);
  if (input.action === "plan") return checked(await db.rpc("set_contribution_plan", { p_owner_id: ownerId, p_amount: input.amount, p_day: input.day }));
  return applyNow(db, ownerId);
}

/** Scheduler hook: on or after the chosen day, adds this month's contribution to the simulation once. */
export async function maybeContribute(db: SupabaseClient, ownerId: string, now = new Date()) {
  const plan = await db.from("contribution_plans").select("monthly_amount,day").eq("owner_id", ownerId).maybeSingle();
  if (plan.error || !plan.data || Number(plan.data.monthly_amount) <= 0) return null;
  const { month, day } = saoPauloMonth(now);
  if (day < plan.data.day) return null;
  const done = await db.from("contributions").select("month").eq("owner_id", ownerId).eq("month", month).maybeSingle();
  if (done.error || done.data) return null;
  const row = await applyNow(db, ownerId, now);
  await sendAlert([`Aporte de ${month}: R$ ${Number(row.amount).toFixed(2)} entrou na simulação. Lembrete: na conta real, transfira esse valor para a Genial pelo app.`]);
  return row;
}
