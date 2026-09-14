import type { BrokerExecution, OrderSide } from "./broker";
import { decimal, isNonNegativeAmount, isPositiveAmount, isShareQuantity, money, timestamp } from "./money";
import type { TradeProposal } from "./risk";

export type OrderState = "CREATED" | "RISK_REVIEW" | "APPROVED" | "SUBMITTING" | "SUBMISSION_UNKNOWN"
  | "SUBMITTED" | "PARTIALLY_FILLED" | "FILLED" | "CANCEL_REQUESTED" | "CANCELLED" | "REJECTED" | "EXPIRED" | "ERROR";

const TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  CREATED: ["RISK_REVIEW", "CANCELLED"],
  RISK_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["SUBMITTING", "CANCELLED", "EXPIRED"],
  SUBMITTING: ["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "SUBMISSION_UNKNOWN", "ERROR"],
  SUBMISSION_UNKNOWN: ["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "CANCELLED", "EXPIRED"],
  SUBMITTED: ["PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "CANCELLED", "REJECTED", "EXPIRED", "ERROR"],
  PARTIALLY_FILLED: ["FILLED", "CANCEL_REQUESTED", "CANCELLED", "EXPIRED", "ERROR"],
  CANCEL_REQUESTED: ["PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "ERROR"],
  // A delayed execution event can complete an already-cancelled/expired remainder.
  CANCELLED: ["FILLED"], EXPIRED: ["FILLED"], REJECTED: [], FILLED: [],
  ERROR: ["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "REJECTED"],
};

export interface ManagedOrder {
  readonly id: string;
  readonly clientOrderId: string;
  readonly accountId: string;
  readonly brokerOrderId: string | null;
  readonly proposal: TradeProposal;
  readonly state: OrderState;
  readonly filledQuantity: number;
  readonly filledNotional: string;
  readonly fees: string;
  readonly executions: readonly BrokerExecution[];
  readonly updatedAt: string;
  readonly version: number;
  readonly lastError: string | null;
}

export interface LedgerAccount {
  readonly accountId: string;
  readonly agentId: string;
  readonly symbol: string;
  /** Internal agent cash after all recorded fills; not a broker cash declaration. */
  readonly cash: string;
  readonly quantity: number;
  /** Remaining cost basis includes buy fees. */
  readonly costBasis: string;
  readonly realizedPnl: string;
  readonly totalFees: string;
}

export interface ExecutionLedgerEntry {
  readonly executionId: string;
  readonly orderId: string;
  readonly brokerOrderId: string;
  readonly accountId: string;
  readonly agentId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly requestedPrice: string | null;
  readonly executedPrice: string;
  readonly fees: string;
  readonly slippage: string;
  readonly cashBefore: string;
  readonly cashAfter: string;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
  readonly costBasisBefore: string;
  readonly costBasisAfter: string;
  readonly realizedPnlDelta: string;
  readonly source: "BROKER_EXECUTION";
  readonly reason: string;
  readonly strategyVersion: string;
  readonly executedAt: string;
}

function assertIdentity(value: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || value !== value.trim()) throw new Error("INVALID_IDENTITY");
}

export function createOrder(proposal: TradeProposal, accountId: string, clientOrderId: string): ManagedOrder {
  [proposal.id, proposal.agentId, proposal.symbol, proposal.strategyVersion, accountId, clientOrderId].forEach(assertIdentity);
  timestamp(proposal.createdAt);
  if (!isShareQuantity(proposal.quantity) || !["BUY", "SELL"].includes(proposal.side)) throw new Error("INVALID_ORDER");
  return { id: proposal.id, clientOrderId, accountId, proposal: { ...proposal }, brokerOrderId: null,
    state: "CREATED", filledQuantity: 0, filledNotional: "0", fees: "0", executions: [],
    updatedAt: proposal.createdAt, version: 0, lastError: null };
}

/** Persist the result with a version compare-and-swap inside the same DB transaction. */
export function transitionOrder(order: ManagedOrder, next: OrderState, at: string): ManagedOrder {
  if (timestamp(at) < timestamp(order.updatedAt)) throw new Error("NON_MONOTONIC_ORDER_TIME");
  if (!TRANSITIONS[order.state]?.includes(next)) throw new Error(`INVALID_ORDER_TRANSITION: ${order.state} -> ${next}`);
  if (next === "FILLED" && order.filledQuantity !== order.proposal.quantity) throw new Error("FILL_EVIDENCE_REQUIRED");
  if (next === "PARTIALLY_FILLED" && !(order.filledQuantity > 0 && order.filledQuantity < order.proposal.quantity)) throw new Error("FILL_EVIDENCE_REQUIRED");
  if ((next === "SUBMITTED" || next === "CANCEL_REQUESTED") && !order.brokerOrderId) throw new Error("BROKER_ACK_REQUIRED");
  return { ...order, state: next, updatedAt: at, version: order.version + 1 };
}

/** Binding a broker acknowledgement must precede accounting any execution. */
export function acknowledgeSubmission(order: ManagedOrder, brokerOrderId: string, at: string): ManagedOrder {
  assertIdentity(brokerOrderId);
  if (order.brokerOrderId && order.brokerOrderId !== brokerOrderId) throw new Error("BROKER_ORDER_ID_MISMATCH");
  if (order.brokerOrderId === brokerOrderId && ["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "CANCELLED", "EXPIRED"].includes(order.state)) return order;
  return transitionOrder({ ...order, brokerOrderId, lastError: null }, "SUBMITTED", at);
}

/** Timeout ≠ rejection. There is deliberately no transition back to SUBMITTING. */
export function markSubmissionUnknown(order: ManagedOrder, at: string, reason = "BROKER_TIMEOUT"): ManagedOrder {
  return { ...transitionOrder(order, "SUBMISSION_UNKNOWN", at), lastError: reason };
}

function sameExecution(left: BrokerExecution, right: BrokerExecution): boolean {
  return left.executionId === right.executionId && left.brokerOrderId === right.brokerOrderId
    && left.accountId === right.accountId && left.symbol === right.symbol && left.side === right.side
    && left.quantity === right.quantity && decimal(left.price).eq(decimal(right.price))
    && decimal(left.fees).eq(decimal(right.fees)) && timestamp(left.executedAt) === timestamp(right.executedAt);
}

/**
 * Pure fill reducer. Persist fill unique(provider, account, executionId), order CAS,
 * ledger entry and balances atomically. In-memory state alone is not distributed idempotency.
 * Corrections/busts are separate events, never silent overwrites of an existing fill.
 */
export function applyExecution(order: ManagedOrder, account: LedgerAccount, fill: BrokerExecution, receivedAt: string): {
  order: ManagedOrder; account: LedgerAccount; entry: ExecutionLedgerEntry | null; duplicate: boolean; breaches: readonly string[];
} {
  [fill.executionId, fill.brokerOrderId, fill.accountId].forEach(assertIdentity);
  if (!isShareQuantity(fill.quantity) || !isPositiveAmount(fill.price) || !isNonNegativeAmount(fill.fees)) throw new Error("INVALID_EXECUTION");
  const executed = timestamp(fill.executedAt);
  const received = timestamp(receivedAt);
  if (executed > received || executed < timestamp(order.proposal.createdAt)) throw new Error("INVALID_EXECUTION_TIME");
  if (received < timestamp(order.updatedAt)) throw new Error("NON_MONOTONIC_ORDER_TIME");
  if (fill.accountId !== order.accountId || fill.accountId !== account.accountId
    || fill.brokerOrderId !== order.brokerOrderId || fill.symbol !== order.proposal.symbol
    || fill.symbol !== account.symbol || fill.side !== order.proposal.side || account.agentId !== order.proposal.agentId) throw new Error("EXECUTION_IDENTITY_MISMATCH");
  const existing = order.executions.find((execution) => execution.executionId === fill.executionId);
  if (existing) {
    if (!sameExecution(existing, fill)) throw new Error("EXECUTION_ID_CONFLICT");
    return { order, account, entry: null, duplicate: true, breaches: [] };
  }
  if (["CREATED", "RISK_REVIEW", "APPROVED", "REJECTED", "FILLED"].includes(order.state)) throw new Error("EXECUTION_STATE_MISMATCH");
  const filledQuantity = order.filledQuantity + fill.quantity;
  if (!isShareQuantity(filledQuantity) || filledQuantity > order.proposal.quantity) throw new Error("OVERFILL_RECONCILIATION_REQUIRED");
  if (!isShareQuantity(account.quantity, true) || !isNonNegativeAmount(account.costBasis)
    || !isNonNegativeAmount(account.totalFees) || (account.quantity === 0 && !decimal(account.costBasis).isZero())) throw new Error("INVALID_LEDGER_ACCOUNT");
  const cashBefore = decimal(account.cash);
  const basisBefore = decimal(account.costBasis);
  const fees = decimal(fill.fees);
  const value = decimal(fill.price).mul(fill.quantity);
  let quantity = account.quantity;
  let basis = basisBefore;
  let cash = cashBefore;
  let pnlDelta = decimal("0");
  if (fill.side === "BUY") {
    quantity += fill.quantity;
    if (!isShareQuantity(quantity)) throw new Error("INVALID_POSITION_QUANTITY");
    cash = cash.minus(value).minus(fees);
    basis = basis.plus(value).plus(fees);
  } else {
    if (fill.quantity > quantity) throw new Error("SHORT_FILL_RECONCILIATION_REQUIRED");
    const removedBasis = fill.quantity === quantity ? basis : decimal(money(basis.mul(fill.quantity).div(quantity)));
    quantity -= fill.quantity;
    cash = cash.plus(value).minus(fees);
    basis = basis.minus(removedBasis);
    pnlDelta = value.minus(fees).minus(removedBasis);
  }
  const nextAccount: LedgerAccount = { ...account, quantity, cash: money(cash), costBasis: money(basis),
    realizedPnl: money(decimal(account.realizedPnl).plus(pnlDelta)), totalFees: money(decimal(account.totalFees).plus(fees)) };
  // Cancelled/expired orders may have delayed fills executed before the terminal event.
  const state: OrderState = filledQuantity === order.proposal.quantity ? "FILLED"
    : ["CANCEL_REQUESTED", "CANCELLED", "EXPIRED"].includes(order.state) ? order.state : "PARTIALLY_FILLED";
  const nextOrder: ManagedOrder = { ...order, state, filledQuantity,
    filledNotional: money(decimal(order.filledNotional).plus(value)), fees: money(decimal(order.fees).plus(fees)),
    executions: [...order.executions, { ...fill }], updatedAt: receivedAt, version: order.version + 1 };
  const requested = order.proposal.limitPrice === null ? decimal(fill.price) : decimal(order.proposal.limitPrice);
  const priceDifference = fill.side === "BUY" ? decimal(fill.price).minus(requested) : requested.minus(decimal(fill.price));
  const breaches: string[] = [];
  if (cash.lt(0)) breaches.push("CASH_DEFICIT_AFTER_EXECUTION");
  if (order.proposal.limitPrice !== null && priceDifference.gt(0)) breaches.push("LIMIT_PRICE_VIOLATION");
  const entry: ExecutionLedgerEntry = { executionId: fill.executionId, orderId: order.id, brokerOrderId: fill.brokerOrderId,
    accountId: fill.accountId, agentId: account.agentId, symbol: fill.symbol, side: fill.side, quantity: fill.quantity,
    requestedPrice: order.proposal.limitPrice, executedPrice: money(fill.price), fees: money(fees),
    slippage: money(priceDifference.mul(fill.quantity)), cashBefore: money(cashBefore), cashAfter: nextAccount.cash,
    quantityBefore: account.quantity, quantityAfter: quantity, costBasisBefore: account.costBasis,
    costBasisAfter: nextAccount.costBasis, realizedPnlDelta: money(pnlDelta), source: "BROKER_EXECUTION",
    reason: order.proposal.reasoningSummary, strategyVersion: order.proposal.strategyVersion, executedAt: fill.executedAt };
  return { order: nextOrder, account: nextAccount, entry, duplicate: false, breaches };
}

export interface ReconciliationSnapshot {
  readonly accountId: string;
  readonly observedAt: string;
  /** Both snapshots must use the same cash definition and accounting cutoff. */
  readonly cash: string;
  readonly positions: readonly { symbol: string; quantity: number }[];
  readonly complete: boolean;
}

export interface ReconciliationResult {
  readonly matches: boolean;
  readonly discrepancies: readonly string[];
  readonly checkedAt: string;
}

/** Compares observations; never overwrites ledger balances to conceal a mismatch. */
export function reconcileAccount(local: ReconciliationSnapshot, broker: ReconciliationSnapshot, options: {
  now: string; maxAgeMs: number; cashTolerance?: string;
}): ReconciliationResult {
  const discrepancies: string[] = [];
  try {
    const now = timestamp(options.now);
    if (!isShareQuantity(options.maxAgeMs)) throw new Error("INVALID_MAX_AGE");
    const tolerance = options.cashTolerance ?? "0";
    if (!isNonNegativeAmount(tolerance)) throw new Error("INVALID_TOLERANCE");
    if (!local.accountId || local.accountId !== broker.accountId) discrepancies.push("ACCOUNT_MISMATCH");
    if (local.complete !== true || broker.complete !== true) discrepancies.push("INCOMPLETE_SNAPSHOT");
    for (const [name, snapshot] of [["LOCAL", local], ["BROKER", broker]] as const) {
      const age = now - timestamp(snapshot.observedAt);
      if (age < 0 || age > options.maxAgeMs) discrepancies.push(`${name}_SNAPSHOT_TIME_INVALID`);
    }
    if (decimal(local.cash).minus(decimal(broker.cash)).abs().gt(decimal(tolerance))) discrepancies.push("CASH_MISMATCH");
    const positions = (snapshot: ReconciliationSnapshot): Map<string, number> => {
      const result = new Map<string, number>();
      for (const position of snapshot.positions) {
        if (!/^[A-Z0-9]{4,16}$/.test(position.symbol) || !isShareQuantity(position.quantity, true) || result.has(position.symbol)) throw new Error("INVALID_POSITION_SNAPSHOT");
        result.set(position.symbol, position.quantity);
      }
      return result;
    };
    const localPositions = positions(local), brokerPositions = positions(broker);
    for (const symbol of [...new Set([...localPositions.keys(), ...brokerPositions.keys()])].sort()) {
      if ((localPositions.get(symbol) ?? 0) !== (brokerPositions.get(symbol) ?? 0)) discrepancies.push(`POSITION_MISMATCH:${symbol}`);
    }
  } catch { discrepancies.push("INVALID_RECONCILIATION_INPUT"); }
  return { matches: discrepancies.length === 0, discrepancies, checkedAt: options.now };
}
