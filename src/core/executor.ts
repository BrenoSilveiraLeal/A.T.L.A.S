import type {
  BrokerAccount, BrokerCapabilities, BrokerCash, BrokerExecution, BrokerOrder,
  BrokerOrderRequest, BrokerPosition, BrokerProvider,
} from "./broker";
import { decimal, isShareQuantity, timestamp } from "./money";
import {
  acknowledgeSubmission, applyExecution, markSubmissionUnknown,
  reconcileAccount, transitionOrder,
} from "./oms";
import type {
  ExecutionLedgerEntry, LedgerAccount, ManagedOrder, ReconciliationResult,
  ReconciliationSnapshot,
} from "./oms";
import { evaluateTrade } from "./risk";
import type { RiskContext, RiskResult, TradeProposal } from "./risk";

export interface ExecutorCommand {
  readonly id: string;
  readonly kind: "SUBMIT" | "CANCEL" | "MODIFY";
  readonly providerId: string;
  readonly accountId: string;
  readonly idempotencyKey: string;
  readonly order: ManagedOrder;
  readonly timeInForce: "DAY" | "GTC";
  readonly replacementProposal?: TradeProposal;
  /** Trusted server evidence. Never accept this context from an agent or gateway. */
  readonly riskContext: RiskContext;
}

export interface ClaimedExecutorCommand {
  readonly command: ExecutorCommand;
  readonly claimToken: string;
  readonly claimedAt: string;
}

export interface CommandCompletion {
  readonly commandId: string;
  readonly claimToken: string;
  readonly expectedOrderVersion: number;
  readonly status: "ACKNOWLEDGED" | "UNKNOWN" | "REJECTED";
  readonly order: ManagedOrder;
  readonly brokerOrder: BrokerOrder | null;
  readonly reconciliationRequired: boolean;
  readonly reasons: readonly string[];
  readonly at: string;
}

export interface ExecutionState {
  readonly order: ManagedOrder;
  readonly account: LedgerAccount;
  readonly ledgerVersion: number;
}

export interface ExecutionCommit {
  readonly providerId: string;
  readonly expectedOrderVersion: number;
  readonly expectedLedgerVersion: number;
  readonly order: ManagedOrder;
  readonly account: LedgerAccount;
  readonly execution: BrokerExecution;
  readonly entry: ExecutionLedgerEntry;
  readonly breaches: readonly string[];
  readonly at: string;
}

/**
 * Production implementations MUST use durable transactions, not process memory.
 * claim locks order + treasury, verifies approval against immutable command terms,
 * reserves funds/stock, and commits DISPATCHED + unique token BEFORE returning.
 * Only PENDING may be claimed; expired/crashed claims become UNKNOWN, never PENDING.
 * Serialise commands per order; enforce unique(provider, account, idempotencyKey).
 * complete atomically CASes token/order version, appends audit, and retains all
 * reservations while UNKNOWN or reconciliationRequired. A late ack CAS conflict
 * must leave the command quarantined for recovery, never make it retryable.
 * commitExecution atomically CASes ledger/order, deduplicates the immutable fill
 * by (provider, account, executionId), writes ledger/balances/audit, and activates
 * reconciliation/kill controls on breaches. Conflicting fill payloads must fail.
 */
export interface ExecutorStore {
  claim(input: {
    commandId: string; providerId: string; executorId: string; at: string;
  }): Promise<ClaimedExecutorCommand | null>;
  /** Read current order and the original immutable command, including UNKNOWN. */
  getClaim(commandId: string): Promise<ClaimedExecutorCommand | null>;
  complete(completion: CommandCompletion): Promise<boolean>;
  getExecutionState(input: {
    providerId: string; accountId: string; brokerOrderId: string;
  }): Promise<ExecutionState | null>;
  commitExecution(commit: ExecutionCommit): Promise<"COMMITTED" | "DUPLICATE" | "CONFLICT">;
}

function identity(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value;
}

function proposalFor(command: ExecutorCommand): TradeProposal {
  return command.kind === "MODIFY" && command.replacementProposal
    ? command.replacementProposal : command.order.proposal;
}

export function executorOrderRequest(command: ExecutorCommand): BrokerOrderRequest {
  const proposal = proposalFor(command);
  return {
    clientOrderId: command.order.clientOrderId,
    accountId: command.accountId,
    symbol: proposal.symbol, side: proposal.side, quantity: proposal.quantity,
    kind: proposal.kind, limitPrice: proposal.limitPrice, stopPrice: proposal.stopPrice,
    timeInForce: command.timeInForce,
  };
}

/** Defence in depth after the database claim; this does not replace its lock/reservation. */
export function validateExecutorCommand(
  command: ExecutorCommand, capabilities: BrokerCapabilities, now: string,
): { approved: boolean; reasons: readonly string[]; risk: RiskResult | null } {
  const reasons: string[] = [];
  let risk: RiskResult | null = null;
  try {
    timestamp(now);
    const order = command.order;
    if (![command.id, command.providerId, command.accountId, command.idempotencyKey,
      order.id, order.clientOrderId].every(identity)) reasons.push("INVALID_COMMAND_IDENTITY");
    if (command.providerId !== capabilities.providerId) reasons.push("PROVIDER_MISMATCH");
    if (command.accountId !== order.accountId || command.riskContext.accountId !== order.accountId)
      reasons.push("ACCOUNT_MISMATCH");
    if (!isShareQuantity(order.version, true) || !isShareQuantity(order.filledQuantity, true))
      reasons.push("INVALID_ORDER_VERSION_OR_FILL");
    if (command.timeInForce !== "DAY" && command.timeInForce !== "GTC") reasons.push("INVALID_TIME_IN_FORCE");
    if (!command.riskContext.ownerMfaVerified) reasons.push("MFA_REQUIRED");
    if (!command.riskContext.capabilitiesVerified || !capabilities.cashEquities ||
      !capabilities.completeAccountReconciliation || !capabilities.clientOrderLookup)
      reasons.push("GATEWAY_CAPABILITIES_REQUIRED");
    if (timestamp(now) < timestamp(order.updatedAt)) reasons.push("NON_MONOTONIC_ORDER_TIME");
    if (command.kind === "SUBMIT") {
      if (order.state !== "APPROVED" || order.brokerOrderId !== null || order.filledQuantity !== 0)
        reasons.push("ORDER_NOT_APPROVED_FOR_SUBMISSION");
      if (command.idempotencyKey !== order.clientOrderId) reasons.push("SUBMISSION_IDEMPOTENCY_MISMATCH");
      if (command.replacementProposal) reasons.push("UNEXPECTED_REPLACEMENT_PROPOSAL");
    } else if (command.kind === "MODIFY" || command.kind === "CANCEL") {
      if (!identity(order.brokerOrderId) || !["SUBMITTED", "PARTIALLY_FILLED"].includes(order.state))
        reasons.push("ORDER_NOT_OPEN");
      if (command.kind === "MODIFY") {
        const replacement = command.replacementProposal;
        if (!replacement) reasons.push("MODIFICATION_PROPOSAL_REQUIRED");
        else {
          for (const key of ["id", "agentId", "symbol", "side", "kind", "strategyVersion"] as const)
            if (replacement[key] !== order.proposal[key]) reasons.push("MODIFICATION_IDENTITY_MISMATCH");
          if (replacement.quantity <= order.filledQuantity) reasons.push("MODIFICATION_BELOW_EXECUTED_QUANTITY");
        }
      } else if (command.replacementProposal) reasons.push("UNEXPECTED_REPLACEMENT_PROPOSAL");
    } else reasons.push("INVALID_COMMAND_KIND");
    if (command.kind !== "CANCEL") {
      const proposal = proposalFor(command);
      if (!capabilities.orderKinds.includes(proposal.kind)) reasons.push("GATEWAY_ORDER_KIND_UNSUPPORTED");
      if (command.timeInForce === "GTC" && !capabilities.overnight) reasons.push("GATEWAY_OVERNIGHT_UNSUPPORTED");
      risk = evaluateTrade(proposal, { ...command.riskContext, now });
      reasons.push(...risk.reasons);
    }
  } catch { reasons.push("INVALID_COMMAND_INPUT"); }
  return { approved: reasons.length === 0, reasons: [...new Set(reasons)], risk };
}

function equalPrice(left: string | null, right: string | null): boolean {
  return left === null || right === null ? left === right : decimal(left).eq(decimal(right));
}

function equalRequest(left: BrokerOrderRequest, right: BrokerOrderRequest): boolean {
  return left.clientOrderId === right.clientOrderId && left.accountId === right.accountId &&
    left.symbol === right.symbol && left.side === right.side && left.quantity === right.quantity &&
    left.kind === right.kind && left.timeInForce === right.timeInForce &&
    equalPrice(left.limitPrice, right.limitPrice) && equalPrice(left.stopPrice, right.stopPrice);
}

/** No broker status alone constitutes an execution or moves cash/inventory. */
export function applyCommandAcknowledgement(
  command: ExecutorCommand, brokerOrder: BrokerOrder, at: string,
): Pick<CommandCompletion, "status" | "order" | "reconciliationRequired" | "reasons"> {
  const source = command.order;
  const expected = executorOrderRequest(command);
  if (!identity(brokerOrder.brokerOrderId) || brokerOrder.accountId !== source.accountId ||
    brokerOrder.clientOrderId !== source.clientOrderId || brokerOrder.symbol !== expected.symbol ||
    brokerOrder.side !== expected.side || brokerOrder.quantity !== expected.quantity ||
    (source.brokerOrderId !== null && brokerOrder.brokerOrderId !== source.brokerOrderId))
    throw new Error("ACK_IDENTITY_MISMATCH");
  if (!isShareQuantity(brokerOrder.quantity) || !isShareQuantity(brokerOrder.filledQuantity, true) ||
    brokerOrder.filledQuantity > brokerOrder.quantity || brokerOrder.filledQuantity < source.filledQuantity)
    throw new Error("ACK_FILL_QUANTITY_INVALID");
  if (timestamp(brokerOrder.observedAt) > timestamp(at) || timestamp(at) < timestamp(source.updatedAt) ||
    timestamp(brokerOrder.observedAt) < timestamp(source.proposal.createdAt)) throw new Error("ACK_TIME_INVALID");
  if (brokerOrder.request && !equalRequest(expected, brokerOrder.request)) throw new Error("ACK_TERMS_MISMATCH");
  if (!["PENDING", "OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED", "UNKNOWN"]
    .includes(brokerOrder.status)) throw new Error("ACK_STATUS_INVALID");
  if (brokerOrder.status === "UNKNOWN") throw new Error("BROKER_STATE_UNKNOWN");
  if ((brokerOrder.status === "FILLED" && brokerOrder.filledQuantity !== brokerOrder.quantity) ||
    (brokerOrder.status === "PARTIALLY_FILLED" &&
      (brokerOrder.filledQuantity <= 0 || brokerOrder.filledQuantity >= brokerOrder.quantity)) ||
    (brokerOrder.status === "REJECTED" && brokerOrder.filledQuantity !== 0))
    throw new Error("ACK_STATUS_FILL_MISMATCH");
  if (command.kind === "MODIFY" && !brokerOrder.request) throw new Error("MODIFICATION_TERMS_UNCONFIRMED");
  if (command.kind === "MODIFY" && !["OPEN", "PARTIALLY_FILLED", "FILLED"].includes(brokerOrder.status))
    throw new Error("MODIFICATION_OUTCOME_UNCONFIRMED");
  if (command.kind === "CANCEL" && !["CANCELLED", "FILLED", "EXPIRED"].includes(brokerOrder.status))
    throw new Error("CANCELLATION_OUTCOME_UNCONFIRMED");

  let order = source;
  if (command.kind === "SUBMIT") {
    if (order.state === "APPROVED") order = transitionOrder(order, "SUBMITTING", at);
    if (brokerOrder.status === "REJECTED") {
      order = transitionOrder({ ...order, brokerOrderId: brokerOrder.brokerOrderId }, "REJECTED", at);
      return { status: "REJECTED", order, reconciliationRequired: false, reasons: ["BROKER_REJECTED"] };
    }
    order = acknowledgeSubmission(order, brokerOrder.brokerOrderId, at);
  } else if (command.kind === "MODIFY") {
    if (!command.replacementProposal) throw new Error("MODIFICATION_PROPOSAL_REQUIRED");
    order = { ...order, proposal: { ...command.replacementProposal }, version: order.version + 1, updatedAt: at, lastError: null };
  }
  const missingExecutions = brokerOrder.filledQuantity !== order.filledQuantity;
  if (["CANCELLED", "EXPIRED"].includes(brokerOrder.status) && order.state !== brokerOrder.status)
    order = transitionOrder(order, brokerOrder.status as "CANCELLED" | "EXPIRED", at);
  return {
    status: "ACKNOWLEDGED", order, reconciliationRequired: missingExecutions,
    reasons: missingExecutions ? ["EXECUTION_EVIDENCE_REQUIRED"] : [],
  };
}

function unknownOrder(command: ExecutorCommand, at: string, reason: string): ManagedOrder {
  let order = command.order;
  if (command.kind === "SUBMIT" && order.state === "APPROVED") order = transitionOrder(order, "SUBMITTING", at);
  if (command.kind === "SUBMIT" && order.state === "SUBMITTING") return markSubmissionUnknown(order, at, reason);
  if (command.kind === "CANCEL" && ["SUBMITTED", "PARTIALLY_FILLED"].includes(order.state))
    order = transitionOrder(order, "CANCEL_REQUESTED", at);
  return { ...order, lastError: reason, updatedAt: at, version: order.version + 1 };
}

async function bounded<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("GATEWAY_TIMEOUT")), timeoutMs); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export class AtlasExecutor {
  constructor(
    private readonly provider: BrokerProvider,
    private readonly store: ExecutorStore,
    private readonly options: { executorId: string; timeoutMs: number; now?: () => string },
  ) {
    if (!identity(options.executorId) || !isShareQuantity(options.timeoutMs) || options.timeoutMs > 60_000)
      throw new Error("INVALID_EXECUTOR_OPTIONS");
  }

  private now(): string { return this.options.now?.() ?? new Date().toISOString(); }

  private async complete(claim: ClaimedExecutorCommand, result: Omit<CommandCompletion,
    "commandId" | "claimToken" | "expectedOrderVersion">): Promise<CommandCompletion> {
    const completion = {
      ...result, commandId: claim.command.id, claimToken: claim.claimToken,
      expectedOrderVersion: claim.command.order.version,
    };
    if (!await this.store.complete(completion)) throw new Error("EXECUTOR_COMMIT_CONFLICT_RECONCILIATION_REQUIRED");
    return completion;
  }

  /** At most one dispatch per durable claim. No retries, including thrown adapter errors. */
  async execute(commandId: string): Promise<CommandCompletion | null> {
    const claim = await this.store.claim({
      commandId, providerId: this.provider.capabilities.providerId, executorId: this.options.executorId, at: this.now(),
    });
    if (!claim) return null;
    if (claim.command.id !== commandId || !identity(claim.claimToken)) throw new Error("INVALID_DURABLE_CLAIM");
    const check = validateExecutorCommand(claim.command, this.provider.capabilities, this.now());
    if (!check.approved) return this.complete(claim, {
      status: "REJECTED", order: claim.command.order, brokerOrder: null,
      reconciliationRequired: false, reasons: check.reasons, at: this.now(),
    });
    // Completion persistence errors are deliberately outside this catch. They may
    // conceal a committed ack; do not overwrite them or dispatch the command again.
    let brokerOrder: BrokerOrder | null = null;
    let result: Pick<CommandCompletion, "status" | "order" | "reconciliationRequired" | "reasons">;
    try {
      const command = claim.command;
      brokerOrder = await bounded(() => {
        if (command.kind === "SUBMIT") return this.provider.placeOrder(executorOrderRequest(command));
        if (command.kind === "CANCEL") return this.provider.cancelOrder(command.order.brokerOrderId!, command.idempotencyKey);
        const request = executorOrderRequest(command);
        return this.provider.modifyOrder(command.order.brokerOrderId!, {
          quantity: request.quantity, limitPrice: request.limitPrice, stopPrice: request.stopPrice,
        }, command.idempotencyKey);
      }, this.options.timeoutMs);
      result = applyCommandAcknowledgement(command, brokerOrder, this.now());
    } catch {
      result = { status: "UNKNOWN", order: unknownOrder(claim.command, this.now(), "GATEWAY_OUTCOME_UNKNOWN"),
        reconciliationRequired: true, reasons: ["GATEWAY_OUTCOME_UNKNOWN"] };
    }
    return this.complete(claim, { ...result, brokerOrder, at: this.now() });
  }

  /** Query only. A missing order is not evidence that the original send failed. */
  async recover(commandId: string): Promise<CommandCompletion | null> {
    const claim = await this.store.getClaim(commandId);
    if (!claim) return null;
    if (claim.command.id !== commandId || claim.command.providerId !== this.provider.capabilities.providerId)
      throw new Error("RECOVERY_IDENTITY_MISMATCH");
    let brokerOrder: BrokerOrder | null = null;
    let result: Pick<CommandCompletion, "status" | "order" | "reconciliationRequired" | "reasons">;
    try {
      brokerOrder = await bounded(() => claim.command.order.brokerOrderId
        ? this.provider.getOrder(claim.command.order.brokerOrderId)
        : this.provider.getOrderByClientId(claim.command.order.clientOrderId), this.options.timeoutMs);
      if (!brokerOrder) throw new Error("ORDER_NOT_LOCATED");
      result = applyCommandAcknowledgement(claim.command, brokerOrder, this.now());
    } catch {
      result = { status: "UNKNOWN", order: unknownOrder(claim.command, this.now(), "RECOVERY_INCONCLUSIVE"),
        reconciliationRequired: true, reasons: ["RECOVERY_INCONCLUSIVE"] };
    }
    return this.complete(claim, { ...result, brokerOrder, at: this.now() });
  }

  async processExecution(execution: BrokerExecution): Promise<"COMMITTED" | "DUPLICATE" | "CONFLICT"> {
    const state = await this.store.getExecutionState({ providerId: this.provider.capabilities.providerId,
      accountId: execution.accountId, brokerOrderId: execution.brokerOrderId });
    if (!state) throw new Error("UNMATCHED_EXECUTION_RECONCILIATION_REQUIRED");
    const at = this.now();
    const result = applyExecution(state.order, state.account, execution, at);
    if (result.duplicate) return "DUPLICATE";
    if (!result.entry) throw new Error("EXECUTION_ENTRY_REQUIRED");
    return this.store.commitExecution({ providerId: this.provider.capabilities.providerId,
      expectedOrderVersion: state.order.version, expectedLedgerVersion: state.ledgerVersion,
      order: result.order, account: result.account, execution, entry: result.entry, breaches: result.breaches, at });
  }
}

/** Validates a complete, same-cutoff external snapshot without overwriting the ledger. */
export function reconcileExecutorAccount(input: {
  local: ReconciliationSnapshot;
  localOrders: readonly ManagedOrder[];
  account: BrokerAccount;
  cash: BrokerCash;
  positions: readonly BrokerPosition[];
  orders: readonly BrokerOrder[];
  complete: boolean;
  now: string;
  maxAgeMs: number;
}): ReconciliationResult {
  const checked = reconcileAccount(input.local, {
    accountId: input.account.accountId, observedAt: input.account.observedAt,
    cash: input.cash.settled, positions: input.positions, complete: input.complete,
  }, { now: input.now, maxAgeMs: input.maxAgeMs });
  const discrepancies = [...checked.discrepancies];
  try {
    if (input.account.currency !== "BRL" || !input.account.cashOnly ||
      !["REAL", "OFFICIAL_SANDBOX"].includes(input.account.mode)) discrepancies.push("UNSUPPORTED_ACCOUNT");
    const observations = [input.cash.observedAt, ...input.positions.map((p) => p.observedAt), ...input.orders.map((o) => o.observedAt)];
    for (const at of observations) {
      const age = timestamp(input.now) - timestamp(at);
      if (age < 0 || age > input.maxAgeMs) discrepancies.push("BROKER_COMPONENT_TIME_INVALID");
    }
    const seen = new Set<string>();
    const clientIds = new Set<string>();
    for (const external of input.orders) {
      if (!identity(external.brokerOrderId) || seen.has(external.brokerOrderId) ||
        (external.clientOrderId !== null && clientIds.has(external.clientOrderId))) discrepancies.push("DUPLICATE_OR_INVALID_BROKER_ORDER");
      seen.add(external.brokerOrderId);
      if (external.clientOrderId !== null) clientIds.add(external.clientOrderId);
      if (external.accountId !== input.local.accountId) discrepancies.push("ORDER_ACCOUNT_MISMATCH");
      const local = input.localOrders.find((o) => o.brokerOrderId === external.brokerOrderId);
      if (!local) { discrepancies.push(`UNMANAGED_ORDER:${external.brokerOrderId}`); continue; }
      if (local.accountId !== input.local.accountId || external.clientOrderId !== local.clientOrderId ||
        external.symbol !== local.proposal.symbol || external.side !== local.proposal.side ||
        external.quantity !== local.proposal.quantity) discrepancies.push(`ORDER_IDENTITY_MISMATCH:${local.id}`);
      if (external.filledQuantity !== local.filledQuantity) discrepancies.push(`ORDER_FILL_MISMATCH:${local.id}`);
      if (external.status === "UNKNOWN" || external.status === "REJECTED" && local.state !== "REJECTED" ||
        external.status === "CANCELLED" && local.state !== "CANCELLED" ||
        external.status === "EXPIRED" && local.state !== "EXPIRED" ||
        external.status === "FILLED" && local.state !== "FILLED" ||
        ["OPEN", "PENDING", "PARTIALLY_FILLED"].includes(external.status) &&
        !["SUBMITTED", "PARTIALLY_FILLED", "CANCEL_REQUESTED"].includes(local.state))
        discrepancies.push(`ORDER_STATUS_MISMATCH:${local.id}`);
    }
    for (const local of input.localOrders) {
      if (local.accountId !== input.local.accountId) discrepancies.push("LOCAL_ORDER_ACCOUNT_MISMATCH");
      if (["SUBMITTING", "SUBMISSION_UNKNOWN", "ERROR"].includes(local.state)) discrepancies.push(`LOCAL_ORDER_UNKNOWN:${local.id}`);
      if (["SUBMITTED", "PARTIALLY_FILLED", "CANCEL_REQUESTED"].includes(local.state) &&
        (!local.brokerOrderId || !seen.has(local.brokerOrderId))) discrepancies.push(`MISSING_BROKER_ORDER:${local.id}`);
    }
  } catch { discrepancies.push("INVALID_EXECUTOR_RECONCILIATION_INPUT"); }
  return { matches: discrepancies.length === 0, discrepancies: [...new Set(discrepancies)], checkedAt: input.now };
}
