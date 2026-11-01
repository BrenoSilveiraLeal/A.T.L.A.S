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
 * Types and pure rules only (no I/O, no broker, no timers). Every worker starts as `notImplemented`,
 * which answers IDLE with the reason, never invented data. The rules that guard money — who may
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
export interface DeskContext { status: DashStatus; now: string; limits: RiskLimits | null }
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
export const WORKERS: { [D in DeskId]: DeskWorker<DeskContracts[D]["in"], DeskContracts[D]["out"]> } = {
  chief: notImplemented("chief"), supervisor: notImplemented("supervisor"), feed: notImplemented("feed"), price: notImplemented("price"),
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
  const voteOf = (desk: DeskId) => votes.find((v) => v.desk === desk)?.vote ?? "ABSTAIN";
  if (context.status.data === "NONE") reasons.push("Sem dado confiável.");
  if (context.status.market !== "OPEN") reasons.push("Mercado não confirmado como aberto.");
  if (!context.limits) reasons.push("Limites de risco não definidos.");
  else if (proposal.maxLoss > context.limits.maxLossPerTrade) reasons.push("Perda máxima acima do limite por operação.");
  const { signal } = proposal;
  if (!(proposal.quantity > 0)) reasons.push("Quantidade inválida.");
  if (signal.side === "BUY" ? !(signal.stop < signal.entry) : !(signal.stop > signal.entry)) reasons.push("Stop ausente ou do lado errado.");
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
  if (status.mode !== "LIVE") return { send: false, reason: "Modo simulado: a ordem é só registrada, nada é enviado." };
  if (!status.broker) return { send: false, reason: "Nenhuma corretora conectada." };
  return { send: true, reason: "Aprovada e em modo real." };
}
