import { describe, expect, it, vi } from "vitest";
import type { BrokerCapabilities, BrokerExecution, BrokerOrder, BrokerProvider } from "../src/core/broker";
import {
  applyCommandAcknowledgement, AtlasExecutor, executorOrderRequest,
  reconcileExecutorAccount, validateExecutorCommand,
} from "../src/core/executor";
import type { ClaimedExecutorCommand, CommandCompletion, ExecutionCommit, ExecutorCommand, ExecutorStore } from "../src/core/executor";
import { acknowledgeSubmission, createOrder, transitionOrder } from "../src/core/oms";
import type { LedgerAccount, ManagedOrder } from "../src/core/oms";
import type { RiskContext, TradeProposal } from "../src/core/risk";

// All synthetic brokers and persistence doubles are test-only; no production fallback.
const BEFORE = "2026-09-16T14:00:00Z";
const NOW = "2026-09-16T14:00:01Z";
const LATER = "2026-09-16T14:00:02Z";
const capabilities: BrokerCapabilities = {
  providerId: "test-gateway", documentationUrl: "https://example.test/docs", verifiedAt: BEFORE,
  cashEquities: true, overnight: true, fractionalLots: true, orderKinds: ["LIMIT", "STOP_LIMIT"],
  clientOrderLookup: true, nativeIdempotency: true, completeAccountReconciliation: true, cloudAuthorized: true,
};
function proposal(patch: Partial<TradeProposal> = {}): TradeProposal {
  return { id: "proposal-1", agentId: "agent-1", symbol: "TEST3", side: "BUY", quantity: 2,
    kind: "LIMIT", limitPrice: "100", stopPrice: null, createdAt: BEFORE,
    expiresAt: "2026-09-16T14:00:30Z", dataTimestamp: BEFORE, strategyVersion: "v1",
    reasoningSummary: "Synthetic test only", ...patch };
}
function context(patch: Partial<RiskContext> = {}): RiskContext {
  return { accountId: "account-1", now: NOW, liveTradingEnabled: true, ownerMfaVerified: true,
    brokerHealthy: true, reconciliationHealthy: true, killSwitchActive: false, circuitBreakerActive: false,
    strategyApproved: true, cloudAuthorized: true, accountCashOnly: true, capabilitiesVerified: true,
    costModelVerified: true, corporateActionsVerified: true,
    instrument: { symbol: "TEST3", exchange: "B3", assetClass: "EQUITY", tradingEnabled: true, lotSize: 1, priceTick: "0.01" },
    session: "OPEN", sessionObservedAt: BEFORE, allowedOrderKinds: ["LIMIT", "STOP_LIMIT"],
    authorizedSymbols: ["TEST3"], estimatedFees: "1", newsEmergencyScore: "0.1",
    limits: { maxPositionPerAgent: "500", maxPortfolioExposure: "1000", maxOrderValue: "300",
      maxDailyLoss: "50", maxWeeklyLoss: "100", maxDrawdownBps: "1000", minCashReserve: "100",
      maxOpenPositions: 5, maxSectorExposure: "500", maxCorrelatedExposure: "600", maxOrdersPerMinute: 3,
      maxOrdersPerDay: 10, maxSlippageBps: "100", newsEmergencyThreshold: "0.8", maxQuoteAgeMs: 60_000,
      maxBrokerSnapshotAgeMs: 60_000, maxClockSkewMs: 1000 },
    quote: { symbol: "TEST3", bid: "99", ask: "100", observedAt: BEFORE, quality: "REAL_TIME", halted: false },
    snapshot: { accountId: "account-1", agentId: "agent-1", symbol: "TEST3", observedAt: BEFORE,
      cashAvailable: "1000", agentCashAvailable: "500", equity: "2000", portfolioExposure: "500",
      agentExposure: "100", sectorExposure: "100", correlatedExposure: "100", ownedQuantity: 0,
      reservedSellQuantity: 0, openPositions: 1, ordersLastMinute: 0, ordersToday: 0,
      dailyLoss: "0", weeklyLoss: "0", drawdownBps: "0" }, ...patch };
}
function approved(): ManagedOrder {
  return transitionOrder(transitionOrder(createOrder(proposal(), "account-1", "client-1"), "RISK_REVIEW", BEFORE), "APPROVED", BEFORE);
}
function submitted(): ManagedOrder {
  return acknowledgeSubmission(transitionOrder(approved(), "SUBMITTING", BEFORE), "broker-1", BEFORE);
}
function command(patch: Partial<ExecutorCommand> = {}): ExecutorCommand {
  return { id: "command-1", kind: "SUBMIT", providerId: capabilities.providerId, accountId: "account-1",
    idempotencyKey: "client-1", order: approved(), timeInForce: "DAY", riskContext: context(), ...patch };
}
function ack(patch: Partial<BrokerOrder> = {}): BrokerOrder {
  return { brokerOrderId: "broker-1", clientOrderId: "client-1", accountId: "account-1", symbol: "TEST3",
    side: "BUY", quantity: 2, filledQuantity: 0, status: "OPEN", observedAt: NOW, ...patch };
}
function fill(patch: Partial<BrokerExecution> = {}): BrokerExecution {
  return { executionId: "fill-1", brokerOrderId: "broker-1", accountId: "account-1", symbol: "TEST3",
    side: "BUY", quantity: 1, price: "99", fees: "0.5", executedAt: NOW, ...patch };
}
function provider(): BrokerProvider {
  return { capabilities, connect: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => ({ healthy: true, observedAt: NOW, reason: null })),
    getAccount: vi.fn(async () => ({ accountId: "account-1", currency: "BRL", mode: "REAL", cashOnly: true, observedAt: NOW } as const)),
    getCash: vi.fn(async () => ({ settled: "1000", available: "1000", reserved: "0", pendingSettlement: "0", observedAt: NOW })),
    getPositions: vi.fn(async () => []), getOrders: vi.fn(async () => []),
    getOrder: vi.fn(async () => ack()), getOrderByClientId: vi.fn(async () => ack()),
    placeOrder: vi.fn(async () => ack()), modifyOrder: vi.fn(async () => ack()),
    cancelOrder: vi.fn(async () => ack({ status: "CANCELLED" })),
    getExecutions: vi.fn(async () => ({ executions: [], nextCursor: null })) };
}
class TestStore implements ExecutorStore {
  order: ManagedOrder;
  account: LedgerAccount = { accountId: "account-1", agentId: "agent-1", symbol: "TEST3", cash: "1000",
    quantity: 0, costBasis: "0", realizedPnl: "0", totalFees: "0" };
  dispatched = false;
  conflict = false;
  ledgerVersion = 0;
  completions: CommandCompletion[] = [];
  commits: ExecutionCommit[] = [];
  constructor(readonly original: ExecutorCommand) { this.order = original.order; }
  claim = vi.fn(async (): Promise<ClaimedExecutorCommand | null> => {
    if (this.dispatched) return null;
    this.dispatched = true; // durable DISPATCHED is modeled before network I/O.
    return { command: this.original, claimToken: "claim-token", claimedAt: NOW };
  });
  getClaim = vi.fn(async (): Promise<ClaimedExecutorCommand | null> => this.dispatched
    ? { command: { ...this.original, order: this.order }, claimToken: "claim-token", claimedAt: NOW } : null);
  complete = vi.fn(async (result: CommandCompletion): Promise<boolean> => {
    if (this.conflict || result.claimToken !== "claim-token" || result.expectedOrderVersion !== this.order.version) return false;
    this.completions.push(result); this.order = result.order; return true;
  });
  getExecutionState = vi.fn(async () => ({ order: this.order, account: this.account, ledgerVersion: this.ledgerVersion }));
  commitExecution = vi.fn(async (commit: ExecutionCommit): Promise<"COMMITTED" | "DUPLICATE" | "CONFLICT"> => {
    if (this.conflict || commit.expectedOrderVersion !== this.order.version || commit.expectedLedgerVersion !== this.ledgerVersion) return "CONFLICT";
    this.commits.push(commit); this.order = commit.order; this.account = commit.account; this.ledgerVersion += 1;
    return "COMMITTED";
  });
}
function setup(cmd = command()) {
  const store = new TestStore(cmd), gateway = provider();
  const executor = new AtlasExecutor(gateway, store, { executorId: "executor-1", timeoutMs: 100, now: () => NOW });
  return { store, gateway, executor };
}

describe("central executor dispatch and quarantine", () => {
  it("claims before transport, submits approved immutable terms exactly once", async () => {
    const { store, gateway, executor } = setup();
    vi.mocked(gateway.placeOrder).mockImplementation(async () => {
      expect(store.dispatched).toBe(true); return ack();
    });
    const result = await executor.execute("command-1");
    expect(result).toMatchObject({ status: "ACKNOWLEDGED", expectedOrderVersion: 2, reconciliationRequired: false });
    expect(store.order).toMatchObject({ state: "SUBMITTED", brokerOrderId: "broker-1", filledQuantity: 0 });
    expect(gateway.placeOrder).toHaveBeenCalledExactlyOnceWith(executorOrderRequest(command()));
    expect(await executor.execute("command-1")).toBeNull();
    expect(gateway.placeOrder).toHaveBeenCalledTimes(1);
  });
  it("does not resend after exceptions or repeated inconclusive lookups", async () => {
    const { store, gateway, executor } = setup();
    vi.mocked(gateway.placeOrder).mockRejectedValue(new Error("secret transport payload"));
    vi.mocked(gateway.getOrderByClientId).mockResolvedValue(null);
    expect((await executor.execute("command-1"))?.status).toBe("UNKNOWN");
    for (let i = 0; i < 3; i++) {
      expect((await executor.recover("command-1"))?.status).toBe("UNKNOWN");
      expect(await executor.execute("command-1")).toBeNull();
    }
    expect(store.order.state).toBe("SUBMISSION_UNKNOWN");
    expect(gateway.placeOrder).toHaveBeenCalledTimes(1);
    expect(store.order.lastError).toBe("RECOVERY_INCONCLUSIVE");
    expect(store.completions.every((c) => c.reconciliationRequired)).toBe(true);
    vi.mocked(gateway.getOrderByClientId).mockResolvedValue(ack());
    expect((await executor.recover("command-1"))?.status).toBe("ACKNOWLEDGED");
    expect(store.order.state).toBe("SUBMITTED");
    expect(gateway.placeOrder).toHaveBeenCalledTimes(1);
  });
  it("quarantines timeout and ignores the eventual transport success", async () => {
    const { store, gateway, executor } = setup();
    let finish!: (value: BrokerOrder) => void;
    vi.mocked(gateway.placeOrder).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const result = await executor.execute("command-1");
    expect(result?.status).toBe("UNKNOWN");
    finish(ack()); await Promise.resolve();
    expect(store.completions).toHaveLength(1);
    expect(store.order.state).toBe("SUBMISSION_UNKNOWN");
    expect(await executor.execute("command-1")).toBeNull();
  });
  it("leaves a lost acknowledgement commit quarantined, without overwriting or resending", async () => {
    const { store, gateway, executor } = setup(); store.conflict = true;
    await expect(executor.execute("command-1")).rejects.toThrow("EXECUTOR_COMMIT_CONFLICT_RECONCILIATION_REQUIRED");
    expect(store.complete).toHaveBeenCalledTimes(1);
    expect(await executor.execute("command-1")).toBeNull();
    expect(gateway.placeOrder).toHaveBeenCalledTimes(1);
  });
  it("revalidates trusted risk evidence before sending a queued submission", async () => {
    const { store, gateway, executor } = setup(command({ riskContext: context({ killSwitchActive: true }) }));
    expect(await executor.execute("command-1")).toMatchObject({ status: "REJECTED", reasons: ["KILL_SWITCH"] });
    expect(gateway.placeOrder).not.toHaveBeenCalled();
    expect(store.order.state).toBe("CANCELLED");
  });
  it("allows cancellation under kill switch, disabled live trading and stale entry risk", async () => {
    const { store, gateway, executor } = setup(command({ kind: "CANCEL", order: submitted(), idempotencyKey: "cancel-1",
      riskContext: context({ killSwitchActive: true, liveTradingEnabled: false, brokerHealthy: false,
        reconciliationHealthy: false, quote: null, session: "CLOSED", limits: null }) }));
    expect((await executor.execute("command-1"))?.status).toBe("ACKNOWLEDGED");
    expect(gateway.cancelOrder).toHaveBeenCalledExactlyOnceWith("broker-1", "cancel-1");
    expect(store.order.state).toBe("CANCELLED");
  });
  it("recovers an uncertain cancellation by query and never resends cancellation", async () => {
    const { store, gateway, executor } = setup(command({ kind: "CANCEL", order: submitted(), idempotencyKey: "cancel-1" }));
    vi.mocked(gateway.cancelOrder).mockResolvedValue(ack({ status: "OPEN" }));
    expect((await executor.execute("command-1"))?.status).toBe("UNKNOWN");
    expect(store.order.state).toBe("CANCEL_REQUESTED");
    vi.mocked(gateway.getOrder).mockResolvedValue(ack({ status: "CANCELLED" }));
    expect((await executor.recover("command-1"))?.status).toBe("ACKNOWLEDGED");
    expect(gateway.cancelOrder).toHaveBeenCalledTimes(1);
    expect(gateway.getOrder).toHaveBeenCalledWith("broker-1");
  });
  it("validates a replacement proposal before modifying and preserves its idempotency key", async () => {
    const replacementProposal = proposal({ quantity: 3 });
    const cmd = command({ kind: "MODIFY", order: submitted(), replacementProposal, idempotencyKey: "modify-1" });
    const { store, gateway, executor } = setup(cmd);
    vi.mocked(gateway.modifyOrder).mockResolvedValue(ack({ quantity: 3, request: executorOrderRequest(cmd) }));
    expect((await executor.execute("command-1"))?.status).toBe("ACKNOWLEDGED");
    expect(store.order.proposal).toEqual(replacementProposal);
    expect(gateway.modifyOrder).toHaveBeenCalledExactlyOnceWith("broker-1", { quantity: 3, limitPrice: "100", stopPrice: null }, "modify-1");
    expect(await executor.execute("command-1")).toBeNull();
  });
  it("blocks a replacement that exceeds entry risk even if the original terms were approved", async () => {
    const { gateway, executor } = setup(command({ kind: "MODIFY", order: submitted(),
      replacementProposal: proposal({ quantity: 4 }), idempotencyKey: "modify-1" }));
    const result = await executor.execute("command-1");
    expect(result?.status).toBe("REJECTED"); expect(result?.reasons).toContain("ORDER_VALUE_LIMIT");
    expect(gateway.modifyOrder).not.toHaveBeenCalled();
  });
  it("requires actual modification terms and rejects stale or substituted acknowledgements", async () => {
    const cmd = command({ kind: "MODIFY", order: { ...submitted(), updatedAt: NOW },
      replacementProposal: proposal({ quantity: 3 }), idempotencyKey: "modify-1" });
    expect(() => applyCommandAcknowledgement(cmd, ack({ quantity: 3 }), LATER)).toThrow("MODIFICATION_TERMS_UNCONFIRMED");
    expect(() => applyCommandAcknowledgement(cmd, ack({ quantity: 3, observedAt: BEFORE, request: executorOrderRequest(cmd) }), LATER)).toThrow("ACK_TIME_INVALID");
    expect(() => applyCommandAcknowledgement(cmd, ack({ quantity: 3, request: { ...executorOrderRequest(cmd), limitPrice: "101" } }), LATER)).toThrow("ACK_TERMS_MISMATCH");
  });
  it.each([
    { accountId: "other" }, { clientOrderId: "other" }, { brokerOrderId: "" }, { quantity: 3 },
    { filledQuantity: 3 }, { observedAt: LATER }, { status: "FILLED", filledQuantity: 1 },
    { status: "REJECTED", filledQuantity: 1 },
  ] as Partial<BrokerOrder>[])("quarantines incompatible broker acknowledgements %j", async (patch) => {
    const { store, gateway, executor } = setup(); vi.mocked(gateway.placeOrder).mockResolvedValue(ack(patch));
    expect((await executor.execute("command-1"))?.status).toBe("UNKNOWN");
    expect(store.order.brokerOrderId).toBeNull(); expect(store.account.cash).toBe("1000");
  });
  it("keeps a final broker rejection terminal and records no fills", async () => {
    const { store, gateway, executor } = setup(); vi.mocked(gateway.placeOrder).mockResolvedValue(ack({ status: "REJECTED" }));
    expect((await executor.execute("command-1"))?.status).toBe("REJECTED");
    expect(store.order.state).toBe("REJECTED"); expect(store.order.executions).toEqual([]);
    expect(await executor.execute("command-1")).toBeNull();
  });
  it("rejects forged identities and modifications below executions", () => {
    expect(validateExecutorCommand(command({ idempotencyKey: "other" }), capabilities, NOW).reasons).toContain("SUBMISSION_IDEMPOTENCY_MISMATCH");
    expect(validateExecutorCommand(command({ providerId: "other" }), capabilities, NOW).reasons).toContain("PROVIDER_MISMATCH");
    expect(validateExecutorCommand(command({ kind: "MODIFY", order: { ...submitted(), filledQuantity: 1, state: "PARTIALLY_FILLED" },
      replacementProposal: proposal({ quantity: 1, side: "SELL" }) }), capabilities, NOW).reasons).toEqual(expect.arrayContaining([
        "MODIFICATION_IDENTITY_MISMATCH", "MODIFICATION_BELOW_EXECUTED_QUANTITY",
      ]));
  });
});

describe("executor execution evidence and accounting", () => {
  it.each(["PARTIALLY_FILLED", "FILLED"] as const)("never invents fills/cash from %s status", async (status) => {
    const { store, gateway, executor } = setup();
    vi.mocked(gateway.placeOrder).mockResolvedValue(ack({ status, filledQuantity: status === "FILLED" ? 2 : 1 }));
    expect(await executor.execute("command-1")).toMatchObject({ status: "ACKNOWLEDGED", reconciliationRequired: true, reasons: ["EXECUTION_EVIDENCE_REQUIRED"] });
    expect(store.order.state).toBe("SUBMITTED"); expect(store.order.filledQuantity).toBe(0);
    expect(store.account.cash).toBe("1000"); expect(store.commits).toHaveLength(0);
    expect(await executor.processExecution(fill())).toBe("COMMITTED");
    expect(store.order.state).toBe("PARTIALLY_FILLED");
    expect(store.account).toMatchObject({ cash: "900.5", quantity: 1, costBasis: "99.5" });
    expect(await executor.processExecution(fill())).toBe("DUPLICATE");
    expect(store.commits).toHaveLength(1);
  });
  it("rejects a changed duplicate execution and an unmatched account without changing balances", async () => {
    const { store, executor } = setup(); await executor.execute("command-1"); await executor.processExecution(fill());
    await expect(executor.processExecution(fill({ price: "98" }))).rejects.toThrow("EXECUTION_ID_CONFLICT");
    await expect(executor.processExecution(fill({ executionId: "fill-2", accountId: "other" }))).rejects.toThrow("EXECUTION_IDENTITY_MISMATCH");
    expect(store.account.cash).toBe("900.5"); expect(store.commits).toHaveLength(1);
  });
  it("includes account/order CAS and actual deficit breaches in the atomic ledger commit", async () => {
    const { store, executor } = setup(); await executor.execute("command-1"); store.account = { ...store.account, cash: "1" };
    const version = store.order.version;
    expect(await executor.processExecution(fill({ price: "101" }))).toBe("COMMITTED");
    expect(store.commits[0]).toMatchObject({ expectedOrderVersion: version, expectedLedgerVersion: 0,
      breaches: ["CASH_DEFICIT_AFTER_EXECUTION", "LIMIT_PRICE_VIOLATION"], account: { cash: "-100.5" } });
  });
  it("does not apply a concurrent ledger conflict locally", async () => {
    const { store, executor } = setup(); await executor.execute("command-1"); store.conflict = true;
    expect(await executor.processExecution(fill())).toBe("CONFLICT");
    expect(store.account.cash).toBe("1000"); expect(store.order.filledQuantity).toBe(0);
  });
});

describe("executor reconciliation", () => {
  function snapshot() {
    return { local: { accountId: "account-1", observedAt: NOW, cash: "1000", positions: [], complete: true },
      localOrders: [submitted()], account: { accountId: "account-1", currency: "BRL", mode: "REAL", cashOnly: true, observedAt: NOW } as const,
      cash: { settled: "1000", available: "1000", reserved: "0", pendingSettlement: "0", observedAt: NOW },
      positions: [], orders: [ack()], complete: true, now: NOW, maxAgeMs: 60_000 };
  }
  it("accepts complete matching account/orders evidence without rewriting it", () => {
    expect(reconcileExecutorAccount(snapshot()).matches).toBe(true);
  });
  it("blocks missing/unmanaged orders, unrecorded fills, duplicate identities and incomplete evidence", () => {
    expect(reconcileExecutorAccount({ ...snapshot(), orders: [] }).discrepancies).toContain("MISSING_BROKER_ORDER:proposal-1");
    expect(reconcileExecutorAccount({ ...snapshot(), orders: [ack({ brokerOrderId: "outside" })] }).discrepancies).toContain("UNMANAGED_ORDER:outside");
    expect(reconcileExecutorAccount({ ...snapshot(), orders: [ack({ filledQuantity: 1, status: "PARTIALLY_FILLED" })] }).discrepancies).toContain("ORDER_FILL_MISMATCH:proposal-1");
    expect(reconcileExecutorAccount({ ...snapshot(), orders: [ack(), ack()] }).discrepancies).toContain("DUPLICATE_OR_INVALID_BROKER_ORDER");
    expect(reconcileExecutorAccount({ ...snapshot(), complete: false }).matches).toBe(false);
  });
  it("blocks stale component data and uncertain local submissions", () => {
    expect(reconcileExecutorAccount({ ...snapshot(), cash: { ...snapshot().cash, observedAt: "2026-09-16T13:00:00Z" } }).discrepancies).toContain("BROKER_COMPONENT_TIME_INVALID");
    expect(reconcileExecutorAccount({ ...snapshot(), localOrders: [{ ...submitted(), state: "SUBMISSION_UNKNOWN" }] }).discrepancies).toContain("LOCAL_ORDER_UNKNOWN:proposal-1");
  });
});
