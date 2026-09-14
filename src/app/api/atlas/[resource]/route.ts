import { z } from "zod";
import { ApiError, requireOwner } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";
import { checkOrigin, failure, json, readBody } from "@/lib/http";
import { readiness } from "@/lib/readiness";
import { riskConfigSchema } from "@/lib/risk-config";
import {
  readQuote,
  readHistory,
  readSearch,
  readMacro,
  readNews,
} from "@/lib/data";

const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,12}$/);
const decimal = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const readable: Record<string, string> = {
  agents: "agents",
  assets: "assets",
  orders: "orders",
  decisions: "decisions",
  news: "news_articles",
  treasury: "treasury_transactions",
  audit: "audit_logs",
  meetings: "meetings",
  positions: "positions",
  snapshots: "portfolio_snapshots",
  risk: "risk_profiles",
  ledger: "ledger_entries",
  health: "system_health",
};
type RouteContext = { params: Promise<{ resource: string }> };
export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, user } = await requireOwner();
    const { resource } = await context.params;
    const url = new URL(request.url);
    if (resource === "readiness")
      return json({ liveEnabled: false, gates: readiness() });
    if (resource === "accounting") {
      const { data, error } = await adminClient().rpc(
        "get_accounting_snapshot",
        { p_owner_id: user.id },
      );
      if (error) throw error;
      return json(data);
    }
    if (resource === "quote")
      return json(
        await readQuote(tickerSchema.parse(url.searchParams.get("ticker"))),
      );
    if (resource === "history")
      return json(
        await readHistory(tickerSchema.parse(url.searchParams.get("ticker"))),
      );
    if (resource === "search")
      return json(
        await readSearch(
          z.string().min(1).max(50).parse(url.searchParams.get("q")),
        ),
      );
    if (resource === "macro") return json(await readMacro());
    if (resource === "news-feed") return json(await readNews());
    if (resource === "system") {
      const { data, error } = await db
        .from("system_state")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return json(data);
    }
    const table = readable[resource];
    if (!table) throw new ApiError(404, "NOT_FOUND", "Recurso não encontrado.");
    const sortBy =
      (
        {
          health: "checked_at",
          news: "published_at",
          positions: "reconciled_at",
        } as Record<string, string>
      )[resource] ?? "created_at";
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(sortBy, { ascending: false })
      .limit(200);
    if (error) throw error;
    return json(data);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    checkOrigin(request);
    const { user } = await requireOwner();
    const { resource } = await context.params;
    const body = await readBody(request);
    const admin = adminClient();
    if (resource === "kill") {
      z.object({ reason: z.string().min(5).max(500) }).parse(body);
      const { data, error } = await admin.rpc("set_kill_switch", {
        p_owner_id: user.id,
        p_enabled: true,
        p_reason: "Parada manual pelo proprietário",
      });
      if (error) throw error;
      return json({
        state: data,
        cancellation: "BROKER_NOT_CONFIGURED",
        message:
          "Novas ordens bloqueadas. Cancelamentos na corretora não puderam ser confirmados; confira o canal oficial. Posições preservadas.",
      });
    }
    const rate = await admin.rpc("consume_rate_limit", {
      p_key: `owner:${user.id}`,
      p_limit: 60,
      p_window_seconds: 60,
    });
    if (rate.error) throw rate.error;
    if (!rate.data)
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Aguarde antes de enviar outra alteração.",
      );
    if (resource === "assets") {
      const input = z
        .object({
          ticker: tickerSchema,
          company: z.string().trim().min(1).max(120),
          sector: z.string().trim().min(1).max(80),
        })
        .parse(body);
      const { data, error } = await admin
        .from("assets")
        .insert({
          owner_id: user.id,
          ticker: input.ticker,
          company_name: input.company,
          sector: input.sector,
        })
        .select()
        .single();
      if (error) throw error;
      return json(data, 201);
    }
    if (resource === "risk") {
      const input = riskConfigSchema.parse(body);
      const { data, error } = await admin
        .from("risk_profiles")
        .insert({
          owner_id: user.id,
          name: input.name,
          limits: input.limits,
          configured: true,
        })
        .select()
        .single();
      if (error) throw error;
      return json(data, 201);
    }
    if (resource === "agents") {
      const input = z
        .object({
          assetId: z.uuid(),
          name: z.string().trim().min(2).max(60),
          avatar: z.enum(["analyst", "researcher", "strategist"]),
          budget: decimal,
          interval: z.number().int().min(300).max(86400),
        })
        .parse(body);
      const { data, error } = await admin.rpc("create_agent", {
        p_owner_id: user.id,
        p_asset_id: input.assetId,
        p_name: input.name,
        p_avatar: input.avatar,
        p_budget: input.budget,
        p_interval_seconds: input.interval,
      });
      if (error) throw error;
      return json(data, 201);
    }
    if (resource === "agent-state") {
      const input = z
        .object({ id: z.uuid(), enabled: z.boolean() })
        .parse(body);
      const { data, error } = await admin.rpc("update_agent_enabled", {
        p_owner_id: user.id,
        p_agent_id: input.id,
        p_enabled: input.enabled,
      });
      if (error) throw error;
      return json(data);
    }
    if (
      resource === "live" ||
      resource === "orders" ||
      resource === "withdraw" ||
      resource === "deposit"
    ) {
      return json(
        {
          error:
            "Integração oficial ainda não habilitada. Nenhuma ordem ou transferência foi enviada.",
          code: "PROVIDER_NOT_CERTIFIED",
          gates: readiness(),
        },
        409,
      );
    }
    throw new ApiError(404, "NOT_FOUND", "Ação não encontrada.");
  } catch (error) {
    return failure(error);
  }
}
