import "server-only";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./auth";
import { notify } from "./notify";
import { saoPauloClock } from "@/core/b3-calendar";

const amount = z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/);
export const liveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), enabled: z.boolean(), maxOrder: amount, dailyOrders: z.number().int().min(1).max(100), confirm: z.string().max(40).optional() }),
  z.object({ action: z.literal("budget"), agentId: z.uuid(), amount }),
  // A real deposit at Genial, into the boss's pot.
  z.object({ action: z.literal("deposit"), amount }),
]);

const MESSAGES: Record<string, string> = {
  ATLAS_LIVE_CONFIRMATION_REQUIRED: "Digite exatamente LIGAR DINHEIRO REAL para confirmar.",
  ATLAS_LIVE_CEILING_REQUIRED: "Defina primeiro o teto de dinheiro real (quanto você depositou na Genial).",
  ATLAS_LIVE_BUDGET_REQUIRED: "Dê dinheiro real a pelo menos uma IA antes de ligar.",
  ATLAS_REAL_BUDGET_ABOVE_CEILING: "A soma do dinheiro das IAs passaria do teto (menos os saques em preparação).",
  ATLAS_INVALID_REAL_BUDGET: "Valor inválido.",
  ATLAS_AGENT_ELIMINATED: "IA eliminada não recebe dinheiro real.",
  ATLAS_INVALID_LIVE_SETTINGS: "Valores inválidos.",
  ATLAS_INVALID_DEPOSIT: "Valor de depósito inválido.",
  ATLAS_DEPOSIT_OVERALLOCATED: "A divisão passou do valor depositado.",
  ATLAS_AGENT_NOT_FOUND: "IA não encontrada.",
};
function checked<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) {
    const code = result.error.message.match(/ATLAS_[A-Z_]+/)?.[0];
    if (code) throw new ApiError(409, code, MESSAGES[code] ?? "Alteração recusada.");
    throw new Error("LIVE_DATABASE_UNAVAILABLE");
  }
  return result.data as NonNullable<T>;
}

/** The bridge's own execution switch, read from its local config (only that one line). */
export async function bridgeExecution(): Promise<boolean | null> {
  try {
    const text = await readFile(process.env.ATLAS_GATEWAY_ENV_PATH ?? "C:/atlas-data/gateway.env", "utf8");
    const line = text.split(/\r?\n/).find((l) => l.startsWith("ATLAS_MT5_ENABLE_EXECUTION="));
    return line ? line.split("=")[1].trim().toLowerCase() === "true" : false;
  } catch { return null; }
}

export async function loadLive(db: SupabaseClient, ownerId: string) {
  const [settings, plan, withdrawals, agents, assets, positions, orders, fills, state, bridge, allFills, dividends] = await Promise.all([
    db.from("live_settings").select("*").eq("owner_id", ownerId).maybeSingle(),
    db.from("capital_plans").select("ceiling").eq("owner_id", ownerId).maybeSingle(),
    db.from("withdrawal_requests").select("amount").eq("owner_id", ownerId).in("status", ["PREPARING", "READY"]),
    db.from("agents").select("id,name,status,autopilot,real_budget,asset_id").eq("owner_id", ownerId).order("created_at"),
    db.from("assets").select("id,ticker"),
    db.from("live_positions").select("*").eq("owner_id", ownerId),
    db.from("live_orders").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(30),
    db.from("live_fills").select("*").eq("owner_id", ownerId).order("executed_at", { ascending: false }).limit(30),
    db.from("system_state").select("live_trading_enabled,global_kill_switch,kill_switch_reason").eq("owner_id", ownerId).maybeSingle(),
    bridgeExecution(),
    db.from("live_fills").select("side,quantity,price,fee").eq("owner_id", ownerId),
    db.from("live_dividends").select("ticker,label,net,payment_date").eq("owner_id", ownerId),
  ]);
  for (const r of [settings, plan, withdrawals, agents, assets, positions, orders, fills, state, allFills, dividends]) if (r.error) throw new Error("LIVE_DATABASE_UNAVAILABLE");
  const ceiling = Number(plan.data?.ceiling ?? 0);
  const reserved = (withdrawals.data ?? []).reduce((s, w) => s + Number(w.amount), 0);
  // Money at Genial as ATLAS counts it: the MT5 Swing account does not report the cash balance,
  // so it is what the owner deposited minus every real purchase plus every sale, fees included.
  const value = (f: { quantity: number; price: unknown }) => Number(f.quantity) * Number(f.price);
  const spent = (allFills.data ?? []).filter((f) => f.side === "BUY").reduce((s, f) => s + value(f), 0);
  const received = (allFills.data ?? []).filter((f) => f.side === "SELL").reduce((s, f) => s + value(f), 0);
  const fees = (allFills.data ?? []).reduce((s, f) => s + Number(f.fee), 0);
  // Dividends and JCP (lib/dividends): net, counted as cash from the payment date.
  const today = saoPauloClock(new Date()).date;
  const paidDividends = (dividends.data ?? []).filter((d) => String(d.payment_date) <= today).reduce((s, d) => s + Number(d.net), 0);
  const upcomingDividends = (dividends.data ?? []).filter((d) => String(d.payment_date) > today).reduce((s, d) => s + Number(d.net), 0);
  return {
    genial: { deposited: ceiling, spent, received, fees, dividends: Math.round(paidDividends * 100) / 100, upcomingDividends: Math.round(upcomingDividends * 100) / 100,
      free: Math.round((ceiling - spent + received - fees + paidDividends) * 100) / 100 },
    switches: { panel: settings.data?.enabled === true, computer: process.env.LIVE_TRADING_ENABLED === "true", bridge,
      killSwitch: state.data?.global_kill_switch ?? true, reason: state.data?.kill_switch_reason ?? null },
    settings: { maxOrder: Number(settings.data?.max_order ?? 300), dailyOrders: settings.data?.daily_orders ?? 8 },
    ceiling, reserved, assigned: (agents.data ?? []).reduce((s, a) => s + Number(a.real_budget), 0),
    agents: (agents.data ?? []).map((a) => ({ id: a.id, name: a.name, status: a.status, autopilot: a.autopilot, realBudget: Number(a.real_budget),
      ticker: assets.data?.find((x) => x.id === a.asset_id)?.ticker ?? "" })),
    positions: positions.data, orders: orders.data, fills: fills.data,
  };
}

export async function mutateLive(db: SupabaseClient, ownerId: string, raw: unknown) {
  const input = liveSchema.parse(raw);
  // Deposits go to the boss's pot; the boss releases money to an agent when it is time to buy.
  if (input.action === "deposit") {
    const result = checked(await db.rpc("register_deposit", { p_owner_id: ownerId, p_amount: input.amount, p_allocation: [] }));
    await notify({ level: "success", title: `Depósito registrado: R$ ${Number(input.amount).toFixed(2).replace(".", ",")} no caixa do Chefe`,
      lines: ["O Chefe libera esse dinheiro para a IA que chegar no momento certo de comprar."] });
    return result;
  }
  if (input.action === "budget")
    return checked(await db.rpc("set_agent_real_budget", { p_owner_id: ownerId, p_agent_id: input.agentId, p_amount: input.amount }));
  return checked(await db.rpc("set_live_settings", { p_owner_id: ownerId, p_enabled: input.enabled, p_max_order: input.maxOrder,
    p_daily_orders: input.dailyOrders, p_confirm: input.confirm ?? null }));
}
