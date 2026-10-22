import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./auth";

/**
 * Owner controls: per-agent and fleet autopilot switches, the real-money ceiling and
 * withdrawal preparation. Nothing here moves money; transfers happen in the broker app.
 */
const amount = z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/);
export const controlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("agent-autopilot"), agentId: z.uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("all-autopilot"), enabled: z.boolean() }),
  z.object({ action: z.literal("capital"), ceiling: amount }),
  z.object({ action: z.literal("withdraw"), amount, note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("withdrawal-status"), id: z.uuid(), status: z.enum(["READY", "DONE", "CANCELLED", "PREPARING"]) }),
]);

function checked<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) {
    const code = result.error.message.match(/ATLAS_[A-Z_]+/)?.[0];
    const messages: Record<string, string> = {
      ATLAS_INVALID_CAPITAL: "Informe um valor válido para o teto.",
      ATLAS_INVALID_WITHDRAWAL: "Informe um valor de saque válido.",
      ATLAS_INVALID_WITHDRAWAL_TRANSITION: "Esse pedido de saque não pode mudar para esse estado.",
      ATLAS_AGENT_NOT_FOUND: "Agente não encontrado.",
    };
    if (code) throw new ApiError(409, code, messages[code] ?? "Alteração recusada.");
    throw new Error("CONTROLS_DATABASE_UNAVAILABLE");
  }
  return result.data as NonNullable<T>;
}

export async function mutateControls(db: SupabaseClient, ownerId: string, raw: unknown) {
  const input = controlSchema.parse(raw);
  if (input.action === "agent-autopilot")
    return checked(await db.rpc("set_agent_autopilot", { p_owner_id: ownerId, p_agent_id: input.agentId, p_enabled: input.enabled }));
  if (input.action === "all-autopilot") {
    const agents = checked(await db.from("agents").select("id").eq("owner_id", ownerId).not("status", "in", "(DEAD,FIRED)"));
    for (const agent of agents)
      checked(await db.rpc("set_agent_autopilot", { p_owner_id: ownerId, p_agent_id: agent.id, p_enabled: input.enabled }));
    return { updated: agents.length, enabled: input.enabled };
  }
  if (input.action === "capital") return checked(await db.rpc("set_capital_ceiling", { p_owner_id: ownerId, p_ceiling: input.ceiling }));
  if (input.action === "withdraw")
    return checked(await db.rpc("request_withdrawal", { p_owner_id: ownerId, p_amount: input.amount, p_note: input.note ?? null }));
  return checked(await db.rpc("update_withdrawal", { p_owner_id: ownerId, p_id: input.id, p_status: input.status }));
}

/** Ceiling, open withdrawal reservations and what remains available to the agents. */
export async function loadControls(db: SupabaseClient, ownerId: string) {
  const [plan, withdrawals] = await Promise.all([
    db.from("capital_plans").select("ceiling,updated_at").eq("owner_id", ownerId).maybeSingle(),
    db.from("withdrawal_requests").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(50),
  ]);
  if (plan.error || withdrawals.error) throw new Error("CONTROLS_DATABASE_UNAVAILABLE");
  const ceiling = Number(plan.data?.ceiling ?? 0);
  const reserved = withdrawals.data.filter((w) => w.status === "PREPARING" || w.status === "READY").reduce((s, w) => s + Number(w.amount), 0);
  return { ceiling: ceiling.toFixed(2), reserved: reserved.toFixed(2), availableToAgents: Math.max(0, ceiling - reserved).toFixed(2),
    updatedAt: plan.data?.updated_at ?? null, withdrawals: withdrawals.data };
}
