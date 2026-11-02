import { z } from "zod";
import { ApiError, requireOwner } from "@/lib/auth";
import { checkCron, checkOrigin, checkProfitDllGateway, failure, json, readBody } from "@/lib/http";
import { adminClient } from "@/lib/supabase";
import { appendJournal, dashConfig, loadDashRecords, loadDashStatus, recordHeartbeat, setHalt } from "@/lib/daytrade/store";
import { runCycle } from "@/core/daytrade/cycle";
import { roomLimits } from "@/core/daytrade/config";
import { DESKS } from "@/core/daytrade/desks";
import { required } from "@/lib/env";

export const runtime = "nodejs";

/**
 * The DASH API (docs/daytrade/ARQUITETURA.md: "/api/daytrade/* · BFF autenticado e validado").
 * Owner (AAL2): GET status, config, journal, ledger, orders; POST halt (the DASH kill switch).
 * Scheduler (CRON_SECRET): POST cycle (one cycle of the desk; with the idle workers it only writes the
 * journal) and heartbeat (a worker reports in). No route here sends an order to a broker.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params;
    const { user } = await requireOwner();
    const db = adminClient();
    if (resource === "status") return json(await loadDashStatus(db, user.id));
    if (resource === "config") { const c = dashConfig(); return json({ config: c, limits: roomLimits(c) }); }
    if (resource === "journal") return json({ rows: await loadDashRecords(db, user.id, "dt_journal") });
    if (resource === "ledger") return json({ rows: await loadDashRecords(db, user.id, "dt_ledger") });
    if (resource === "orders") return json({ rows: await loadDashRecords(db, user.id, "dt_orders") });
    throw new ApiError(404, "NOT_FOUND", "Recurso do DASH desconhecido.");
  } catch (error) {
    return failure(error);
  }
}

const haltSchema = z.object({ halted: z.boolean(), reason: z.string().trim().max(200).nullable().default(null) }).strict();
const heartbeatSchema = z.object({ desk: z.enum(DESKS.map((d) => d.id) as [string, ...string[]]), state: z.enum(["IDLE", "WORKING", "BLOCKED", "ERROR"]), detail: z.string().max(300).default("") }).strict();
// Inbound snapshot from the private Windows gateway. The gateway uses CRON_SECRET over HTTPS;
// ticks are read-only and must match a configured, enabled contract.
const quoteSchema = z.object({
  provider: z.literal("PROFITDLL_DAYTRADE"), instrument: z.string().regex(/^[A-Z0-9$]{3,12}$/),
  last: z.number().finite().positive(), bid: z.number().finite().positive().nullable(), ask: z.number().finite().positive().nullable(),
  exchangeAt: z.string().datetime({ offset: true }), receivedAt: z.string().datetime({ offset: true }), sequence: z.number().int().nonnegative().nullable().default(null),
}).strict().superRefine((q, ctx) => {
  if (q.bid !== null && q.ask !== null && q.bid > q.ask) ctx.addIssue({ code: "custom", path: ["bid"], message: "Livro inconsistente." });
});

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params;
    if (resource === "halt") {
      checkOrigin(request);
      const { user } = await requireOwner();
      const body = haltSchema.parse(await readBody(request));
      await setHalt(adminClient(), user.id, body.halted, body.reason);
      return json({ ok: true, halted: body.halted });
    }
    // Gateway and scheduler have separate credentials and narrow scopes.
    if (resource === "quote") checkProfitDllGateway(request);
    else checkCron(request);
    const ownerId = required("ATLAS_OWNER_ID"), db = adminClient();
    if (resource === "heartbeat") {
      const body = heartbeatSchema.parse(await readBody(request));
      await recordHeartbeat(db, ownerId, body.desk, body.state, body.detail);
      return json({ ok: true });
    }
    if (resource === "quote") {
      const body = quoteSchema.parse(await readBody(request));
      const config = dashConfig();
      const instrument = config.instruments.find((i) => i.enabled && i.symbol === body.instrument);
      if (!instrument || !instrument.verified) throw new ApiError(422, "INSTRUMENT_NOT_READY", "Contrato não está habilitado e verificado na configuração do DASH.");
      const received = Date.parse(body.receivedAt), exchange = Date.parse(body.exchangeAt), now = Date.now();
      if (Math.abs(now - received) > config.data.maxDelayMs || received < exchange || received - exchange > config.data.maxDelayMs)
        throw new ApiError(422, "QUOTE_STALE", "Cotação fora da janela de atraso permitida.");
      const { data: previous, error: previousError } = await db.from("dt_market_quotes").select("exchange_at, sequence").eq("owner_id", ownerId).eq("instrument", instrument.symbol).maybeSingle();
      if (previousError) throw new ApiError(500, "DASH_READ_FAILED", "Não foi possível validar a sequência do feed.");
      if (previous && (exchange < Date.parse(previous.exchange_at) ||
        (exchange === Date.parse(previous.exchange_at) && body.sequence !== null && previous.sequence !== null && body.sequence < previous.sequence)))
        throw new ApiError(409, "QUOTE_OUT_OF_ORDER", "Cotação repetida ou fora de ordem foi descartada.");
      const { error } = await db.from("dt_market_quotes").upsert({ owner_id: ownerId, instrument: instrument.symbol, provider: body.provider, last: body.last, bid: body.bid, ask: body.ask, exchange_at: body.exchangeAt, received_at: body.receivedAt, sequence: body.sequence }, { onConflict: "owner_id,instrument" });
      if (error) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível registrar a cotação.");
      await recordHeartbeat(db, ownerId, "feed", "WORKING", "Cotação ProfitDLL recebida; somente leitura.");
      return json({ ok: true, instrument: instrument.symbol, receivedAt: body.receivedAt });
    }
    if (resource === "cycle") {
      const config = dashConfig(), office = await loadDashStatus(db, ownerId);
      const instrument = config.instruments.find((i) => i.enabled);
      const result = runCycle({ status: office.status, limits: roomLimits(config), now: new Date().toISOString(), halted: office.halted || office.missing.length > 0,
        events: [], positions: [], lossToday: 0, pointValue: instrument?.verified ? instrument.pointValue : null });
      if (office.missing.length) result.journal.push({ at: new Date().toISOString(), desk: "cycle", state: "SKIPPED", message: `Configuração incompleta: ${office.missing.join("; ")}.` });
      await appendJournal(db, ownerId, result.journal);
      // Nothing is sent from here: `send` stays empty in simulated mode (agents.ts maySend).
      return json({ ok: true, journal: result.journal.length, proposals: result.proposals.length, simulated: result.simulated.length, sent: 0 });
    }
    throw new ApiError(404, "NOT_FOUND", "Recurso do DASH desconhecido.");
  } catch (error) {
    return failure(error);
  }
}
