import { z } from "zod";
import { ApiError, requireOwner } from "@/lib/auth";
import { checkCron, checkOrigin, failure, json, readBody } from "@/lib/http";
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
    // Workers and the scheduler: authenticated by the cron secret, acting for the owner only.
    checkCron(request);
    const ownerId = required("ATLAS_OWNER_ID"), db = adminClient();
    if (resource === "heartbeat") {
      const body = heartbeatSchema.parse(await readBody(request));
      await recordHeartbeat(db, ownerId, body.desk, body.state, body.detail);
      return json({ ok: true });
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
