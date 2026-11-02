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
 * Types and pure rules only (no I/O, no broker, no timers). Unimplemented workers answer IDLE with
 * the reason, never invented data; the supervisor worker is implemented as an observation-only guard.
 * The rules that guard money — who may
 * send an order and when — are implemented here and tested (tests/daytrade-agents.test.ts), so a
 * worker written later cannot skip them.
 */
import type { DeskId, DashStatus } from "./desks";

// ----- Messages between the desks -----

/** Where a piece of data came from and how old it is; data without this is not used. */
export interface Provenance { source: string; receivedAt: string; delayMs: number; simulated: boolean }
export interface Candle { instrument: string; start: string; open: number; high: number; low: number; close: number; volume: number; provenance: Provenance }
export interface BookTop { instrument: string; bid: number; ask: number; bidSize: number; askSize: number; provenance: Provenance }
export interface MarketEvent { kind: "NEWS" | "CALENDAR" | "AUCTION" | "HALT"; title: string; at: string; impact: "LOW" | "MEDIUM" | "HIGH"; provenance: Provenance }
/** The news desk can only hold back or shrink entries, never open one. */
export interface NewsGate { blockEntries: boolean; sizeFactor: number; reasons: string[] }
export interface Signal {
  id: string; instrument: string; side: "BUY" | "SELL"; strategyVersion: string;
  entry: number; stop: number; target: number | null; reason: string; createdAt: string;
}
export interface BacktestReport { strategyVersion: string; trades: number; winRate: number; maxDrawdown: number; approved: boolean; notes: string }
/** A signal turned into a concrete trade, as it goes into the analysis room. */
export interface TradeProposal { signal: Signal; quantity: number; maxLoss: number; proposedBy: DeskId }
export type Vote = "APPROVE" | "REJECT" | "ABSTAIN";
export interface RoomVote { desk: DeskId; vote: Vote; reason: string }
export interface RiskLimits { maxLossPerTrade: number; maxLossPerDay: number; maxOpenPositions: number; maxExposure: number }
export interface RiskDecision { approved: boolean; reasons: string[] }
export interface StrategyApproval { id: string | null; version: string | null; approved: boolean }
export interface OrderRequest { proposalId: string; instrument: string; side: "BUY" | "SELL"; quantity: number; type: "LIMIT" | "MARKET"; price: number | null; stop: number }
export type OrderState = "PROPOSED" | "SENT" | "ACCEPTED" | "REJECTED" | "PARTIAL" | "FILLED" | "CANCELLED";
export interface OrderUpdate { orderId: string; state: OrderState; filledQuantity: number; averagePrice: number | null; at: string; brokerMessage: string | null }
export interface Position { instrument: string; quantity: number; averagePrice: number; confirmedByBroker: boolean }
export interface LedgerEntry { at: string; orderId: string; instrument: string; side: "BUY" | "SELL"; quantity: number; price: number; fees: number; simulated: boolean }
/** What the supervisor sees of each desk on his rounds. */
export interface Heartbeat { desk: DeskId; at: string; state: DeskRunState; detail: string }

// ----- The workers -----

export type DeskRunState = "IDLE" | "WORKING" | "BLOCKED" | "ERROR";
export interface DeskResult<Out> { state: DeskRunState; output: Out | null; reason: string }
export interface DeskContext { status: DashStatus; now: string; limits: RiskLimits | null; strategyApproval?: StrategyApproval }
/** One desk's job: one step of work on what it received. Implementations go in the other computer's workers. */
export interface DeskWorker<In, Out> { desk: DeskId; step(input: In, context: DeskContext): DeskResult<Out> }

/** What each desk receives and hands on (the types the workers must implement). */
export interface DeskContracts {
  chief: { in: { proposals: TradeProposal[]; votes: RoomVote[] }; out: RoomVote[] };
  supervisor: { in: Heartbeat[]; out: { pause: boolean; findings: string[] } };
  feed: { in: void; out: Provenance[] };
  price: { in: Provenance[]; out: { candles: Candle[]; book: BookTop[] } };
  news: { in: MarketEvent[]; out: NewsGate };
  strategy: { in: { candles: Candle[]; book: BookTop[]; gate: NewsGate }; out: Signal[] };
  backtest: { in: { strategyVersion: string }; out: BacktestReport };
  risk: { in: { proposal: TradeProposal; positions: Position[]; lossToday: number }; out: RiskDecision };
  positions: { in: { updates: OrderUpdate[] }; out: { positions: Position[]; reconciled: boolean } };
  execution: { in: { proposal: TradeProposal; decision: RoomDecision }; out: OrderRequest | null };
  orders: { in: OrderUpdate[]; out: OrderUpdate[] };
  ledger: { in: OrderUpdate[]; out: LedgerEntry[] };
}

/** A worker that does nothing yet and says so (every desk starts like this). */
export function notImplemented<D extends DeskId>(desk: D): DeskWorker<DeskContracts[D]["in"], DeskContracts[D]["out"]> {
  return { desk, step: () => ({ state: "IDLE", output: null, reason: "Ainda não implementado: o DASH está em modo simulado, sem feed e sem corretora." }) };
}
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
  chief: chiefWorker, supervisor: supervisorWorker, feed: notImplemented("feed"), price: notImplemented("price"),
  news: notImplemented("news"), strategy: notImplemented("strategy"), backtest: notImplemented("backtest"), risk: notImplemented("risk"),
  positions: notImplemented("positions"), execution: notImplemented("execution"), orders: notImplemented("orders"), ledger: notImplemented("ledger"),
};

/** The order in which a trade goes through the desks. */
export const PIPELINE: readonly DeskId[] = ["feed", "price", "news", "strategy", "chief", "risk", "execution", "orders", "positions", "ledger"];

// ----- Who may do what -----

export interface Powers { veto: boolean; sendOrders: boolean; pause: boolean; killSwitch: boolean }
const NONE: Powers = { veto: false, sendOrders: false, pause: false, killSwitch: false };
/** Only execution sends orders; only risk (and the chief, in the room) can veto; supervisor and chief can stop. */
export const POWERS: Record<DeskId, Powers> = {
  chief: { veto: true, sendOrders: false, pause: true, killSwitch: true },
  supervisor: { veto: false, sendOrders: false, pause: true, killSwitch: true },
  feed: NONE, price: NONE, news: NONE, strategy: NONE, backtest: NONE,
  risk: { veto: true, sendOrders: false, pause: true, killSwitch: false },
  positions: { veto: true, sendOrders: false, pause: false, killSwitch: false },
  execution: { veto: false, sendOrders: true, pause: false, killSwitch: false },
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
export function reviewProposal(proposal: TradeProposal, votes: readonly RoomVote[], context: Pick<DeskContext, "status" | "limits">): RoomDecision {
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
  if (!context.limits) reasons.push("Limites de risco não definidos.");
  else if (!Number.isFinite(context.limits.maxLossPerTrade) || context.limits.maxLossPerTrade <= 0 ||
    !Number.isFinite(context.limits.maxLossPerDay) || context.limits.maxLossPerDay <= 0 ||
    !Number.isInteger(context.limits.maxOpenPositions) || context.limits.maxOpenPositions < 0 ||
    !Number.isFinite(context.limits.maxExposure) || context.limits.maxExposure <= 0) reasons.push("Limites de risco inválidos.");
  else if (!Number.isFinite(proposal.maxLoss) || proposal.maxLoss < 0 || proposal.maxLoss > context.limits.maxLossPerTrade) reasons.push("Perda máxima acima do limite por operação ou inválida.");
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
 * Whether execution may send an order at all: the room approved it, and only in live mode. In
 * simulated mode nothing leaves the office (the order is only recorded as simulated).
 */
export function maySend(decision: RoomDecision, status: DashStatus): { send: boolean; reason: string } {
  if (!decision.approved) return { send: false, reason: "Proposta não aprovada na sala de análise." };
  if (status.mode === "LIVE") return { send: false, reason: "Envio real do DASH ainda não foi homologado nem habilitado." };
  return { send: false, reason: "Modo simulado: a ordem é só registrada, nada é enviado." };
}
