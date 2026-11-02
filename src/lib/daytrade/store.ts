import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import raw from "../../../config/daytrade.json";
import { dashConfigSchema, paperReadiness, readiness, type DashConfig } from "@/core/daytrade/config";
import { INITIAL_STATUS, ORDER_STATES, type DashStatus } from "@/core/daytrade/desks";
import type { JournalEntry } from "@/core/daytrade/cycle";
import { ApiError } from "@/lib/auth";

/**
 * Server-side reads and writes of the DASH tables (supabase/migrations/*_daytrade_dash.sql). Every
 * caller authorizes first (requireOwner); the service role writes. Nothing here sends an order: the
 * gateway client is outside this code until the broker side exists (docs/daytrade/AGENTES.md).
 */
export function dashConfig(): DashConfig {
  const parsed = dashConfigSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(500, "DASH_CONFIG_INVALID", `config/daytrade.json inválido: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

type Db = SupabaseClient;
const day = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(at);

/** The office as the dashboard shows it: from the tables, or "nothing yet" where they are empty. */
export async function loadDashStatus(db: Db, ownerId: string) {
  const config = dashConfig();
  const activeInstrument = config.instruments.find((instrument) => instrument.enabled && instrument.symbol);
  const signalQuery = activeInstrument?.symbol
    ? db.from("dt_strategy_observations").select("state")
      .eq("owner_id", ownerId).eq("instrument", activeInstrument.symbol).eq("strategy_version", "opening-range-vwap-v1")
      .gte("bar_at", `${day()}T00:00:00-03:00`).order("bar_at", { ascending: false }).limit(1).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [settings, session, orders, heartbeats, quotes, latestSignal] = await Promise.all([
    db.from("dt_settings").select("mode, halted, halt_reason").eq("owner_id", ownerId).maybeSingle(),
    db.from("dt_sessions").select("status, opened_at, closed_at").eq("owner_id", ownerId).eq("day", day()).maybeSingle(),
    db.from("dt_orders").select("state, simulated").eq("owner_id", ownerId).gte("created_at", `${day()}T00:00:00-03:00`),
    db.from("dt_heartbeats").select("desk, state, detail, at").eq("owner_id", ownerId),
    db.from("dt_market_quotes").select("instrument, provider, last, bid, ask, exchange_at, received_at, sequence").eq("owner_id", ownerId),
    signalQuery,
  ]);
  for (const r of [settings, session, orders, heartbeats, quotes]) if (r.error) throw new ApiError(500, "DASH_READ_FAILED", "Não foi possível ler o DASH.");
  if (latestSignal.error) throw new ApiError(500, "DASH_READ_FAILED", "Não foi possível ler o sinal mais recente do DASH.");
  const counts = Object.fromEntries(ORDER_STATES.map((s) => [s.id, 0])) as DashStatus["orders"];
  for (const o of orders.data ?? []) if (o.state in counts) counts[o.state as keyof DashStatus["orders"]] += 1;
  const now = Date.now();
  const freshQuote = (quotes.data ?? []).find((q) => {
    const receivedAt = Date.parse(q.received_at);
    const exchangeAt = Date.parse(q.exchange_at);
    return q.provider === "PROFITDLL_DAYTRADE" && Number.isFinite(receivedAt) && Number.isFinite(exchangeAt) &&
      receivedAt <= now + config.data.maxDelayMs && now - receivedAt >= 0 && now - receivedAt < config.data.staleAfterMs &&
      receivedAt >= exchangeAt && receivedAt - exchangeAt <= config.data.maxDelayMs;
  });
  const status: DashStatus = {
    ...INITIAL_STATUS,
    mode: "SIMULATED",
    market: session.data?.status === "OPEN" ? "OPEN" : session.data?.status === "CLOSED" ? "CLOSED" : "UNVERIFIED",
    data: freshQuote ? "REAL" : "NONE",
    broker: freshQuote ? "ProfitDLL" : null,
    instrument: freshQuote?.instrument ?? config.instruments.find((i) => i.enabled)?.symbol ?? null,
    signals: latestSignal.data?.state === "WATCH_LONG" || latestSignal.data?.state === "WATCH_SHORT" ? 1 : 0,
    signal: latestSignal.data?.state === "WATCH_LONG" || latestSignal.data?.state === "WATCH_SHORT" ? latestSignal.data.state : null,
    orders: counts,
  };
  return { status, halted: settings.data?.halted ?? false, haltReason: settings.data?.halt_reason ?? null, heartbeats: heartbeats.data ?? [], quotes: quotes.data ?? [], missing: readiness(config), paperMissing: paperReadiness(config) };
}

/** Kill switch of the DASH only (it never touches the stocks office). */
export async function setHalt(db: Db, ownerId: string, halted: boolean, reason: string | null) {
  const { error } = await db.from("dt_settings").upsert({ owner_id: ownerId, halted, halt_reason: halted ? reason : null, updated_at: new Date().toISOString() });
  if (error) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível gravar a parada do DASH.");
  await appendJournal(db, ownerId, [{ at: new Date().toISOString(), desk: "supervisor", state: halted ? "BLOCKED" : "IDLE", message: halted ? `Parada acionada: ${reason ?? "sem motivo"}` : "Parada liberada pelo proprietário." }]);
}

/** A desk reports in (the workers call this through the cron/worker route, never the browser). */
export async function recordHeartbeat(db: Db, ownerId: string, desk: string, state: string, detail: string) {
  const { error } = await db.from("dt_heartbeats").upsert({ owner_id: ownerId, desk, state, detail, at: new Date().toISOString() });
  if (error) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível gravar o sinal de vida.");
}

/** Append the cycle's journal (append-only table). */
export async function appendJournal(db: Db, ownerId: string, entries: JournalEntry[]) {
  if (!entries.length) return;
  const { error } = await db.from("dt_journal").insert(entries.map((e) => ({ owner_id: ownerId, desk: e.desk, state: e.state, message: e.message, at: e.at })));
  if (error) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível gravar o diário do DASH.");
}

/** Recent journal and ledger, newest first. */
export async function loadDashRecords(db: Db, ownerId: string, table: "dt_journal" | "dt_ledger" | "dt_orders", limit = 100) {
  const order = table === "dt_orders" ? "created_at" : "at";
  const { data, error } = await db.from(table).select("*").eq("owner_id", ownerId).order(order, { ascending: false }).limit(limit);
  if (error) throw new ApiError(500, "DASH_READ_FAILED", "Não foi possível ler o DASH.");
  return data ?? [];
}
