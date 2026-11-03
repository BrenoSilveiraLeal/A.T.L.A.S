import { z } from "zod";
import { ApiError, requireOwner } from "@/lib/auth";
import { checkCron, checkOrigin, checkProfitDllGateway, failure, json, readBody } from "@/lib/http";
import { adminClient } from "@/lib/supabase";
import { appendJournal, loadDashConfiguration, loadDashRecords, loadDashStatus, recordHeartbeat, saveDashExecutionSettings, setHalt } from "@/lib/daytrade/store";
import { runCycle } from "@/core/daytrade/cycle";
import { backtestWorker, feedWorker, newsWorker, positionsWorker, priceWorker, riskWorker, strategyWorker, supervisorWorker, type Candle, type Heartbeat } from "@/core/daytrade/agents";
import { ownerExecutionSettingsSchema, paperReadiness, roomLimits } from "@/core/daytrade/config";
import { DESKS } from "@/core/daytrade/desks";
import { required } from "@/lib/env";
import { analyzeOpeningRange, BACKTEST_CANDIDATES, selectWalkForwardCandidate, type MinuteBar } from "@/core/daytrade/analysis";
import { dayTradeSession } from "@/core/daytrade/session";
import { INITIAL_STATUS } from "@/core/daytrade/desks";
import { loadDashNewsSnapshot } from "@/lib/daytrade/news";
import { estimatePaperFuturesTax } from "@/core/daytrade/tax-estimate";

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
    if (resource === "quote") {
      checkProfitDllGateway(request);
      const ownerId = required("ATLAS_OWNER_ID"), db = adminClient();
      const { config } = await loadDashConfiguration(db, ownerId);
      const symbol = config.instruments.find((i) => i.enabled && i.verified)?.symbol;
      if (!symbol) throw new ApiError(422, "INSTRUMENT_NOT_READY", "DASH sem contrato habilitado e verificado para o gateway.");
      const { error } = await db.from("dt_market_quotes").select("instrument")
        .eq("owner_id", ownerId).eq("instrument", symbol).limit(1);
      if (error) throw new ApiError(503, "DASH_QUOTE_STORE_UNAVAILABLE", "Armazenamento de cotações do DASH indisponível.");
      return json({ status: "READY", provider: "PROFITDLL_DAYTRADE", instrument: symbol, readOnly: true });
    }
    const { user } = await requireOwner();
    const db = adminClient();
    if (resource === "bars" || resource === "backtest") {
      const { config } = await loadDashConfiguration(db, user.id);
      const symbol = new URL(request.url).searchParams.get("instrument") ?? config.instruments.find((i) => i.enabled)?.symbol;
      if (!symbol || !config.instruments.some((i) => i.enabled && i.symbol === symbol)) throw new ApiError(422, "INSTRUMENT_NOT_READY", "Selecione um contrato habilitado no DASH.");
      const pageSize = 1000, maximum = resource === "backtest" ? 20000 : 600;
      const descendingRows: Array<{ bucket_at: string; open: number | string; high: number | string; low: number | string; close: number | string; volume: number | string; turnover: number | string | null }> = [];
      const completedBefore = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
      for (let offset = 0; offset < maximum; offset += pageSize) {
        let query = db.from("dt_market_bars").select("bucket_at,open,high,low,close,volume,turnover")
          .eq("owner_id", user.id).eq("instrument", symbol).eq("timeframe", "1m")
          .order("bucket_at", { ascending: false }).range(offset, offset + Math.min(pageSize, maximum - offset) - 1);
        if (resource === "backtest") query = query.lt("bucket_at", completedBefore);
        const { data, error } = await query;
        if (error) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel ler os candles do DASH.");
        descendingRows.push(...(data ?? []));
        if ((data?.length ?? 0) < pageSize) break;
      }
      const bars = descendingRows.reverse().map((b) => ({ ...b, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume), turnover: b.turnover === null ? null : Number(b.turnover) })) as MinuteBar[];
      const contract = config.instruments.find((i) => i.symbol === symbol)!;
      if (resource === "backtest") {
        if (!config.costs.verified || config.costs.brokeragePerContract === null || config.costs.exchangeFeesPerContract === null || contract.pointValue === null || contract.tickSize === null)
          return json({ status: "COSTS_NOT_CONFIGURED", researchOnly: true });
        if (!contract.verified || !config.session.verified || config.session.open !== "09:00" || !config.session.lastEntry || !config.session.flatBy ||
          !(config.session.open < config.session.lastEntry && config.session.lastEntry < config.session.flatBy && config.session.flatBy < "18:25"))
          return json({ status: "SESSION_NOT_CONFIGURED", researchOnly: true });
        const risk = config.risk;
        if (risk.maxLossPerTrade === null || risk.maxLossPerDay === null || risk.maxLossPerDay < risk.maxLossPerTrade ||
          risk.maxTradesPerDay < 1 || risk.maxOpenPositions < 1 || risk.maxContracts < 1 ||
          risk.maxExposure === null || contract.marginPerContract === null || risk.maxExposure < contract.marginPerContract)
          return json({ status: "RISK_NOT_CONFIGURED", researchOnly: true });
        const { data: historySessions, error: historyError } = await db.from("dt_market_history_sessions")
          .select("session_day,source_bar_count").eq("owner_id", user.id).eq("instrument", symbol);
        if (historyError) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel verificar as sessÃµes ProfitDLL concluÃ­das para o backtest.");
        const completedHistoryBarCounts = Object.fromEntries((historySessions ?? []).map((row) => [row.session_day, Number(row.source_bar_count)]));
        const session = { lastEntry: config.session.lastEntry, flatBy: config.session.flatBy };
        const candidates = BACKTEST_CANDIDATES.map(({ id }) => backtestWorker.step({
          bars, pointValue: contract.pointValue!, tickSize: contract.tickSize!,
          costPerSide: config.costs.brokeragePerContract! + config.costs.exchangeFeesPerContract!,
          slippageTicks: config.costs.slippageTicks, expiresOn: contract.expiresOn ?? null, session, candidate: id,
          completedHistoryBarCounts,
          risk: { maxLossPerTrade: risk.maxLossPerTrade!, maxLossPerDay: risk.maxLossPerDay!, maxTradesPerDay: risk.maxTradesPerDay },
        }, { status: INITIAL_STATUS, now: new Date().toISOString(), limits: roomLimits(config) }));
        if (candidates.some((candidate) => candidate.state !== "WORKING" || !candidate.output))
          return json({ status: "BACKTEST_BLOCKED", researchOnly: true, reasons: candidates.map((candidate) => candidate.reason) });
        const reports = candidates.map((candidate) => candidate.output!);
        return json({ candidates: reports, selection: selectWalkForwardCandidate(reports) });
      }
      const { data: quote, error: quoteError } = await db.from("dt_market_quotes")
        .select("provider,received_at,exchange_at").eq("owner_id", user.id).eq("instrument", symbol).maybeSingle();
      if (quoteError) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel verificar a atualidade do feed do DASH.");
      const now = Date.now(), receivedAt = quote ? Date.parse(quote.received_at) : NaN, exchangeAt = quote ? Date.parse(quote.exchange_at) : NaN;
      const feedFresh = quote?.provider === "PROFITDLL_DAYTRADE" && Number.isFinite(receivedAt) && Number.isFinite(exchangeAt) &&
        receivedAt <= now + config.data.maxDelayMs && now - receivedAt >= 0 && now - receivedAt < config.data.staleAfterMs &&
        receivedAt >= exchangeAt && receivedAt - exchangeAt <= config.data.maxDelayMs;
      const currentMinute = Math.floor(now / 60_000) * 60_000;
      const sessionDay = dayTradeSession(new Date(now), config, contract.expiresOn ?? null).day;
      const localDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
      // The minute chart is a single trading session. Do not compress overnight or weekend gaps
      // by returning multiple sessions as if their candles were adjacent. The live table also
      // stores the current forming minute; keep it out of this chart, which labels bars as closed
      // and computes indicators only from completed candles.
      const latestStoredDay = bars.length ? localDay(bars.at(-1)!.bucket_at) : null;
      const chartBars = latestStoredDay ? bars.filter((bar) => localDay(bar.bucket_at) === latestStoredDay && Date.parse(bar.bucket_at) < currentMinute) : [];
      const completedBars = chartBars.filter((bar) => Date.parse(bar.bucket_at) < currentMinute && localDay(bar.bucket_at) === sessionDay);
      const analysis = analyzeOpeningRange(completedBars, new Date(now).toISOString(), contract.expiresOn ?? null, contract.tickSize);
      const displayedAnalysis = chartBars.length && !feedFresh
        ? { ...analysis, state: "WAITING_FOR_OPENING_RANGE" as const, explanation: "CotaÃ§Ã£o ProfitDLL sem atualizaÃ§Ã£o recente; sinais desativados atÃ© o feed voltar." }
        : analysis;
      return json({ instrument: symbol, timeframe: "1m", bars: chartBars, analysis: displayedAnalysis, feedFresh, source: "PROFITDLL_DAYTRADE" });
    }
    if (resource === "status") return json(await loadDashStatus(db, user.id));
    if (resource === "config") {
      const resolved = await loadDashConfiguration(db, user.id), status = await loadDashStatus(db, user.id, resolved.config);
      return json({ config: resolved.config, executionSettings: resolved.executionSettings, sourceNote: resolved.sourceNote,
        confirmedAt: resolved.confirmedAt, limits: roomLimits(resolved.config), paperMissing: status.paperMissing, market: status.status.market });
    }
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
    if (resource === "tax-estimate") {
      // The owner session is checked above; admin reads are still strictly scoped to that owner.
      // Stop at a fixed history ceiling and refuse to publish partial monthly totals as complete.
      const pageSize = 1000, maximum = 20000;
      const fills: Array<{ action: "ENTRY" | "EXIT"; bar_at: string; reason: string; net_pnl: string | null }> = [];
      for (let offset = 0; offset < maximum; offset += pageSize) {
        const { data, error } = await db.from("dt_paper_fills").select("action,bar_at,reason,net_pnl")
          .eq("owner_id", user.id).order("bar_at", { ascending: true }).order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw new ApiError(500, "DASH_TAX_READ_FAILED", "N\u00e3o foi poss\u00edvel ler o hist\u00f3rico paper para a estimativa.");
        fills.push(...(data ?? []) as typeof fills);
        if ((data?.length ?? 0) < pageSize) break;
      }
      let historyLimited = fills.length === maximum;
      if (historyLimited) {
        const { data, error } = await db.from("dt_paper_fills").select("id").eq("owner_id", user.id)
          .order("bar_at", { ascending: true }).order("id", { ascending: true }).range(maximum, maximum);
        if (error) throw new ApiError(500, "DASH_TAX_READ_FAILED", "N\u00e3o foi poss\u00edvel verificar o limite do hist\u00f3rico paper.");
        historyLimited = (data?.length ?? 0) > 0;
      }
      const { config } = await loadDashConfiguration(db, user.id);
      if (historyLimited) return json({ status: "HISTORY_LIMIT", coverage: "INCOMPLETE", scannedFills: fills.length, months: [] });
      const months = estimatePaperFuturesTax(fills, config.tax);
      return json({ status: months.length ? "READY" : "NO_CLOSED_TRADES", coverage: "ALL_RECORDED_PAPER_FILLS", scannedFills: fills.length,
        carryInUnknown: true, months: months.slice(-24).reverse() });
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
// Inbound snapshot from the private Windows gateway. The gateway uses dedicated PROFITDLL_INGEST_SECRET over HTTPS, separate from CRON_SECRET;
// ticks are read-only and must match a configured, enabled contract.
const quoteSchema = z.object({
  provider: z.literal("PROFITDLL_DAYTRADE"), instrument: z.string().regex(/^[A-Z0-9$]{3,12}$/),
  last: z.number().finite().positive(), bid: z.number().finite().positive().nullable(), ask: z.number().finite().positive().nullable(),
  exchangeAt: z.string().datetime({ offset: true }), receivedAt: z.string().datetime({ offset: true }),
  // The gateway emits a monotonically increasing tick sequence. Accepting null here
  // would let a replay bypass the database's sequence ordering guard.
  sequence: z.number().int().nonnegative().refine(Number.isSafeInteger),
  bar: z.object({ bucketAt: z.string().datetime({ offset: true }), open: z.number().finite().positive(), high: z.number().finite().positive(), low: z.number().finite().positive(), close: z.number().finite().positive(), volume: z.number().int().positive().refine(Number.isSafeInteger), turnover: z.number().finite().nonnegative().nullable().optional() }).strict().optional(),
  closedBars: z.array(z.object({ bucketAt: z.string().datetime({ offset: true }), open: z.number().finite().positive(), high: z.number().finite().positive(), low: z.number().finite().positive(), close: z.number().finite().positive(), volume: z.number().int().positive().refine(Number.isSafeInteger), turnover: z.number().finite().nonnegative().nullable().optional() }).strict()).max(10).default([]),
}).strict().superRefine((q, ctx) => {
  if (q.bid !== null && q.ask !== null && q.bid > q.ask) ctx.addIssue({ code: "custom", path: ["bid"], message: "Livro inconsistente." });
  if (q.bar && (q.bar.high < Math.max(q.bar.open, q.bar.close, q.bar.low) || q.bar.low > Math.min(q.bar.open, q.bar.close, q.bar.high) || q.bar.close !== q.last)) ctx.addIssue({ code: "custom", path: ["bar"], message: "Inconsistent current candle." });
  const exchangeMinute = Math.floor(Date.parse(q.exchangeAt) / 60_000) * 60_000;
  const validateTurnover = (bar: { low: number; high: number; volume: number; turnover?: number | null }, path: (string | number)[]) => {
    if (bar.turnover == null) return; // Legacy collectors remain readable, but VWAP analysis will wait for exact trade totals.
    const tolerance = Math.max(0.01, bar.high * bar.volume * 1e-9);
    if (bar.turnover < bar.low * bar.volume - tolerance || bar.turnover > bar.high * bar.volume + tolerance)
      ctx.addIssue({ code: "custom", path, message: "O total preço×quantidade precisa estar entre mínima×volume e máxima×volume." });
  };
  if (q.bar) validateTurnover(q.bar, ["bar", "turnover"]);
  q.closedBars.forEach((bar, index) => validateTurnover(bar, ["closedBars", index, "turnover"]));
  if (q.bar && Date.parse(q.bar.bucketAt) !== exchangeMinute)
    ctx.addIssue({ code: "custom", path: ["bar", "bucketAt"], message: "O candle em formacao precisa corresponder ao minuto do negocio ProfitDLL." });
  if (q.bar && Date.parse(q.bar.bucketAt) % 60_000 !== 0)
    ctx.addIssue({ code: "custom", path: ["bar", "bucketAt"], message: "O início do candle atual precisa estar alinhado ao minuto." });
  let previousClosedMinute = -Infinity;
  q.closedBars.forEach((bar, index) => {
    if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) ctx.addIssue({ code: "custom", path: ["closedBars", index], message: "Inconsistent closed candle." });
    const bucketMinute = Date.parse(bar.bucketAt);
    if (bucketMinute % 60_000 !== 0)
      ctx.addIssue({ code: "custom", path: ["closedBars", index, "bucketAt"], message: "O início do candle fechado precisa estar alinhado ao minuto." });
    if (bucketMinute >= exchangeMinute)
      ctx.addIssue({ code: "custom", path: ["closedBars", index, "bucketAt"], message: "Um candle fechado precisa anteceder o minuto da cotação." });
    if (bucketMinute <= previousClosedMinute)
      ctx.addIssue({ code: "custom", path: ["closedBars", index, "bucketAt"], message: "Candles fechados precisam chegar em ordem cronológica, sem duplicatas." });
    previousClosedMinute = bucketMinute;
  });
});

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  try {
    const { resource } = await params;
    if (resource === "config") {
      checkOrigin(request);
      const { user } = await requireOwner();
      const settings = ownerExecutionSettingsSchema.parse(await readBody(request));
      const db = adminClient(), saved = await saveDashExecutionSettings(db, user.id, settings);
      const status = await loadDashStatus(db, user.id, saved.config);
      return json({ ok: true, config: saved.config, executionSettings: saved.executionSettings, sourceNote: saved.sourceNote,
        confirmedAt: saved.confirmedAt, paperMissing: status.paperMissing });
    }
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
      const { config } = await loadDashConfiguration(db, ownerId);
      const instrument = config.instruments.find((i) => i.enabled && i.symbol === body.instrument);
      if (!instrument || !instrument.verified || !instrument.symbol) throw new ApiError(422, "INSTRUMENT_NOT_READY", "Contrato não está habilitado e verificado na configuração do DASH.");
      if (instrument.expiresOn && new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()) > instrument.expiresOn) throw new ApiError(422, "CONTRACT_EXPIRED", "Contract expired; update the symbol before collecting quotes.");
      const clientReceived = Date.parse(body.receivedAt), exchange = Date.parse(body.exchangeAt);
      const serverReceived = Date.now(), serverReceivedAt = new Date(serverReceived).toISOString();
      const exchangeDelayMs = serverReceived - exchange;
      const inRegularSession = (bar: { bucketAt: string }) => {
        const at = Date.parse(bar.bucketAt);
        if (!Number.isFinite(at)) return false;
        const session = dayTradeSession(new Date(at), config, instrument.expiresOn ?? null);
        const localTime = new Intl.DateTimeFormat("en-GB", {
          timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).format(new Date(at));
        return session.state === "OPEN" && localTime >= session.open && localTime < session.close;
      };
      // Keep quote health visible outside exchange hours, but only persist regular-session candles.
      const sessionClosedBars = body.closedBars.filter(inRegularSession);
      const sessionCurrentBar = body.bar && inRegularSession(body.bar) ? body.bar : undefined;
      // A fresh quote does not make older closed candles actionable. Keep late bars for research,
      // but never let a delayed batch create fills at historical next-minute opens.
      const freshClosedBars = sessionClosedBars.filter((bar) => {
        const closedAt = Date.parse(bar.bucketAt) + 60_000;
        const closeDelay = serverReceived - closedAt;
        return Number.isFinite(closedAt) && closeDelay >= 0 && closeDelay <= config.data.staleAfterMs;
      });
      const delayedClosedBarCount = sessionClosedBars.length - freshClosedBars.length;
      const bars = [...sessionClosedBars, ...(sessionCurrentBar ? [sessionCurrentBar] : [])];
      const seenBuckets = new Set<string>();
      for (const bar of bars) {
        const bucket = Date.parse(bar.bucketAt);
        if (!Number.isFinite(bucket) || bucket % 60_000 !== 0 || bucket > serverReceived || serverReceived - bucket > 120_000)
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
      // A client-supplied receive time is useful only to detect its clock skew. Feed age is
      // measured against this server's clock so a fast local clock cannot make stale data fresh.
      if (Math.abs(serverReceived - clientReceived) > config.data.maxDelayMs || exchangeDelayMs < 0 || exchangeDelayMs > config.data.maxDelayMs)
        throw new ApiError(422, "QUOTE_STALE", "Cotação fora da janela de atraso permitida.");
      const { data: quoteAccepted, error: quoteWriteError } = await db.rpc("dt_accept_market_quote", {
        p_owner_id: ownerId, p_instrument: instrument.symbol, p_provider: body.provider,
        p_last: body.last, p_bid: body.bid, p_ask: body.ask, p_exchange_at: body.exchangeAt,
        p_received_at: serverReceivedAt, p_sequence: body.sequence,
        p_bars: bars.map((bar) => ({ bucket_at: bar.bucketAt, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, turnover: bar.turnover ?? null })),
      });
      if (quoteWriteError) throw new ApiError(500, "DASH_WRITE_FAILED", "Falha ao validar e registrar a cotacao.");
      if (quoteAccepted !== true)
        throw new ApiError(409, "QUOTE_OUT_OF_ORDER", "Cotacao repetida ou fora de ordem foi descartada.");
      let allBars: MinuteBar[] = [];
      let sessionPaperAllowed = false;
      let newsMissing = ["Cobertura de notícias/calendário ausente; entradas paper bloqueadas."];
      let newsDetail = newsMissing[0];
      const researchStatus = { ...INITIAL_STATUS, data: "REAL" as const, broker: "ProfitDLL", instrument: body.instrument };
      const researchContext = { status: researchStatus, now: serverReceivedAt, limits: roomLimits(config), instrumentTickSize: instrument.tickSize };
      const runResearchStrategy = (prefix: MinuteBar[]) => {
        const candles = prefix.map((bar): Candle => ({
          instrument: body.instrument, start: bar.bucket_at, open: bar.open, high: bar.high, low: bar.low,
          close: bar.close, volume: bar.volume, turnover: bar.turnover ?? null,
          provenance: { source: body.provider, receivedAt: serverReceivedAt, delayMs: exchangeDelayMs, simulated: false },
        }));
        const snapshot = {
          provenance: [{ source: body.provider, receivedAt: serverReceivedAt, delayMs: exchangeDelayMs, simulated: false }],
          candles, book: [],
        };
        const feed = feedWorker.step(snapshot, researchContext);
        if (feed.state !== "WORKING" || !feed.output)
          return { state: "BLOCKED" as const, output: [], reason: feed.reason };
        const market = priceWorker.step(feed.output, researchContext);
        if (market.state !== "WORKING" || !market.output)
          return { state: "BLOCKED" as const, output: [], reason: market.reason };
        return strategyWorker.step({ ...market.output, gate: { blockEntries: false, sizeFactor: 1, reasons: [] }, expiresOn: instrument.expiresOn ?? null }, researchContext);
      };
      if (bars.length) {

        const exchangeMinute = Math.floor(exchange / 60_000) * 60_000;
        const hasCurrentBarProof = body.bar !== undefined && Date.parse(body.bar.bucketAt) === exchangeMinute;
        if (hasCurrentBarProof) {
          const session = dayTradeSession(new Date(exchange), config, instrument.expiresOn ?? null);
          const nextState = session.state === "CLOSED" ? "CLOSED" : session.paperAllowed ? "OPEN" : "PAUSED";
          const { data: previousSession, error: sessionReadError } = await db.from("dt_sessions").select("status, opened_at, closed_at")
            .eq("owner_id", ownerId).eq("day", session.day).maybeSingle();
          if (sessionReadError) throw new ApiError(500, "DASH_READ_FAILED", "Falha ao ler a sessao do DASH.");
          const { error: sessionWriteError } = await db.from("dt_sessions").upsert({
            owner_id: ownerId, day: session.day, status: nextState,
            plan: { instrument: instrument.symbol, source: `B3-WIN-09:00-${session.close}`, open: session.open, close: session.close, reason: session.reason,
              exchangeAt: body.exchangeAt, barAt: body.bar!.bucketAt, confirmedAt: serverReceivedAt },
            opened_at: nextState === "OPEN" ? previousSession?.opened_at ?? serverReceivedAt : previousSession?.opened_at ?? null,
            closed_at: nextState === "OPEN" ? null : previousSession?.status === "OPEN" ? serverReceivedAt : previousSession?.closed_at ?? null,
            close_reason: nextState === "OPEN" ? null : session.reason,
          }, { onConflict: "owner_id,day" });
          if (sessionWriteError) throw new ApiError(500, "DASH_WRITE_FAILED", "Falha ao confirmar a sessao do DASH.");
          sessionPaperAllowed = session.paperAllowed && nextState === "OPEN" && exchangeDelayMs <= config.data.staleAfterMs;
        }

        // Process completed minutes only. These idempotent records are research observations;
        // the ProfitDLL market-data gateway has no order-routing capability.
        if (freshClosedBars.length) {
          const { data: history, error: historyError } = await db.from("dt_market_bars").select("bucket_at,open,high,low,close,volume,turnover")
            .eq("owner_id", ownerId).eq("instrument", instrument.symbol).eq("timeframe", "1m")
            .order("bucket_at", { ascending: false }).limit(600);
          if (historyError) throw new ApiError(500, "DASH_READ_FAILED", "Não foi possível carregar o histórico para análise.");
          allBars = (history ?? []).reverse().map((b) => ({ ...b, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: Number(b.volume), turnover: b.turnover === null ? null : Number(b.turnover) })) as MinuteBar[];
          // Poll slow feeds only when a bar closes; the collector may send many quote ticks per minute.
          const newsCoverage = await loadDashNewsSnapshot(db, ownerId);
          const newsAssessment = newsWorker.step(newsCoverage.snapshot, { ...researchContext, now: newsCoverage.assessedAt });
          const newsGate = newsAssessment.output;
          newsMissing = newsAssessment.state === "BLOCKED"
            ? [...(newsGate?.reasons ?? [newsAssessment.reason]), ...(newsCoverage.unavailable.length ? [`Fontes sem dados recentes: ${newsCoverage.unavailable.join(", ")}.`] : [])]
            : newsGate?.sizeFactor !== undefined && newsGate.sizeFactor < 1
              ? [...newsGate.reasons, "Paper tem tamanho mínimo de um contrato; entradas reduzidas por notícia MEDIUM permanecem bloqueadas."]
              : [];
          newsDetail = newsMissing.length
            ? newsMissing.join(" ")
            : `Cobertura das fontes configuradas válida em ${newsCoverage.snapshot.refreshedAt}; ${newsCoverage.snapshot.source}.`;
          const delayedBarReason = delayedClosedBarCount
            ? `${delayedClosedBarCount} candle(s) fechado(s) chegaram atrasados; permanecem no histórico, sem gerar sinal ou fill retroativo.`
            : null;
          const paperMissing = [...paperReadiness(config, instrument.expiresOn ?? null), ...newsMissing, ...(delayedBarReason ? [delayedBarReason] : [])];
          const orderedClosedBars = [...body.closedBars].sort((a, b) => a.bucketAt.localeCompare(b.bucketAt));
          const observations = orderedClosedBars.map((closed) => {
            const closeDelay = serverReceived - (Date.parse(closed.bucketAt) + 60_000);
            if (!Number.isFinite(closeDelay) || closeDelay < 0 || closeDelay > config.data.staleAfterMs) {
              return {
                owner_id: ownerId, instrument: instrument.symbol, strategy_version: "opening-range-vwap-v1",
                bar_at: closed.bucketAt, state: "NO_SETUP",
                entry: null, stop: null,
                explanation: "Candle atrasado ou com horário inválido; mantido no histórico sem sinal retroativo.",
                blocked_reasons: [...paperMissing, "Sinal retroativo desativado para candles que excedem o limite de frescor."],
              };
            }
            const prefix = allBars.filter((bar) => Date.parse(bar.bucket_at) <= Date.parse(closed.bucketAt));
            const analysis = analyzeOpeningRange(prefix, closed.bucketAt, instrument.expiresOn ?? null, instrument.tickSize);
            const strategy = runResearchStrategy(prefix);
            const candidate = strategy.state === "WORKING" ? strategy.output?.[0] : undefined;
            const long = candidate?.side === "BUY", short = candidate?.side === "SELL";
            const state = long ? "WATCH_LONG" : short ? "WATCH_SHORT" : strategy.state === "BLOCKED" ? "NO_SETUP" : analysis.state;
            return {
              owner_id: ownerId, instrument: instrument.symbol, strategy_version: "opening-range-vwap-v1",
              bar_at: closed.bucketAt, state,
              entry: long || short ? closed.close : null,
              stop: candidate?.stop ?? null,
              explanation: strategy.state === "BLOCKED" ? strategy.reason : candidate?.reason ?? analysis.explanation,
              blocked_reasons: strategy.state === "BLOCKED" ? [...paperMissing, strategy.reason] : paperMissing,
            };
          });
          const { error: observationError } = await db.from("dt_strategy_observations").upsert(observations, {
            onConflict: "owner_id,instrument,strategy_version,bar_at", ignoreDuplicates: true,
          });
          if (observationError) throw new ApiError(500, "DASH_WRITE_FAILED", "Não foi possível registrar as observações da estratégia.");
          await recordHeartbeat(db, ownerId, "price", "WORKING", `${allBars.length} candles M1 validados e carregados para leitura.`);
          await recordHeartbeat(db, ownerId, "strategy", delayedClosedBarCount ? "BLOCKED" : "WORKING", delayedClosedBarCount
            ? `${delayedClosedBarCount} candle(s) atrasado(s) salvos apenas para pesquisa; nenhum sinal retroativo emitido.`
            : `${observations.length} candle(s) fechado(s) analisado(s); observação de pesquisa, sem ordens.`);
        }
      }
      await recordHeartbeat(db, ownerId, "feed", "WORKING", "Cotação ProfitDLL recebida; somente leitura.");
      if (freshClosedBars.length) {
        const delayedBarReason = delayedClosedBarCount
          ? `${delayedClosedBarCount} candle(s) fechado(s) chegaram atrasados; permanecem no histórico, sem gerar sinal ou fill retroativo.`
          : null;
        const paperMissing = [...paperReadiness(config, instrument.expiresOn ?? null), ...newsMissing, ...(delayedBarReason ? [delayedBarReason] : [])];
        const newsBlocked = newsMissing.length > 0;
        await recordHeartbeat(db, ownerId, "news", newsBlocked ? "BLOCKED" : "WORKING",
          newsDetail.slice(0, 300));
        const { data: settings, error: settingsError } = await db.from("dt_settings").select("halted").eq("owner_id", ownerId).maybeSingle();
        if (settingsError) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel ler a trava da simulaÃ§Ã£o.");
        const riskBlocked = paperMissing.length > 0 || settings?.halted === true || !sessionPaperAllowed;
        const feePerSide = config.costs.brokeragePerContract !== null && config.costs.exchangeFeesPerContract !== null
          ? config.costs.brokeragePerContract + config.costs.exchangeFeesPerContract : null;
        let latestPaperState: { positionSide: number; realizedPnlToday: number; tradesToday: number } | null = null;
        let latestRiskFinding: string | null = null;
        for (const closed of [...freshClosedBars].sort((a, b) => a.bucketAt.localeCompare(b.bucketAt))) {
          const prefix = allBars.filter((bar) => Date.parse(bar.bucket_at) <= Date.parse(closed.bucketAt));
          const signal = analyzeOpeningRange(prefix, closed.bucketAt, instrument.expiresOn ?? null, instrument.tickSize);
          const strategy = runResearchStrategy(prefix);
          const candidate = strategy.state === "WORKING" ? strategy.output?.[0] : undefined;
          let riskAllowsEntry = true;
          if (candidate) {
            const { data: persistedState, error: persistedStateError } = await db.from("dt_paper_state")
              .select("position_side,entry_price,realized_pnl_today").eq("owner_id", ownerId).eq("instrument", instrument.symbol).maybeSingle();
            if (persistedStateError) throw new ApiError(500, "DASH_READ_FAILED", "NÃ£o foi possÃ­vel reconciliar o estado paper antes do veto de risco.");
            const pointValue = instrument.pointValue;
            const proposalMaxLoss = pointValue === null || instrument.tickSize === null || feePerSide === null
              ? Number.POSITIVE_INFINITY
              : Math.abs(candidate.entry - candidate.stop) * pointValue +
                2 * (feePerSide + instrument.tickSize * pointValue * config.costs.slippageTicks);
            const riskAssessment = riskWorker.step({
              proposal: {
                signal: {
                  id: `${instrument.symbol}:${closed.bucketAt}:${candidate.strategyVersion}`,
                  instrument: instrument.symbol, side: candidate.side, strategyVersion: candidate.strategyVersion,
                  entry: candidate.entry, stop: candidate.stop, target: candidate.target,
                  reason: candidate.reason, createdAt: closed.bucketAt,
                },
                quantity: 1, maxLoss: proposalMaxLoss, proposedBy: "strategy",
              },
              positions: Number(persistedState?.position_side ?? 0) === 0 ? [] : [{
                instrument: instrument.symbol, quantity: Number(persistedState!.position_side),
                averagePrice: Number(persistedState!.entry_price), confirmedByBroker: false,
              }],
              lossToday: Number(persistedState?.realized_pnl_today ?? 0),
              riskStateReconciled: true,
            }, {
              ...researchContext,
              status: { ...researchStatus, market: sessionPaperAllowed ? "OPEN" : "CLOSED" },
            });
            riskAllowsEntry = riskAssessment.state === "WORKING" && riskAssessment.output?.approved === true;
            latestRiskFinding = riskAllowsEntry ? null : riskAssessment.reason || "Proposta bloqueada pelo setor de risco.";
            if (!riskAllowsEntry) {
              await appendJournal(db, ownerId, [{ at: closed.bucketAt, desk: "risk", state: "BLOCKED",
                message: `Veto paper ${instrument.symbol}: ${latestRiskFinding}` }]);
            }
          }
          const signalState = !riskAllowsEntry ? "NO_SETUP" : candidate?.side === "BUY" ? "WATCH_LONG" : candidate?.side === "SELL" ? "WATCH_SHORT" : strategy.state === "BLOCKED" ? "NO_SETUP" : signal.state;
          const stop = candidate?.stop ?? null;
          const { data: paperResult, error: paperError } = await db.rpc("dt_apply_paper_bar", { p_event: {
            owner_id: ownerId, instrument: instrument.symbol, strategy_version: "opening-range-vwap-v1",
            bar_at: closed.bucketAt, open: closed.open, high: closed.high, low: closed.low, close: closed.close,
            signal: signalState, stop, ema_fast: signal.metrics.emaFast, vwap: signal.metrics.vwap,
            enabled: paperMissing.length === 0 && !settings?.halted && sessionPaperAllowed && strategy.state !== "BLOCKED" && riskAllowsEntry,
            point_value: instrument.pointValue, tick_size: instrument.tickSize, fee_per_side: feePerSide,
            slippage_ticks: config.costs.slippageTicks, max_loss_per_trade: config.risk.maxLossPerTrade,
            max_loss_per_day: config.risk.maxLossPerDay, max_exposure: config.risk.maxExposure,
            margin_per_contract: instrument.marginPerContract, max_trades_per_day: config.risk.maxTradesPerDay,
            max_contracts: config.risk.maxContracts, max_open_positions: config.risk.maxOpenPositions,
            last_entry: config.session.lastEntry, flat_by: config.session.flatBy,
          } });
          if (paperError) throw new ApiError(500, "DASH_WRITE_FAILED", "Falha ao atualizar o paper trading.");
          const currentPaperState = paperResult as { positionSide?: number; realizedPnlToday?: number; tradesToday?: number } | null;
          if (currentPaperState) {
            latestPaperState = {
              positionSide: Number(currentPaperState.positionSide ?? 0),
              realizedPnlToday: Number(currentPaperState.realizedPnlToday ?? 0),
              tradesToday: Number(currentPaperState.tradesToday ?? 0),
            };
          }
          const paperAction = (paperResult as { action?: string } | null)?.action;
          if (paperAction && !["NO_ACTION", "DUPLICATE"].includes(paperAction)) {
            const blocked = ["ENTRY_BLOCKED", "DATA_GAP_NO_ENTRY"].includes(paperAction);
            await appendJournal(db, ownerId, [{ at: closed.bucketAt, desk: "execution", state: blocked ? "BLOCKED" : "WORKING", message: `Paper ${paperAction} em ${instrument.symbol}; nenhuma ordem real foi enviada.` }]);
          }
        }
        const executionBlocked = paperMissing.length > 0 || settings?.halted === true || !sessionPaperAllowed;
        const riskHeartbeatBlocked = riskBlocked || latestRiskFinding !== null;
        await recordHeartbeat(db, ownerId, "risk", riskHeartbeatBlocked ? "BLOCKED" : "WORKING", riskHeartbeatBlocked
          ? latestRiskFinding ?? `Paper sem entradas: ${paperMissing.join("; ") || (settings?.halted ? "parada manual ativa" : "sessao sem candle atual ou cotacao fora do limite de frescor")}.`
          : "Limites independentes conferidos com o estado paper persistido; RPC transacional mantém o veto final. Nenhuma ordem real pode ser enviada.");
        await recordHeartbeat(db, ownerId, "execution", executionBlocked ? "BLOCKED" : "WORKING", executionBlocked
          ? `Paper trading bloqueado: ${paperMissing.join("; ") || (settings?.halted ? "parada manual ativa" : "sessao sem candle atual ou cotacao fora do limite de frescor")}.`
          : "Paper trading ativo; fills simulados e roteamento de ordens reais desativado.");
        const { data: positionRows, error: positionError } = await db.from("dt_paper_state")
          .select("instrument,position_side,entry_price,realized_pnl_today,trades_today").eq("owner_id", ownerId).eq("instrument", instrument.symbol);
        if (positionError) throw new ApiError(500, "DASH_READ_FAILED", "Falha ao reconciliar a posicao do paper trading.");
        if (!latestPaperState) {
          const paperState = positionRows?.[0];
          latestPaperState = {
            positionSide: Number(paperState?.position_side ?? 0),
            realizedPnlToday: Number(paperState?.realized_pnl_today ?? 0),
            tradesToday: Number(paperState?.trades_today ?? 0),
          };
        }
        const observedAt = new Date().toISOString();
        const positionSnapshot = positionsWorker.step({
          source: "PAPER", complete: true, observedAt,
          positions: (positionRows ?? []).flatMap((row) => Number(row.position_side) === 0 ? [] : [{
            instrument: row.instrument, quantity: Number(row.position_side), averagePrice: Number(row.entry_price), confirmedByBroker: false,
          }]),
        }, { ...researchContext, now: observedAt });
        await recordHeartbeat(db, ownerId, "positions", positionSnapshot.state,
          positionSnapshot.state === "WORKING"
            ? `Snapshot paper reconciliado (${positionSnapshot.output?.positions[0]?.quantity ?? 0}); P&L realizado hoje ${latestPaperState.realizedPnlToday}; nao representa reconciliacao com a corretora.`
            : positionSnapshot.reason);
        await recordHeartbeat(db, ownerId, "orders", "IDLE", "O DASH está em paper trading; nenhuma ordem foi enviada à corretora.");
        await recordHeartbeat(db, ownerId, "ledger", "WORKING", "Fills paper registrados em dt_paper_fills e espelhados em dt_ledger; sem lancamentos financeiros reais ou reconciliacao de corretora.");
      }
      return json({ ok: true, instrument: instrument.symbol, receivedAt: serverReceivedAt });
    }
    if (resource === "cycle") {
      const { config } = await loadDashConfiguration(db, ownerId), now = new Date().toISOString();
      const newsCoverage = await loadDashNewsSnapshot(db, ownerId, true);
      const newsAssessment = newsWorker.step(newsCoverage.snapshot, { status: INITIAL_STATUS, now: newsCoverage.assessedAt, limits: roomLimits(config) });
      const newsGate = newsAssessment.output;
      const newsPaperBlocked = newsAssessment.state === "BLOCKED" || (newsGate?.sizeFactor ?? 0) < 1;
      const newsDetail = newsAssessment.state === "BLOCKED"
        ? `${newsAssessment.reason} ${newsCoverage.unavailable.length ? `Sem resposta recente: ${newsCoverage.unavailable.join(", ")}.` : ""}`
        : newsGate?.sizeFactor !== undefined && newsGate.sizeFactor < 1
          ? `${newsGate.reasons.join(" ")} Paper bloqueado: o tamanho mínimo é um contrato.`
          : `Cobertura configurada válida em ${newsCoverage.snapshot.refreshedAt}; ${newsCoverage.snapshot.source}.`;
      await recordHeartbeat(db, ownerId, "news", newsPaperBlocked ? "BLOCKED" : "WORKING", newsDetail.slice(0, 300));
      const office = await loadDashStatus(db, ownerId);
      const instrument = config.instruments.find((i) => i.enabled);
      const supervisor = supervisorWorker.step(office.heartbeats as Heartbeat[], { status: office.status, now, limits: roomLimits(config) });
      const pause = supervisor.output?.pause === true;
      if (pause && !office.halted) await setHalt(db, ownerId, true, supervisor.reason.slice(0, 200));
      const supervisorState = office.halted || pause ? "BLOCKED" : supervisor.state;
      const supervisorDetail = office.halted ? "Kill switch ativo; liberação manual necessária." : supervisor.reason;
      await recordHeartbeat(db, ownerId, "supervisor", supervisorState, supervisorDetail);
      const result = runCycle({ status: office.status, limits: roomLimits(config), now, halted: office.halted || pause || office.missing.length > 0,
        feedSnapshot: null, news: { events: [], complete: false, source: "", refreshedAt: "" }, positions: [], lossToday: 0, riskStateReconciled: false, pointValue: instrument?.verified ? instrument.pointValue : null, strategyApproval: config.strategy });
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
