import type { DashStatus, DeskId } from "./desks";
import { maySend, POWERS, reviewProposal, ROOM, WORKERS, type DeskContext, type DeskResult, type FeedSnapshot, type NewsSnapshot, type OrderRequest, type RiskLimits, type RoomVote, type StrategyApproval, type TradeProposal } from "./agents";

/**
 * One cycle of the DASH desk, in the order of the flow (agents.ts PIPELINE): data, news, strategy,
 * the analysis room, risk, execution. Workers are passed in (by default the idle ones), so the cycle
 * is the same in tests and in simulation. It never talks to a broker: `maySend` keeps the send list
 * empty in every mode, and approved requests are only recorded as paper simulations. Live routing
 * requires a separately reviewed and authorized implementation; no gateway client sends these
 * requests today. Everything that happens is in `journal`. Pure.
 */
export interface CycleInput {
  status: DashStatus;
  limits: RiskLimits | null;
  now: string;
  /** Kill switch (DASH's own or the global one): nothing new while it is on. */
  halted: boolean;
  feedSnapshot: FeedSnapshot | null;
  news: NewsSnapshot;
  positions: Parameters<(typeof WORKERS)["risk"]["step"]>[0]["positions"];
  lossToday: number;
  /** True only when positions and realized P&L came from an authoritative reconciliation. */
  riskStateReconciled: boolean;
  /** Money per point of the contract (config); null while unverified, and then no trade passes the room. */
  pointValue: number | null;
  /** Only a configured, explicitly approved strategy version may be considered by the chief. */
  strategyApproval?: StrategyApproval;
}
export interface JournalEntry { at: string; desk: DeskId | "cycle"; state: DeskResult<unknown>["state"] | "SKIPPED"; message: string }
export interface CycleResult { journal: JournalEntry[]; proposals: TradeProposal[]; votes: RoomVote[]; send: OrderRequest[]; simulated: OrderRequest[] }

/** Execution may format an approved proposal, but it cannot change its economics or identity. */
function orderMatchesProposal(order: OrderRequest, proposal: TradeProposal): boolean {
  return order.proposalId === proposal.signal.id &&
    order.instrument === proposal.signal.instrument &&
    order.side === proposal.signal.side &&
    order.quantity === proposal.quantity &&
    Number.isFinite(order.stop) && order.stop === proposal.signal.stop &&
    (order.type === "LIMIT"
      ? typeof order.price === "number" && Number.isFinite(order.price) && order.price > 0
      : order.type === "MARKET" && order.price === null);
}

export function runCycle(input: CycleInput, workers = WORKERS): CycleResult {
  const journal: JournalEntry[] = [], at = input.now;
  const context: DeskContext = { status: input.status, now: input.now, limits: input.limits, strategyApproval: input.strategyApproval };
  const log = (desk: JournalEntry["desk"], state: JournalEntry["state"], message: string) => journal.push({ at, desk, state, message });
  const result: CycleResult = { journal, proposals: [], votes: [], send: [], simulated: [] };
  const step = <D extends DeskId>(desk: D, input_: Parameters<(typeof workers)[D]["step"]>[0], keepBlockedOutput = false) => {
    const r = (workers[desk].step as (i: typeof input_, c: DeskContext) => DeskResult<unknown>)(input_, context);
    log(desk, r.state, r.reason);
    return r.state === "WORKING" || (keepBlockedOutput && r.state === "BLOCKED") ? r.output : null;
  };

  if (input.halted) { log("cycle", "SKIPPED", "Kill switch ativo: nenhuma entrada nova."); return result; }

  const sources = step("feed", input.feedSnapshot) as Parameters<(typeof workers)["price"]["step"]>[0] | null;
  if (!sources) { log("cycle", "SKIPPED", "Sem dado confiável: a mesa não opera."); return result; }
  const market = step("price", sources) as { candles: never[]; book: never[] } | null;
  if (!market) { log("cycle", "SKIPPED", "Sem preço e volume válidos."); return result; }
  const gate = (step("news", input.news, true) as { blockEntries: boolean; sizeFactor: number; reasons: string[] } | null) ?? { blockEntries: true, sizeFactor: 0, reasons: ["Notícias indisponíveis: entradas bloqueadas."] };
  if (gate.blockEntries) { log("cycle", "SKIPPED", gate.reasons.join(" ") || "Notícias bloquearam entradas."); return result; }
  const signals = (step("strategy", { candles: market.candles, book: market.book, gate }) as TradeProposal["signal"][] | null) ?? [];

  for (const signal of signals) {
    // A signal becomes a proposal sized by the news gate; the room votes on it, the chief last.
    // Its loss if the stop is hit: points to the stop × money per point × contracts (unknown: infinite, so it fails).
    const factor = Number.isFinite(gate.sizeFactor) ? Math.min(1, Math.max(0, gate.sizeFactor)) : 0;
    const quantity = input.limits ? Math.min(input.limits.maxContracts, Math.floor(factor * input.limits.maxContracts)) : 0;
    const maxLoss = input.pointValue === null || !input.limits ? Infinity
      : (Math.abs(signal.entry - signal.stop) * input.limits.pointValue +
        2 * (input.limits.costPerSide + input.limits.tickSize * input.limits.pointValue * input.limits.slippageTicks)) * quantity;
    const proposal: TradeProposal = { signal, quantity, maxLoss, proposedBy: "strategy" };
    result.proposals.push(proposal);
    const risk = step("risk", { proposal, positions: input.positions, lossToday: input.lossToday, riskStateReconciled: input.riskStateReconciled }, true) as { approved: boolean; reasons: string[] } | null;
    const votes: RoomVote[] = [
      ...ROOM.filter((d) => d !== "chief" && d !== "risk").map((desk): RoomVote => ({ desk, vote: "ABSTAIN", reason: "sem voto" })),
      { desk: "risk", vote: risk?.approved ? "APPROVE" : "REJECT", reason: risk?.reasons.join(" ") ?? "Risco não respondeu." },
    ];
    result.votes.push(...votes);
    const chief = (step("chief", { proposals: [proposal], votes }) as RoomVote[] | null) ?? [];
    const chiefVotes = chief.filter((v) => v.desk === "chief");
    result.votes.push(...chiefVotes);
    const decision = reviewProposal(proposal, [...votes, ...chiefVotes], { ...context, positions: input.positions, lossToday: input.lossToday, riskStateReconciled: input.riskStateReconciled });
    log("chief", decision.approved ? "WORKING" : "BLOCKED", decision.approved ? "Aprovada na sala de análise." : decision.reasons.join(" "));
    if (!decision.approved) continue;
    const order = step("execution", { proposal, decision }) as OrderRequest | null;
    if (!order) continue;
    if (!orderMatchesProposal(order, proposal)) {
      log("execution", "BLOCKED", "Ordem recusada: não corresponde à proposta aprovada.");
      continue;
    }
    const verdict = maySend(decision, input.status);
    if (input.status.mode === "LIVE") {
      log("execution", "BLOCKED", verdict.reason);
      continue;
    }
    log("execution", verdict.send ? "WORKING" : "BLOCKED", verdict.reason);
    // Only the execution desk may send (POWERS), and only what maySend allows; the rest is recorded as simulated.
    if (verdict.send && POWERS.execution.sendOrders) result.send.push(order); else result.simulated.push(order);
  }
  return result;
}
