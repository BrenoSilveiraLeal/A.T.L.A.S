import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./auth";
import { readHistory, readQuote } from "./data";
import { analyzePaperProposal, PaperAnalysisError } from "@/core/paper";
import { paperReferencePrice } from "@/core/paper";

const amount = z.string().regex(/^\d{1,9}(?:\.\d{1,2})?$/);
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), initialCash: amount, maxOrder: amount, maxExposure: amount, maxDailyLoss: amount }),
  z.object({ action: z.literal("propose"), agentId: z.uuid(), side: z.enum(["BUY", "SELL"]), quantity: z.number().int().min(1).max(1000000), limitPrice: amount, idempotencyKey: z.uuid() }),
  z.object({ action: z.literal("review"), proposalId: z.uuid(), approve: z.boolean() }),
  z.object({ action: z.literal("settle"), assetId: z.uuid() }),
  z.object({ action: z.literal("cancel"), orderId: z.uuid() }),
  z.object({ action: z.literal("pause"), paused: z.boolean() }),
]);

function checked<T>(result: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (result.error) {
    const code = result.error.message.match(/ATLAS_PAPER_[A-Z_]+/)?.[0];
    if (code) throw new ApiError(409, code, paperErrorMessage(code));
    throw new Error("PAPER_DATABASE_UNAVAILABLE");
  }
  if (result.data === null) throw new Error("PAPER_DATABASE_EMPTY");
  return result.data as NonNullable<T>;
}

function paperErrorMessage(code: string) {
  const descriptions: Record<string, string> = {
    ATLAS_PAPER_ACCOUNT_REQUIRED: "Crie primeiro a carteira virtual.",
    ATLAS_PAPER_AGENT_INACTIVE: "Ative o agente antes de criar uma proposta virtual.",
    ATLAS_PAPER_ASSET_INVALID: "Ativo indisponível para a simulação.",
    ATLAS_PAPER_INVALID_PROPOSAL: "Proposta inválida ou dados de mercado antigos.",
    ATLAS_PAPER_INVALID_LIMITS: "Confira o capital e os limites virtuais.",
    ATLAS_PAPER_QUOTE_INVALID: "Cotação ausente, inválida ou antiga; nenhuma ordem foi preenchida.",
    ATLAS_PAPER_RESERVATION_MISMATCH: "A reserva virtual não confere; nenhuma ordem foi preenchida.",
  };
  return descriptions[code] ?? "Operação virtual recusada; atualize os registros antes de tentar novamente.";
}

export async function loadPaper(db: SupabaseClient, ownerId: string) {
  const tables = ["paper_accounts", "paper_positions", "paper_proposals", "paper_orders", "paper_fills", "paper_ledger_entries", "paper_events", "agents", "assets"] as const;
  const sort: Record<string, string> = { paper_accounts: "owner_id", paper_positions: "updated_at", paper_proposals: "created_at", paper_orders: "placed_at", paper_fills: "filled_at", paper_ledger_entries: "created_at", paper_events: "created_at", agents: "created_at", assets: "created_at" };
  const results = await Promise.all(tables.map((table) => db.from(table).select("*").eq("owner_id", ownerId).order(sort[table], { ascending: false }).limit(200)));
  return Object.fromEntries(tables.map((table, index) => [table, checked(results[index])])) as Record<typeof tables[number], Record<string, unknown>[]>;
}

export async function mutatePaper(db: SupabaseClient, ownerId: string, raw: unknown) {
  const input = inputSchema.parse(raw);
  if (input.action === "open") {
    return checked(await db.rpc("paper_open_account", {
      p_owner_id: ownerId,
      p_initial_cash: input.initialCash,
      p_max_order: input.maxOrder,
      p_max_exposure: input.maxExposure,
      p_max_daily_loss: input.maxDailyLoss,
    }));
  }
  if (input.action === "propose") {
    const agent = z.object({ id: z.uuid(), asset_id: z.uuid(), enabled: z.boolean() }).parse(
      checked(await db.from("agents").select("id,asset_id,enabled").eq("owner_id", ownerId).eq("id", input.agentId).single()),
    );
    if (!agent.enabled) throw new ApiError(409, "AGENT_INACTIVE", "Ative o agente antes de propor uma ordem virtual.");
    const asset = z.object({ id: z.uuid(), ticker: z.string().regex(/^[A-Z0-9]{3,12}$/) }).parse(
      checked(await db.from("assets").select("id,ticker").eq("owner_id", ownerId).eq("id", agent.asset_id).single()),
    );
    const [quote, history] = await Promise.all([readQuote(asset.ticker), readHistory(asset.ticker)]);
    let analysis: ReturnType<typeof analyzePaperProposal>;
    try {
      analysis = analyzePaperProposal({ ticker: asset.ticker, quote, history, side: input.side, now: new Date().toISOString() });
    } catch (error) {
      if (error instanceof PaperAnalysisError) throw new ApiError(409, error.code, "Dados de mercado insuficientes ou antigos para criar a proposta virtual.");
      throw error;
    }
    return checked(await db.rpc("paper_create_proposal", {
      p_owner_id: ownerId,
      p_agent_id: input.agentId,
      p_side: input.side,
      p_quantity: input.quantity,
      p_limit_price: input.limitPrice,
      p_reference_price: analysis.referencePrice,
      p_quote_source: quote.source,
      p_quote_timestamp: quote.dataTimestamp,
      p_history_source: history.source,
      p_history_retrieved_at: history.retrievedAt,
      p_strategy_version: analysis.strategyVersion,
      p_reasoning: analysis.reasoningSummary,
      p_indicators: analysis.indicators,
      p_idempotency_key: input.idempotencyKey,
    }));
  }
  if (input.action === "review") return checked(await db.rpc("paper_review_proposal", {
    p_owner_id: ownerId, p_proposal_id: input.proposalId, p_approve: input.approve,
  }));
  if (input.action === "cancel") return checked(await db.rpc("paper_cancel_order", {
    p_owner_id: ownerId, p_order_id: input.orderId,
  }));
  if (input.action === "pause") return checked(await db.rpc("paper_set_paused", {
    p_owner_id: ownerId, p_paused: input.paused,
  }));
  const asset = z.object({ ticker: z.string().regex(/^[A-Z0-9]{3,12}$/) }).parse(
    checked(await db.from("assets").select("ticker").eq("owner_id", ownerId).eq("id", input.assetId).single()),
  );
  const quote = await readQuote(asset.ticker);
  return checked(await db.rpc("paper_settle_quote", {
    p_owner_id: ownerId,
    p_asset_id: input.assetId,
    p_price: paperReferencePrice(quote.price),
    p_source: quote.source,
    p_quote_timestamp: quote.dataTimestamp,
  }));
}
