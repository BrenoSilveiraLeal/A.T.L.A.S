/**
 * What each DASH desk reads and hands on, ready to be implemented (owner, 01/11/2026: "cada um terá
 * sua função, que será implementada também no outro computador; deixe o máximo possível já pronto
 * para implementação"). The flow of a trade, desk by desk:
 *
 *   feed → price → news → strategy (backtest validates its versions) → analysis room
 *   (strategy, risk, execution, chief) → risk veto → execution → orders → positions → ledger
 *
 * The supervisor watches every desk's heartbeat; the chief opens and closes the session.
 *
 * Types and pure rules only (no I/O, no broker, no timers). Some generic-cycle workers still answer IDLE
 * with the reason, never invented data; dedicated ProfitDLL ingestion, chart, backtest and transactional
 * paper paths run separately. The supervisor is an observation-only guard.
 * The rules that guard money — who may
 * send an order and when — are implemented here and tested (tests/daytrade-agents.test.ts), so a
 * worker written later cannot skip them.
 */
import type { DeskId, DashStatus } from "./desks";
import { analyzeOpeningRange, BACKTEST_CANDIDATES, backtestCandidate, type BacktestCandidateId, type BacktestRiskLimits, type BacktestSummary, type MinuteBar } from "./analysis";

// ----- Messages between the desks -----

/** Where a piece of data came from and how old it is; data without this is not used. */
export interface Provenance { source: string; receivedAt: string; delayMs: number; simulated: boolean }
export interface CandleProvenance extends Omit<Provenance, "delayMs"> { delayMs: number | null; persisted?: boolean }
export interface Candle { instrument: string; start: string; open: number; high: number; low: number; close: number; volume: number; turnover?: number | null; provenance: CandleProvenance }
export interface BookTop { instrument: string; bid: number; ask: number; bidSize: number; askSize: number; provenance: Provenance }
export interface FeedSnapshot { provenance: Provenance[]; candles: Candle[]; book: BookTop[] }
export interface MarketEvent { kind: "NEWS" | "CALENDAR" | "AUCTION" | "HALT"; title: string; at: string; impact: "LOW" | "MEDIUM" | "HIGH"; provenance: Provenance }
/** The news desk can only hold back or shrink entries, never open one. */
export interface NewsGate { blockEntries: boolean; sizeFactor: number; reasons: string[] }
/** Complete, timestamped source snapshot; an empty event list is meaningful only when complete is true. */
export interface NewsSnapshot { events: MarketEvent[]; complete: boolean; source: string; refreshedAt: string }
export const NEWS_SNAPSHOT_MAX_AGE_MS = 15 * 60_000;
export interface Signal {
  id: string; instrument: string; side: "BUY" | "SELL"; strategyVersion: string;
  entry: number; stop: number; target: number | null; reason: string; createdAt: string;
}
export interface BacktestReport { strategyVersion: string; trades: number; winRate: number; maxDrawdown: number; approved: boolean; notes: string }
/** A signal turned into a concrete trade, as it goes into the analysis room. */
export interface TradeProposal { signal: Signal; quantity: number; maxLoss: number; proposedBy: DeskId }
export type Vote = "APPROVE" | "REJECT" | "ABSTAIN";
export interface RoomVote { desk: DeskId; vote: Vote; reason: string }
export interface RiskLimits {
  maxLossPerTrade: number; maxLossPerDay: number; maxOpenPositions: number; maxExposure: number;
  maxContracts: number; marginPerContract: number; pointValue: number; tickSize: number; costPerSide: number; slippageTicks: number;
}
export interface RiskDecision { approved: boolean; reasons: string[] }
export interface StrategyApproval { id: string | null; version: string | null; approved: boolean }
export interface OrderRequest { proposalId: string; instrument: string; side: "BUY" | "SELL"; quantity: number; type: "LIMIT" | "MARKET"; price: number | null; stop: number }
export type OrderState = "PROPOSED" | "SENT" | "ACCEPTED" | "REJECTED" | "PARTIAL" | "FILLED" | "CANCELLED";
export interface OrderUpdate { orderId: string; state: OrderState; filledQuantity: number; averagePrice: number | null; at: string; brokerMessage: string | null }
export interface Position { instrument: string; quantity: number; averagePrice: number; confirmedByBroker: boolean }
export interface PositionSnapshot { source: "PAPER" | "BROKER"; complete: boolean; observedAt: string; positions: Position[] }
export interface LedgerEntry { at: string; orderId: string; instrument: string; side: "BUY" | "SELL"; quantity: number; price: number; fees: number; simulated: boolean }
/** What the supervisor sees of each desk on his rounds. */
export interface Heartbeat { desk: DeskId; at: string; state: DeskRunState; detail: string }

// ----- The workers -----

export type DeskRunState = "IDLE" | "WORKING" | "BLOCKED" | "ERROR";
export interface DeskResult<Out> { state: DeskRunState; output: Out | null; reason: string }
export interface DeskContext { status: DashStatus; now: string; limits: RiskLimits | null; instrumentTickSize?: number | null; strategyApproval?: StrategyApproval }
/** One desk's job: one step of work on what it received. Implementations go in the other computer's workers. */
export interface DeskWorker<In, Out> { desk: DeskId; step(input: In, context: DeskContext): DeskResult<Out> }

/** What each desk receives and hands on (the types the workers must implement). */
export interface DeskContracts {
  chief: { in: { proposals: TradeProposal[]; votes: RoomVote[] }; out: RoomVote[] };
  supervisor: { in: Heartbeat[]; out: { pause: boolean; findings: string[] } };
  feed: { in: FeedSnapshot | null; out: FeedSnapshot };
  price: { in: FeedSnapshot; out: { candles: Candle[]; book: BookTop[] } };
  news: { in: NewsSnapshot; out: NewsGate };
  strategy: { in: { candles: Candle[]; book: BookTop[]; gate: NewsGate; expiresOn?: string | null }; out: Signal[] };
  backtest: { in: { bars: MinuteBar[]; pointValue: number; tickSize: number; costPerSide: number; slippageTicks: number; expiresOn: string | null; session: { lastEntry: string; flatBy: string }; candidate: BacktestCandidateId; risk: BacktestRiskLimits; completedHistoryBarCounts?: Readonly<Record<string, number>> }; out: BacktestSummary };
  risk: { in: { proposal: TradeProposal; positions: Position[]; lossToday: number; riskStateReconciled: boolean }; out: RiskDecision };
  positions: { in: PositionSnapshot; out: { positions: Position[]; reconciled: boolean } };
  execution: { in: { proposal: TradeProposal; decision: RoomDecision }; out: OrderRequest | null };
  orders: { in: OrderUpdate[]; out: OrderUpdate[] };
  ledger: { in: OrderUpdate[]; out: LedgerEntry[] };
}

/** A generic-cycle worker not connected yet; dedicated ingest/paper paths may exist separately. */
export function notImplemented<D extends DeskId>(desk: D): DeskWorker<DeskContracts[D]["in"], DeskContracts[D]["out"]> {
  return { desk, step: () => ({ state: "IDLE", output: null, reason: "Worker deste ciclo generico ainda nao conectado; consulte os status dos fluxos dedicados ProfitDLL e paper." }) };
}

/** First gate at the ProfitDLL boundary: source identity, timestamps and latency. */
export const feedWorker: DeskWorker<DeskContracts["feed"]["in"], DeskContracts["feed"]["out"]> = {
  desk: "feed",
  step: (snapshot, context) => {
    if (!snapshot || !Array.isArray(snapshot.provenance) || !Array.isArray(snapshot.candles) || !Array.isArray(snapshot.book) || !snapshot.provenance.length)
      return { state: "BLOCKED", output: null, reason: "Snapshot ProfitDLL ausente ou incompleto." };
    const now = Date.parse(context.now);
    const invalid = snapshot.provenance.some((source) => {
      if (!source || source.source !== "PROFITDLL_DAYTRADE" || source.simulated ||
        !Number.isFinite(source.delayMs) || source.delayMs < 0 || source.delayMs > 2_000 || typeof source.receivedAt !== "string") return true;
      const age = now - Date.parse(source.receivedAt);
      return !Number.isFinite(age) || age < -2_000 || age > 10_000;
    });
    if (invalid) return { state: "BLOCKED", output: null, reason: "Origem, latencia ou frescor do feed ProfitDLL invalido." };
    return { state: "WORKING", output: snapshot, reason: `Feed ProfitDLL recebido; ${snapshot.candles.length} candle(s) e ${snapshot.book.length} livro(s) encaminhados.` };
  },
};
/** The chief is the final deterministic gate; a missing or ambiguous fact means REJECT. */
export const chiefWorker: DeskWorker<DeskContracts["chief"]["in"], DeskContracts["chief"]["out"]> = {
  desk: "chief",
  step: (input, context) => {
    if (!input || !Array.isArray(input.proposals) || input.proposals.length === 0) {
      return { state: "IDLE", output: null, reason: "Nenhuma proposta recebida para a chefia." };
    }
    const incomingVotes = Array.isArray(input.votes) ? input.votes : [];
    const votesByDesk = new Map<DeskId, number>();
    for (const vote of incomingVotes) votesByDesk.set(vote.desk, (votesByDesk.get(vote.desk) ?? 0) + 1);
    const duplicateVotes = [...votesByDesk.values()].some((count) => count !== 1);
    const approval = context.strategyApproval;
    const decisions: RoomVote[] = input.proposals.map((proposal) => {
      const reasons: string[] = [];
      if (context.status.mode !== "SIMULATED") reasons.push("A chefia só pode aprovar o ciclo simulado atual.");
      if (context.status.market !== "OPEN") reasons.push("Sessão não confirmada como aberta.");
      if (context.status.data !== "REAL" || context.status.broker !== "ProfitDLL") reasons.push("Feed ProfitDLL real e fresco indisponível.");
      if (!context.status.instrument || context.status.instrument !== proposal.signal.instrument) reasons.push("A proposta não corresponde ao contrato ativo.");
      if (!context.limits || !Number.isFinite(context.limits.maxLossPerTrade) || context.limits.maxLossPerTrade <= 0 ||
        !Number.isFinite(context.limits.maxLossPerDay) || context.limits.maxLossPerDay <= 0 ||
        !Number.isInteger(context.limits.maxOpenPositions) || context.limits.maxOpenPositions < 0 ||
        !Number.isFinite(context.limits.maxExposure) || context.limits.maxExposure <= 0 ||
        !Number.isFinite(proposal.maxLoss) || proposal.maxLoss < 0 || proposal.maxLoss > context.limits.maxLossPerTrade ||
        !Number.isInteger(proposal.quantity) || proposal.quantity <= 0) reasons.push("Limites ou tamanho de risco inválidos ou incompletos.");
      if (!approval?.approved || !approval.id || !approval.version) reasons.push("Estratégia ainda não aprovada e versionada na configuração.");
      else if (proposal.signal.strategyVersion !== approval.version) reasons.push("A versão do sinal não corresponde à estratégia aprovada.");
      if (proposal.proposedBy !== "strategy") reasons.push("A proposta não veio do setor de estratégia.");
      if (duplicateVotes || incomingVotes.some((vote) => !ROOM.includes(vote.desk) || vote.desk === "chief")) reasons.push("Votos da sala ausentes, duplicados ou inválidos.");
      const riskVotes = incomingVotes.filter((vote) => vote.desk === "risk");
      if (riskVotes.length !== 1 || riskVotes[0].vote !== "APPROVE") reasons.push("Risco não aprovou a proposta de forma única.");
      if (incomingVotes.some((vote) => vote.vote === "REJECT")) reasons.push("Outro setor recusou a proposta.");
      return { desk: "chief", vote: reasons.length ? "REJECT" : "APPROVE", reason: reasons.join(" ") || "Estratégia, sessão, feed, contrato e risco conferidos." };
    });
    return {
      state: "WORKING",
      output: decisions,
      reason: decisions.every((vote) => vote.vote === "APPROVE")
        ? `${decisions.length} proposta(s) aprovadas pela chefia.`
        : `${decisions.filter((vote) => vote.vote === "REJECT").length} proposta(s) recusadas: ${decisions.filter((vote) => vote.vote === "REJECT").map((vote) => vote.reason).join(" ").slice(0, 240)}`,
    };
  },
};

/** Independent deterministic veto; it never creates a signal or an order. */
function riskReasons(
  proposal: TradeProposal, positions: Position[], lossToday: number,
  context: Pick<DeskContext, "status" | "limits"> & { riskStateReconciled: boolean },
): string[] {
  const reasons: string[] = [], limits = context.limits, { signal } = proposal;
  if (!limits) return ["Limites e especificações verificadas indisponíveis; risco bloqueado."];
  if (context.status.mode !== "SIMULATED" || context.status.market !== "OPEN" || context.status.data !== "REAL" ||
    context.status.broker !== "ProfitDLL" || context.status.instrument !== signal.instrument)
    reasons.push("Mercado, contrato ou feed ProfitDLL não está confirmado para o ciclo paper.");
  if (!context.riskStateReconciled) reasons.push("Posições e P&L diário ainda não foram reconciliados; risco bloqueado.");
  if (!Number.isFinite(lossToday)) reasons.push("P&L realizado do dia ausente ou inválido.");
  if (!Number.isFinite(limits.maxLossPerTrade) || limits.maxLossPerTrade <= 0 ||
    !Number.isFinite(limits.maxLossPerDay) || limits.maxLossPerDay <= 0 ||
    !Number.isFinite(limits.maxExposure) || limits.maxExposure <= 0 ||
    !Number.isInteger(limits.maxOpenPositions) || limits.maxOpenPositions < 1 ||
    !Number.isInteger(limits.maxContracts) || limits.maxContracts < 1 ||
    !Number.isFinite(limits.marginPerContract) || limits.marginPerContract <= 0 ||
    !Number.isFinite(limits.pointValue) || limits.pointValue <= 0 ||
    !Number.isFinite(limits.tickSize) || limits.tickSize <= 0 ||
    !Number.isFinite(limits.costPerSide) || limits.costPerSide < 0 ||
    !Number.isFinite(limits.slippageTicks) || limits.slippageTicks < 0)
    reasons.push("Limites, margem, tick, custos ou slippage incompletos/inválidos.");
  if (!Array.isArray(positions)) reasons.push("Estado de posições indisponível.");
  const open = Array.isArray(positions) ? positions.filter((position) => position.quantity !== 0) : [];
  if (open.some((position) => !Number.isInteger(position.quantity) || !Number.isFinite(position.averagePrice) || position.averagePrice <= 0 ||
    !/^[A-Z0-9$]{1,16}$/.test(position.instrument) || position.confirmedByBroker || position.instrument !== signal.instrument))
    reasons.push("Posição inválida, real ou de outro contrato; contas paper e da corretora não se misturam.");
  if (open.length + 1 > limits.maxOpenPositions) reasons.push("Limite de posições abertas seria excedido.");
  const openContracts = open.reduce((sum, position) => sum + Math.abs(position.quantity), 0);
  if (!Number.isInteger(proposal.quantity) || proposal.quantity < 1 || openContracts + proposal.quantity > limits.maxContracts)
    reasons.push("Limite de contratos seria excedido ou a quantidade é inválida.");
  if ((openContracts + Math.max(0, proposal.quantity)) * limits.marginPerContract > limits.maxExposure)
    reasons.push("Exposição estimada pela margem ultrapassaria o limite configurado.");
  if (!Number.isFinite(signal.entry) || signal.entry <= 0 || !Number.isFinite(signal.stop) || signal.stop <= 0 ||
    (signal.side === "BUY" ? signal.stop >= signal.entry : signal.stop <= signal.entry))
    reasons.push("Entrada ou stop ausente, inválido ou do lado errado.");
  const pointRisk = Math.abs(signal.entry - signal.stop) * limits.pointValue * proposal.quantity;
  const roundTripCosts = 2 * (limits.costPerSide + limits.tickSize * limits.pointValue * limits.slippageTicks) * proposal.quantity;
  const worstLoss = pointRisk + roundTripCosts;
  const tolerance = Math.max(0.01, Math.abs(worstLoss) * 1e-9);
  if (!Number.isFinite(proposal.maxLoss) || Math.abs(proposal.maxLoss - worstLoss) > tolerance || worstLoss > limits.maxLossPerTrade)
    reasons.push("Perda máxima declarada não confere com stop, contratos e custos, ou excede o limite por operação.");
  if (Number.isFinite(lossToday) && lossToday - worstLoss < -limits.maxLossPerDay)
    reasons.push("A perda potencial atingiria o limite diário.");
  return reasons;
}

export const riskWorker: DeskWorker<DeskContracts["risk"]["in"], DeskContracts["risk"]["out"]> = {
  desk: "risk",
  step: (input, context) => {
    if (!input || !Array.isArray(input.positions)) return { state: "BLOCKED", output: { approved: false, reasons: ["Proposta ou posições ausentes; risco bloqueado."] }, reason: "Dados de risco ausentes." };
    const reasons = riskReasons(input.proposal, input.positions, input.lossToday, { ...context, riskStateReconciled: input.riskStateReconciled });
    return { state: reasons.length ? "BLOCKED" : "WORKING", output: { approved: reasons.length === 0, reasons }, reason: reasons.join(" ") || "Stop, custos, margem, exposição, posição e limites conferidos." };
  },
};

/** Checks the market snapshot before it can reach news or the strategy sector. */
export const priceWorker: DeskWorker<DeskContracts["price"]["in"], DeskContracts["price"]["out"]> = {
  desk: "price",
  step: (input, context) => {
    if (!input || typeof input !== "object") return { state: "BLOCKED", output: null, reason: "Proveniência do feed ausente." };
    const snapshot = input;
    if (!Array.isArray(snapshot.provenance) || !Array.isArray(snapshot.candles) || !Array.isArray(snapshot.book))
      return { state: "BLOCKED", output: null, reason: "Snapshot do feed incompleto." };
    const candles = snapshot.candles;
    const tickSize = context.instrumentTickSize ?? context.limits?.tickSize;
    const nowMs = Date.parse(context.now);
    const validProvenance = (source: Provenance) => source.source === "PROFITDLL_DAYTRADE" &&
      Number.isFinite(Date.parse(source.receivedAt)) && Number.isFinite(nowMs) &&
      nowMs - Date.parse(source.receivedAt) >= 0 && nowMs - Date.parse(source.receivedAt) <= 10_000 &&
      Number.isFinite(source.delayMs) && source.delayMs >= 0 && source.delayMs <= 2_000 && !source.simulated;
    const validCandleProvenance = (source: CandleProvenance) => {
      if (!source || source.simulated || !Number.isFinite(Date.parse(source.receivedAt)) || !Number.isFinite(nowMs)) return false;
      if (source.persisted !== true) return source.delayMs !== null && validProvenance({ ...source, delayMs: source.delayMs });
      const age = nowMs - Date.parse(source.receivedAt);
      const trustedProvider = source.source === "PROFITDLL_DAYTRADE" || source.source === "PROFITDLL_HISTORY";
      return trustedProvider && age >= -2_000 && age <= 31 * 24 * 60 * 60_000 && source.delayMs === null;
    };
    if (snapshot.provenance.length === 0 || snapshot.provenance.some((source) => !source || !validProvenance(source)))
      return { state: "BLOCKED", output: null, reason: "Origem ou latência do feed fora do limite." };
    const invalid = candles.some((bar) => !bar || !bar.provenance || !/^[A-Z0-9$]{1,16}$/.test(bar.instrument) ||
      !Number.isFinite(Date.parse(bar.start)) || Date.parse(bar.start) % 60_000 !== 0 ||
      ![bar.open, bar.high, bar.low, bar.close].every((n) => Number.isFinite(n) && n > 0) ||
      bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high) ||
      !Number.isSafeInteger(bar.volume) || bar.volume < 1 || (tickSize !== null && tickSize !== undefined &&
        (!Number.isFinite(tickSize) || tickSize <= 0 || [bar.open, bar.high, bar.low, bar.close]
          .some((price) => Math.abs(price / tickSize - Math.round(price / tickSize)) > 1e-8))) || (bar.turnover != null &&
        (!Number.isFinite(bar.turnover) ||
          bar.turnover < bar.low * bar.volume - Math.max(0.01, bar.high * bar.volume * 1e-9) ||
          bar.turnover > bar.high * bar.volume + Math.max(0.01, bar.high * bar.volume * 1e-9))) ||
      !validCandleProvenance(bar.provenance));
    if (invalid || candles.length < 30) return { state: "BLOCKED", output: null, reason: invalid ? "Preço, volume ou origem do candle inválidos; entradas bloqueadas." : "Aguardando pelo menos 30 candles validados." };
    const sorted = [...candles].sort((a, b) => a.start.localeCompare(b.start));
    const day = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
    if (sorted.some((bar, index) => index > 0 && (bar.instrument !== sorted[0].instrument ||
      Date.parse(bar.start) <= Date.parse(sorted[index - 1].start) ||
      (day(bar.start) === day(sorted[index - 1].start) && Date.parse(bar.start) - Date.parse(sorted[index - 1].start) !== 60_000))))
      return { state: "BLOCKED", output: null, reason: "Instrumento misturado ou lacuna temporal; entradas bloqueadas." };
    const invalidBook = snapshot.book.some((item) => !item || !item.provenance || !/^[A-Z0-9$]{1,16}$/.test(item.instrument) ||
      item.instrument !== sorted[0]?.instrument ||
      !Number.isFinite(item.bid) || !Number.isFinite(item.ask) || item.bid <= 0 || item.ask < item.bid ||
      !Number.isInteger(item.bidSize) || item.bidSize < 0 || !Number.isInteger(item.askSize) || item.askSize < 0 ||
      !validProvenance(item.provenance));
    if (invalidBook) return { state: "BLOCKED", output: null, reason: "Livro de ofertas ou sua proveniência são inválidos." };
    return { state: "WORKING", output: { candles: sorted, book: snapshot.book }, reason: `${sorted.length} candles contínuos e validados.` };
  },
};

/** Explainable opening-range/VWAP/EMA research strategy. It emits observations, never orders. */
export const strategyWorker: DeskWorker<DeskContracts["strategy"]["in"], DeskContracts["strategy"]["out"]> = {
  desk: "strategy",
  step: (input, context) => {
    if (!input || !Array.isArray(input.candles) || !input.gate || !Array.isArray(input.gate.reasons) || input.gate.blockEntries || !Number.isFinite(input.gate.sizeFactor) || input.gate.sizeFactor <= 0)
      return { state: "BLOCKED", output: [], reason: input?.gate.reasons.join(" ") || "Estratégia sem dados ou entradas bloqueadas." };
    const latest = input.candles.at(-1);
    const nowMs = Date.parse(context.now);
    if (!latest || !latest.provenance || latest.provenance.source !== "PROFITDLL_DAYTRADE" || context.status.data !== "REAL" || context.status.broker !== "ProfitDLL" ||
      !Number.isFinite(nowMs) || Math.abs(nowMs - Date.parse(latest.provenance.receivedAt)) > 10_000 || latest.provenance.simulated)
      return { state: "BLOCKED", output: [], reason: "Candles ProfitDLL ausentes, simulados ou sem atualização recente." };
    const signal = analyzeOpeningRange(input.candles.map((bar) => ({
      bucket_at: bar.start, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      volume: bar.volume, turnover: bar.turnover ?? null,
    })), context.now, input.expiresOn ?? null, context.instrumentTickSize ?? context.limits?.tickSize);
    if (signal.state !== "WATCH_LONG" && signal.state !== "WATCH_SHORT")
      return { state: "WORKING", output: [], reason: signal.explanation };
    const first = input.candles[0];
    const stop = signal.state === "WATCH_LONG" ? signal.metrics.openingLow : signal.metrics.openingHigh;
    if (!stop || !first || !signal.metrics.openingHigh || !signal.metrics.openingLow)
      return { state: "BLOCKED", output: [], reason: "Faixa de abertura ou stop incompleto." };
    return { state: "WORKING", output: [{
      id: `${latest.instrument}:${latest.start}:opening-range-vwap-v1`, instrument: latest.instrument,
      side: signal.state === "WATCH_LONG" ? "BUY" : "SELL", strategyVersion: "opening-range-vwap-v1",
      entry: latest.close, stop, target: null, reason: signal.explanation, createdAt: context.now,
    }], reason: signal.explanation };
  },
};

/** News can veto or shrink a trade only; absent or stale coverage blocks the cycle. */
export const newsWorker: DeskWorker<DeskContracts["news"]["in"], DeskContracts["news"]["out"]> = {
  desk: "news",
  step: (input, context) => {
    const block = (reason: string) => ({ blockEntries: true, sizeFactor: 0, reasons: [reason] });
    if (!input || input.complete !== true || typeof input.source !== "string" || !input.source.trim() || !Array.isArray(input.events)) {
      const reasons = block("Cobertura de notícias/calendário ausente ou incompleta; entradas bloqueadas.");
      return { state: "BLOCKED", output: reasons, reason: reasons.reasons[0] };
    }
    const age = Date.parse(context.now) - Date.parse(input.refreshedAt);
    if (!Number.isFinite(age) || age < -2_000 || age > NEWS_SNAPSHOT_MAX_AGE_MS) {
      const reasons = block("Snapshot de notícias/calendário vencido ou com horário inválido; entradas bloqueadas.");
      return { state: "BLOCKED", output: reasons, reason: reasons.reasons[0] };
    }
    for (const event of input.events) {
      const provenance = event?.provenance;
      const receivedAge = provenance ? Date.parse(context.now) - Date.parse(provenance.receivedAt) : Infinity;
      if (!event || !["NEWS", "CALENDAR", "AUCTION", "HALT"].includes(event.kind) ||
        !["LOW", "MEDIUM", "HIGH"].includes(event.impact) || typeof event.title !== "string" || !event.title.trim() ||
        typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)) ||
        !provenance || typeof provenance.source !== "string" || !provenance.source.trim() ||
        typeof provenance.receivedAt !== "string" || provenance.simulated || !Number.isFinite(provenance.delayMs) ||
        provenance.delayMs < 0 || provenance.delayMs > NEWS_SNAPSHOT_MAX_AGE_MS || !Number.isFinite(receivedAge) || receivedAge < -2_000 || receivedAge > NEWS_SNAPSHOT_MAX_AGE_MS) {
        const reasons = block("Evento sem proveniência válida ou recente; entradas bloqueadas.");
        return { state: "BLOCKED", output: reasons, reason: reasons.reasons[0] };
      }
    }
    const high = input.events.filter((event) => event.kind === "HALT" || event.impact === "HIGH");
    if (high.length) {
      const reasons = block(`Evento(s) de alto impacto: ${high.map((event) => event.title).join(", ").slice(0, 180)}.`);
      return { state: "BLOCKED", output: reasons, reason: reasons.reasons[0] };
    }
    const medium = input.events.filter((event) => event.impact === "MEDIUM");
    const output = { blockEntries: false, sizeFactor: medium.length ? 0.5 : 1, reasons: medium.map((event) => `Exposição reduzida durante: ${event.title}.`) };
    return { state: "WORKING", output, reason: output.reasons.join(" ") || `Cobertura completa recebida de ${input.source}; sem evento de alto impacto.` };
  },
};

/** Runs a frozen candidate over complete source sessions; output is research-only by contract. */
export const backtestWorker: DeskWorker<DeskContracts["backtest"]["in"], DeskContracts["backtest"]["out"]> = {
  desk: "backtest",
  step: (input) => {
    if (!input || !Array.isArray(input.bars) || !Number.isFinite(input.pointValue) || input.pointValue <= 0 ||
      !Number.isFinite(input.tickSize) || input.tickSize <= 0 || !Number.isFinite(input.costPerSide) || input.costPerSide < 0 ||
      !Number.isFinite(input.slippageTicks) || input.slippageTicks < 0 || !input.session ||
      !/^\d{2}:\d{2}$/.test(input.session.lastEntry) || !/^\d{2}:\d{2}$/.test(input.session.flatBy) ||
      input.session.lastEntry >= input.session.flatBy ||
      !input.risk || !Number.isFinite(input.risk.maxLossPerTrade) || input.risk.maxLossPerTrade <= 0 ||
      !Number.isFinite(input.risk.maxLossPerDay) || input.risk.maxLossPerDay < input.risk.maxLossPerTrade ||
      !Number.isInteger(input.risk.maxTradesPerDay) || input.risk.maxTradesPerDay < 1 ||
      !BACKTEST_CANDIDATES.some((candidate) => candidate.id === input.candidate))
      return { state: "BLOCKED", output: null, reason: "Amostra, custos, limites de risco ou janela do backtest estão incompletos ou inválidos." };
    const report = backtestCandidate(input.bars, input.pointValue, input.tickSize, input.costPerSide,
      input.slippageTicks, input.expiresOn, input.session, input.candidate, input.risk, input.completedHistoryBarCounts);
    return { state: "WORKING", output: report, reason: `Candidato ${report.candidate}: ${report.trades} operação(ões), ${report.status}; pesquisa, sem aprovação automática.` };
  },
};

/** Formats an approved proposal for the paper cycle; it has no broker client or send capability. */
export const executionWorker: DeskWorker<DeskContracts["execution"]["in"], DeskContracts["execution"]["out"]> = {
  desk: "execution",
  step: (input, context) => {
    const proposal = input?.proposal;
    if (!input?.decision?.approved || context.status.mode !== "SIMULATED")
      return { state: "BLOCKED", output: null, reason: "Execucao permitida somente para proposta aprovada no ciclo paper." };
    if (!proposal || !proposal.signal || !Number.isInteger(proposal.quantity) || proposal.quantity < 1 ||
      !/^[A-Z0-9$]{1,16}$/.test(proposal.signal.instrument) || !Number.isFinite(proposal.signal.entry) || proposal.signal.entry <= 0 ||
      !Number.isFinite(proposal.signal.stop) || proposal.signal.stop <= 0 ||
      (proposal.signal.side === "BUY" ? proposal.signal.stop >= proposal.signal.entry : proposal.signal.stop <= proposal.signal.entry))
      return { state: "BLOCKED", output: null, reason: "Proposta paper incompleta ou sem stop valido; execucao recusada." };
    return {
      state: "WORKING",
      output: { proposalId: proposal.signal.id, instrument: proposal.signal.instrument, side: proposal.signal.side,
        quantity: proposal.quantity, type: "LIMIT", price: proposal.signal.entry, stop: proposal.signal.stop },
      reason: "Ordem limite formatada para simulacao; nenhum envio a corretora foi feito.",
    };
  },
};

/** Validates broker order history before a positions or ledger worker may consume it. */
export const ordersWorker: DeskWorker<DeskContracts["orders"]["in"], DeskContracts["orders"]["out"]> = {
  desk: "orders",
  step: (updates) => {
    if (!Array.isArray(updates)) return { state: "BLOCKED", output: null, reason: "Historico de ordens ausente." };
    const indexed = updates.map((update, index) => ({ update, index }));
    if (indexed.some(({ update }) => !update || typeof update.orderId !== "string" || !update.orderId.trim() ||
      !["PROPOSED", "SENT", "ACCEPTED", "REJECTED", "PARTIAL", "FILLED", "CANCELLED"].includes(update.state) ||
      !Number.isInteger(update.filledQuantity) || update.filledQuantity < 0 ||
      (update.state === "PARTIAL" && update.filledQuantity === 0) || (update.state === "FILLED" && update.filledQuantity === 0) ||
      (["PROPOSED", "SENT", "ACCEPTED"].includes(update.state) && update.filledQuantity > 0) ||
      (update.filledQuantity > 0 ? !Number.isFinite(update.averagePrice) || update.averagePrice! <= 0 : update.averagePrice !== null) ||
      !Number.isFinite(Date.parse(update.at)) || (update.brokerMessage !== null && typeof update.brokerMessage !== "string")))
      return { state: "BLOCKED", output: null, reason: "Atualizacao de ordem malformada; reconciliacao bloqueada." };
    indexed.sort((a, b) => Date.parse(a.update.at) - Date.parse(b.update.at) || a.index - b.index);
    const lastByOrder = new Map<string, OrderUpdate>();
    const allowed: Partial<Record<OrderState, readonly OrderState[]>> = {
      PROPOSED: ["SENT", "CANCELLED"], SENT: ["ACCEPTED", "REJECTED", "PARTIAL", "FILLED", "CANCELLED"],
      ACCEPTED: ["REJECTED", "PARTIAL", "FILLED", "CANCELLED"], PARTIAL: ["PARTIAL", "FILLED", "CANCELLED"],
      REJECTED: [], FILLED: [], CANCELLED: [],
    };
    for (const { update } of indexed) {
      const previous = lastByOrder.get(update.orderId);
      if (previous && (update.filledQuantity < previous.filledQuantity ||
        (update.state !== previous.state && !allowed[previous.state]?.includes(update.state))))
        return { state: "BLOCKED", output: null, reason: `Transicao de ordem invalida ou regressiva (${update.orderId}); reconciliacao bloqueada.` };
      lastByOrder.set(update.orderId, update);
    }
    return { state: "WORKING", output: indexed.map(({ update }) => update), reason: `${lastByOrder.size} ordem(ns) validadas por historico monotono.` };
  },
};

/** Validates a complete position snapshot and keeps paper state distinct from broker holdings. */
export const positionsWorker: DeskWorker<DeskContracts["positions"]["in"], DeskContracts["positions"]["out"]> = {
  desk: "positions",
  step: (input, context) => {
    const blocked = (reason: string) => ({ state: "BLOCKED" as const, output: { positions: [], reconciled: false }, reason });
    if (!input || !input.complete || !Array.isArray(input.positions) ||
      !["PAPER", "BROKER"].includes(input.source) || typeof input.observedAt !== "string")
      return blocked("Snapshot de posições ausente ou incompleto; reconciliação recusada.");
    const age = Date.parse(context.now) - Date.parse(input.observedAt);
    if (!Number.isFinite(age) || age < -2_000 || age > 10_000)
      return blocked("Snapshot de posições vencido ou com horário inválido.");
    const seen = new Set<string>();
    for (const position of input.positions) {
      if (!position || !/^[A-Z0-9$]{1,16}$/.test(position.instrument) || seen.has(position.instrument) ||
        !Number.isInteger(position.quantity) || position.quantity === 0 || !Number.isFinite(position.averagePrice) || position.averagePrice <= 0 ||
        (input.source === "BROKER") !== position.confirmedByBroker)
        return blocked("Posição inválida, duplicada ou misturada entre paper e corretora.");
      seen.add(position.instrument);
    }
    if ((input.source === "BROKER") !== (context.status.mode === "LIVE"))
      return blocked("Origem de posições incompatível com o modo atual.");
    return { state: "WORKING", output: { positions: input.positions, reconciled: true }, reason: `${input.positions.length} posição(ões) reconciliadas da fonte ${input.source}.` };
  },
};

/**
 * The supervisor can observe health and request a pause, but it cannot approve or send orders.
 * Explicit worker errors and an open session without a fresh live feed trigger the kill switch.
 * Configuration BLOCKED states are reported for review because they are expected during setup.
 */
export const supervisorWorker: DeskWorker<Heartbeat[], DeskContracts["supervisor"]["out"]> = {
  desk: "supervisor",
  step: (heartbeats, context) => {
    if (!Array.isArray(heartbeats)) return { state: "IDLE", output: null, reason: "Nenhum heartbeat recebido para supervisão." };
    const findings: string[] = [];
    const failures = heartbeats.filter((heartbeat) => heartbeat.state === "ERROR");
    for (const heartbeat of failures) findings.push(`${heartbeat.desk}: ${heartbeat.detail || "erro reportado pelo setor"}`);
    for (const heartbeat of heartbeats.filter((item) => item.state === "BLOCKED")) {
      findings.push(`${heartbeat.desk} bloqueado: ${heartbeat.detail || "requer revisão"}`);
    }
    const feedUnavailable = context.status.market === "OPEN" && context.status.data !== "REAL";
    if (feedUnavailable) findings.push("Mercado confirmado aberto sem cotação ProfitDLL fresca; novas entradas devem permanecer bloqueadas.");
    if (context.limits === null) findings.push("Limites de risco incompletos; operação permanece bloqueada.");
    const pause = failures.length > 0 || feedUnavailable;
    return {
      state: findings.length ? "BLOCKED" : "WORKING",
      output: { pause, findings },
      reason: findings.length ? findings.join(" ").slice(0, 300) : "Ronda concluída; sem falhas críticas nos setores observados.",
    };
  },
};

export const WORKERS: { [D in DeskId]: DeskWorker<DeskContracts[D]["in"], DeskContracts[D]["out"]> } = {
  chief: chiefWorker, supervisor: supervisorWorker, feed: feedWorker, price: priceWorker,
  news: newsWorker, strategy: strategyWorker, backtest: backtestWorker, risk: riskWorker,
  positions: positionsWorker, execution: executionWorker, orders: ordersWorker, ledger: notImplemented("ledger"),
};

/** The order in which a trade goes through the desks. */
export const PIPELINE: readonly DeskId[] = ["feed", "price", "news", "strategy", "chief", "risk", "execution", "orders", "positions", "ledger"];

// ----- Who may do what -----

export interface Powers { veto: boolean; sendOrders: boolean; pause: boolean; killSwitch: boolean }
const NONE: Powers = { veto: false, sendOrders: false, pause: false, killSwitch: false };
/** No sector has broker-routing capability in this version; paper execution is recorded separately. */
export const POWERS: Record<DeskId, Powers> = {
  chief: { veto: true, sendOrders: false, pause: true, killSwitch: true },
  supervisor: { veto: false, sendOrders: false, pause: true, killSwitch: true },
  feed: NONE, price: NONE, news: NONE, strategy: NONE, backtest: NONE,
  risk: { veto: true, sendOrders: false, pause: true, killSwitch: false },
  positions: { veto: true, sendOrders: false, pause: false, killSwitch: false },
  execution: { veto: false, sendOrders: false, pause: false, killSwitch: false },
  orders: NONE, ledger: NONE,
};

// ----- The analysis room (as the council rooms of the dividends office) -----

/** Who sits in the room for each proposal; the chief speaks last. */
export const ROOM: readonly DeskId[] = ["strategy", "risk", "execution", "chief"];
export interface RoomDecision { approved: boolean; reasons: string[] }

/**
 * The room's rule: a proposal goes on only if risk and the chief approve, nobody in the room rejects,
 * the data is trustworthy, the session is open and the trade has a stop and a bounded loss. Any doubt
 * is a no; not trading is also a result.
 */
export function reviewProposal(
  proposal: TradeProposal, votes: readonly RoomVote[],
  context: Pick<DeskContext, "status" | "limits"> & { positions: Position[]; lossToday: number; riskStateReconciled: boolean },
): RoomDecision {
  const reasons: string[] = [];
  const voteCounts = new Map<DeskId, number>();
  for (const vote of votes) {
    if (!ROOM.includes(vote.desk)) {
      reasons.push("Voto de uma mesa fora da sala de análise.");
      continue;
    }
    voteCounts.set(vote.desk, (voteCounts.get(vote.desk) ?? 0) + 1);
  }
  if ([...voteCounts.values()].some((count) => count !== 1)) reasons.push("Votos duplicados: proposta recusada.");
  const voteOf = (desk: DeskId) => {
    const matching = votes.filter((v) => v.desk === desk);
    return matching.length === 1 ? matching[0].vote : "ABSTAIN";
  };
  if (context.status.data === "NONE") reasons.push("Sem dado confiável.");
  if (context.status.market !== "OPEN") reasons.push("Mercado não confirmado como aberto.");
  reasons.push(...riskReasons(proposal, context.positions, context.lossToday, context));
  const { signal } = proposal;
  if (!Number.isInteger(proposal.quantity) || proposal.quantity <= 0) reasons.push("Quantidade inválida.");
  if (!/^[A-Z0-9$]{1,16}$/.test(signal.instrument) || !signal.strategyVersion.trim() ||
    !Number.isFinite(signal.entry) || signal.entry <= 0 || !Number.isFinite(signal.stop) || signal.stop <= 0 ||
    (signal.target !== null && (!Number.isFinite(signal.target) || signal.target <= 0)) || !Number.isFinite(Date.parse(signal.createdAt)))
    reasons.push("Sinal contém campos inválidos.");
  if (signal.side === "BUY" ? !(signal.stop < signal.entry) : !(signal.stop > signal.entry)) reasons.push("Stop ausente ou do lado errado.");
  if (signal.target !== null && (signal.side === "BUY" ? !(signal.target > signal.entry) : !(signal.target < signal.entry))) reasons.push("Alvo do lado errado do preço de entrada.");
  if (voteOf("risk") !== "APPROVE") reasons.push("Risco não aprovou.");
  if (voteOf("chief") !== "APPROVE") reasons.push("Chefe não aprovou.");
  for (const v of votes) if (ROOM.includes(v.desk) && v.vote === "REJECT" && v.desk !== "risk" && v.desk !== "chief") reasons.push(`${v.desk} recusou: ${v.reason}`);
  return { approved: reasons.length === 0, reasons };
}

/**
 * Hard gate for broker routing. This DASH release has no live-order path, so this stays false in
 * every mode until broker/account authorization, verified configuration, and a separately reviewed
 * OMS implementation are all present. Paper requests are recorded by their own simulator.
 */
export function maySend(decision: RoomDecision, status: DashStatus): { send: boolean; reason: string } {
  if (!decision.approved) return { send: false, reason: "Proposta não aprovada na sala de análise." };
  if (status.mode === "LIVE") return { send: false, reason: "Envio real do DASH ainda não foi homologado nem habilitado." };
  return { send: false, reason: "Modo simulado: a ordem é só registrada, nada é enviado." };
}
