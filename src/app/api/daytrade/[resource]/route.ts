import { z } from "zod";
import { ApiError, requireOwner } from "@/lib/auth";
import { checkCron, checkOrigin, checkProfitDllGateway, failure, json, readBody } from "@/lib/http";
import { adminClient } from "@/lib/supabase";
import { appendJournal, dashConfig, loadDashRecords, loadDashStatus, recordHeartbeat, setHalt } from "@/lib/daytrade/store";
import { runCycle } from "@/core/daytrade/cycle";
import { supervisorWorker, type Heartbeat } from "@/core/daytrade/agents";
import { paperReadiness, roomLimits } from "@/core/daytrade/config";
import { DESKS } from "@/core/daytrade/desks";
import { required } from "@/lib/env";
import { analyzeOpeningRange, backtestCandidate, type MinuteBar } from "@/core/daytrade/analysis";

export const runtime = "nodejs";

/**
 * The DASH API (docs/daytrade/ARQUITETURA.md: "/api/daytrade/* · BFF autenticado e validado").
 * Owner (AAL2): GET status, config, journal, ledger, orders; POST halt (the DASH kill switch).
 * Scheduler (CRON_SECRET): POST cycle (one cycle of the desk; with the idle workers it only writes the
 * journal) and heartbeat (a worker reports in). No route here sends an order to a broker.
 */
export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params;
    const { user } = await requireOwner();
    const db = adminClient();
    if (resource === "bars" || resource === "backtest") {
      const config = dashConfig();
      const symbol = new URL(request.url).searchParams.get("instrument") ?? config.instruments.find((i) => i.enabled)?.symbol;
      if (!symbol || !config.instruments.some((i) => i.enabled && i.symbol === symbol)) throw new ApiError(422, "INSTRUMENT_NOT_READY", "Selecione um contrato habilitado no DASH.");
      const pageSize = 1000, maximum = resource === "backtest" ? 20000 : 600;
      const descendingRows: Array<{ bucket_at: string; open: number | string; high: number | string; low: number | string; close: number | string; volume: number | string }> = [];
      const completedBefore = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
      for (let offset = 0; offset < maximum; offset += pageSize) {
        let query = db.from("dt_market_bars").select("bucket_at,open,high,low,close,volume")
          .eq("owner_id", user.id).eq("instrument", symbol).eq("timeframe", "1m")
          .order("bucket_at", { ascending: false }).range(offset, offset + Math.min(pageSize, maximum - offset) - 1);
        if (resource === "backtest") query = query.lt("bucket_at", completedBefore);
        const { data, error } = await query;
        if (error) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel ler os candles do DASH.");
        descendingRows.push(...(data ?? []));
        if ((data?.length ?? 0) < pageSize) break;
      }
      const bars = descendingRows.reverse().map((b) => ({ ...b, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume) })) as MinuteBar[];
      const contract = config.instruments.find((i) => i.symbol === symbol)!;
      if (resource === "backtest") {
        if (!config.costs.verified || config.costs.brokeragePerContract === null || config.costs.exchangeFeesPerContract === null || contract.pointValue === null || contract.tickSize === null)
          return json({ status: "COSTS_NOT_CONFIGURED", researchOnly: true });
        return json(backtestCandidate(bars, contract.pointValue, contract.tickSize, config.costs.brokeragePerContract + config.costs.exchangeFeesPerContract, config.costs.slippageTicks, contract.expiresOn));
      }
      return json({ instrument: symbol, timeframe: "1m", bars, analysis: analyzeOpeningRange(bars), source: "PROFITDLL_DAYTRADE" });
    }
    if (resource === "status") return json(await loadDashStatus(db, user.id));
    if (resource === "config") { const c = dashConfig(); return json({ config: c, limits: roomLimits(c), paperMissing: paperReadiness(c) }); }
    if (resource === "journal") return json({ rows: await loadDashRecords(db, user.id, "dt_journal") });
    if (resource === "observations") {
      const { data, error } = await db.from("dt_strategy_observations").select("instrument,strategy_version,bar_at,state,entry,stop,explanation,blocked_reasons,created_at")
        .eq("owner_id", user.id).order("bar_at", { ascending: false }).limit(100);
      if (error) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel ler as observaÃ§Ãµes da estratÃ©gia.");
      return json({ rows: data ?? [] });
    }
    if (resource === "paper") {
      const [state, fills] = await Promise.all([
        db.from("dt_paper_state").select("instrument,session_day,position_side,entry_price,stop_price,pending_side,trades_today,realized_pnl_today,last_bar_at,updated_at").eq("owner_id", user.id),
        db.from("dt_paper_fills").select("instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason,created_at").eq("owner_id", user.id).order("bar_at", { ascending: false }).limit(100),
      ]);
      if (state.error || fills.error) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel ler a simulaÃ§Ã£o futura do DASH.");
      return json({ state: state.data ?? [], fills: fills.data ?? [] });
    }
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
  bar: z.object({ bucketAt: z.string().datetime({ offset: true }), open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive(), volume: z.number().int().nonnegative() }).strict().optional(),
  closedBars: z.array(z.object({ bucketAt: z.string().datetime({ offset: true }), open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive(), volume: z.number().int().nonnegative() }).strict()).max(10).default([]),
}).strict().superRefine((q, ctx) => {
  if (q.bid !== null && q.ask !== null && q.bid > q.ask) ctx.addIssue({ code: "custom", path: ["bid"], message: "Livro inconsistente." });
  if (q.bar && (q.bar.high < Math.max(q.bar.open, q.bar.close, q.bar.low) || q.bar.low > Math.min(q.bar.open, q.bar.close, q.bar.high) || q.bar.close !== q.last)) ctx.addIssue({ code: "custom", path: ["bar"], message: "Inconsistent current candle." });
  q.closedBars.forEach((bar, index) => {
    if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) ctx.addIssue({ code: "custom", path: ["closedBars", index], message: "Inconsistent closed candle." });
  });
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
      if (instrument.expiresOn && new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()) >= instrument.expiresOn) throw new ApiError(422, "CONTRACT_EXPIRED", "Contract expired; update the symbol before collecting quotes.");
      const received = Date.parse(body.receivedAt), exchange = Date.parse(body.exchangeAt), now = Date.now();
      const bars = [...body.closedBars, ...(body.bar ? [body.bar] : [])];
      const seenBuckets = new Set<string>();
      for (const bar of bars) {
        const bucket = Date.parse(bar.bucketAt);
        if (!Number.isFinite(bucket) || bucket % 60_000 !== 0 || bucket > now || now - bucket > 120_000)
          throw new ApiError(422, "BAR_INVALID", "O candle precisa pertencer ao minuto atual ou imediatamente anterior.");
        if (seenBuckets.has(bar.bucketAt)) throw new ApiError(422, "BAR_DUPLICATE", "O lote contém candles duplicados.");
        seenBuckets.add(bar.bucketAt);
        if (instrument.tickSize !== null && [bar.open, bar.high, bar.low, bar.close].some((price) => Math.abs(price / instrument.tickSize! - Math.round(price / instrument.tickSize!)) > 1e-8))
          throw new ApiError(422, "BAR_TICK_INVALID", "Os preços do candle não respeitam o tick configurado para o contrato.");
      }
      if (instrument.tickSize !== null && [body.last, body.bid, body.ask].filter((price): price is number => price !== null)
        .some((price) => Math.abs(price / instrument.tickSize! - Math.round(price / instrument.tickSize!)) > 1e-8))
        throw new ApiError(422, "QUOTE_TICK_INVALID", "Quote price is not aligned to the configured contract tick.");
      if (body.bar && body.closedBars.some((bar) => Date.parse(bar.bucketAt) >= Date.parse(body.bar!.bucketAt)))
        throw new ApiError(422, "BAR_ORDER_INVALID", "Candles fechados precisam anteceder o candle em formação.");
      if (Math.abs(now - received) > config.data.maxDelayMs || received < exchange || received - exchange > config.data.maxDelayMs)
        throw new ApiError(422, "QUOTE_STALE", "Cotação fora da janela de atraso permitida.");
      const { data: previous, error: previousError } = await db.from("dt_market_quotes").select("exchange_at, sequence").eq("owner_id", ownerId).eq("instrument", instrument.symbol).maybeSingle();
      if (previousError) throw new ApiError(500, "DASH_READ_FAILED", "Não foi possível validar a sequência do feed.");
      if (previous && (exchange < Date.parse(previous.exchange_at) ||
        (exchange === Date.parse(previous.exchange_at) && body.sequence !== null && previous.sequence !== null && body.sequence < previous.sequence)))
        throw new ApiError(409, "QUOTE_OUT_OF_ORDER", "Cotação repetida ou fora de ordem foi descartada.");
      const { error } = await db.from("dt_market_quotes").upsert({ owner_id: ownerId, instrument: instrument.symbol, provider: body.provider, last: body.last, bid: body.bid, ask: body.ask, exchange_at: body.exchangeAt, received_at: body.receivedAt, sequence: body.sequence }, { onConflict: "owner_id,instrument" });
      if (error) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível registrar a cotação.");
      let allBars: MinuteBar[] = [];
      if (bars.length) {
        const { error: barError } = await db.from("dt_market_bars").upsert(bars.map((bar) => ({ owner_id: ownerId, instrument: instrument.symbol, provider: body.provider, timeframe: "1m", bucket_at: bar.bucketAt, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, updated_at: new Date().toISOString() })), { onConflict: "owner_id,instrument,timeframe,bucket_at" });
        if (barError) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível registrar os candles.");

        // Process completed minutes only. These idempotent records are research observations;
        // the ProfitDLL market-data gateway has no order-routing capability.
        if (body.closedBars.length) {
          const { data: history, error: historyError } = await db.from("dt_market_bars").select("bucket_at,open,high,low,close,volume")
            .eq("owner_id", ownerId).eq("instrument", instrument.symbol).eq("timeframe", "1m")
            .order("bucket_at", { ascending: false }).limit(600);
          if (historyError) throw new ApiError(500, "DASH_READ_FAILED", "Não foi possível carregar o histórico para análise.");
          allBars = (history ?? []).reverse().map((b) => ({ ...b, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume) })) as MinuteBar[];
          const paperMissing = paperReadiness(config);
          const orderedClosedBars = [...body.closedBars].sort((a, b) => a.bucketAt.localeCompare(b.bucketAt));
          const observations = orderedClosedBars.map((closed) => {
            const prefix = allBars.filter((bar) => Date.parse(bar.bucket_at) <= Date.parse(closed.bucketAt));
            const analysis = analyzeOpeningRange(prefix, closed.bucketAt);
            const long = analysis.state === "WATCH_LONG", short = analysis.state === "WATCH_SHORT";
            return {
              owner_id: ownerId, instrument: instrument.symbol, strategy_version: "opening-range-vwap-v1",
              bar_at: closed.bucketAt, state: analysis.state,
              entry: long || short ? closed.close : null,
              stop: long ? analysis.metrics.openingLow : short ? analysis.metrics.openingHigh : null,
              explanation: analysis.explanation, blocked_reasons: paperMissing,
            };
          });
          const { error: observationError } = await db.from("dt_strategy_observations").upsert(observations, {
            onConflict: "owner_id,instrument,strategy_version,bar_at", ignoreDuplicates: true,
          });
          if (observationError) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível registrar as observações da estratégia.");
          await recordHeartbeat(db, ownerId, "price", "WORKING", `${allBars.length} candles M1 validados e carregados para leitura.`);
          await recordHeartbeat(db, ownerId, "strategy", "WORKING", `${observations.length} candle(s) fechado(s) analisado(s); observação de pesquisa, sem ordens.`);
        }
      }
      await recordHeartbeat(db, ownerId, "feed", "WORKING", "Cotação ProfitDLL recebida; somente leitura.");
      if (body.closedBars.length) {
        const paperMissing = paperReadiness(config);
        const { data: settings, error: settingsError } = await db.from("dt_settings").select("halted").eq("owner_id", ownerId).maybeSingle();
        if (settingsError) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel ler a trava da simulaÃ§Ã£o.");
        const riskBlocked = paperMissing.length > 0 || settings?.halted === true;
        await recordHeartbeat(db, ownerId, "risk", riskBlocked ? "BLOCKED" : "WORKING", riskBlocked
          ? `Paper sem entradas: ${paperMissing.join("; ") || "parada manual ativa"}.`
          : "Limites verificados pelo motor paper; nenhuma autoridade de ordem real.");
        const feePerSide = config.costs.brokeragePerContract !== null && config.costs.exchangeFeesPerContract !== null
          ? config.costs.brokeragePerContract + config.costs.exchangeFeesPerContract : null;
        for (const closed of [...body.closedBars].sort((a, b) => a.bucketAt.localeCompare(b.bucketAt))) {
          const prefix = allBars.filter((bar) => Date.parse(bar.bucket_at) <= Date.parse(closed.bucketAt));
          const signal = analyzeOpeningRange(prefix, closed.bucketAt);
          const stop = signal.state === "WATCH_LONG" ? signal.metrics.openingLow : signal.state === "WATCH_SHORT" ? signal.metrics.openingHigh : null;
          const { data: paperResult, error: paperError } = await db.rpc("dt_apply_paper_bar", { p_event: {
            owner_id: ownerId, instrument: instrument.symbol, strategy_version: "opening-range-vwap-v1",
            bar_at: closed.bucketAt, open: closed.open, high: closed.high, low: closed.low, close: closed.close,
            signal: signal.state, stop, enabled: paperMissing.length === 0 && !settings?.halted,
            point_value: instrument.pointValue, tick_size: instrument.tickSize, fee_per_side: feePerSide,
            slippage_ticks: config.costs.slippageTicks, max_loss_per_trade: config.risk.maxLossPerTrade,
            max_loss_per_day: config.risk.maxLossPerDay, max_exposure: config.risk.maxExposure,
            margin_per_contract: instrument.marginPerContract, max_trades_per_day: config.risk.maxTradesPerDay,
            max_contracts: config.risk.maxContracts, max_open_positions: config.risk.maxOpenPositions,
            last_entry: config.session.lastEntry, flat_by: config.session.flatBy,
          } });
          if (paperError) throw new ApiError(500, "DASH_WRITE_FAILED", "Falha ao atualizar o paper trading.");
          const paperAction = (paperResult as { action?: string } | null)?.action;
          if (paperAction && !["NO_ACTION", "DUPLICATE"].includes(paperAction)) {
            const blocked = ["ENTRY_BLOCKED", "DATA_GAP_NO_ENTRY"].includes(paperAction);
            await appendJournal(db, ownerId, [{ at: closed.bucketAt, desk: "execution", state: blocked ? "BLOCKED" : "WORKING", message: `Paper ${paperAction} em ${instrument.symbol}; nenhuma ordem real foi enviada.` }]);
          }
        }
        await recordHeartbeat(db, ownerId, "execution", paperMissing.length || settings?.halted ? "BLOCKED" : "WORKING", paperMissing.length || settings?.halted
          ? `Paper trading bloqueado: ${paperMissing.join("; ") || "parada manual ativa"}.`
          : "Paper trading ativo; fills simulados e roteamento de ordens reais desativado.");
      }
      return json({ ok: true, instrument: instrument.symbol, receivedAt: body.receivedAt });
    }
    if (resource === "cycle") {
      const config = dashConfig(), office = await loadDashStatus(db, ownerId), now = new Date().toISOString();
      const instrument = config.instruments.find((i) => i.enabled);
      const supervisor = supervisorWorker.step(office.heartbeats as Heartbeat[], { status: office.status, now, limits: roomLimits(config) });
      const pause = supervisor.output?.pause === true;
      if (pause && !office.halted) await setHalt(db, ownerId, true, supervisor.reason.slice(0, 200));
      const supervisorState = office.halted || pause ? "BLOCKED" : supervisor.state;
      const supervisorDetail = office.halted ? "Kill switch ativo; liberação manual necessária." : supervisor.reason;
      await recordHeartbeat(db, ownerId, "supervisor", supervisorState, supervisorDetail);
      const result = runCycle({ status: office.status, limits: roomLimits(config), now, halted: office.halted || pause || office.missing.length > 0,
        events: [], positions: [], lossToday: 0, pointValue: instrument?.verified ? instrument.pointValue : null });
      result.journal.unshift({ at: now, desk: "supervisor", state: supervisorState, message: supervisorDetail });
      if (office.missing.length) result.journal.push({ at: new Date().toISOString(), desk: "cycle", state: "SKIPPED", message: `Configuração incompleta: ${office.missing.join("; ")}.` });
      await appendJournal(db, ownerId, result.journal);
      // Nothing is sent from here: `send` stays empty in simulated mode (agents.ts maySend).
      return json({ ok: true, journal: result.journal.length, proposals: result.proposals.length, simulated: result.simulated.length, sent: 0, paused: office.halted || pause });
    }
    throw new ApiError(404, "NOT_FOUND", "Recurso do DASH desconhecido.");
  } catch (error) {
    return failure(error);
  }
}
