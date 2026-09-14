import { describe, expect, it } from "vitest";
import type { BrokerExecution } from "../src/core/broker";
import { decimal, money, sum, timestamp } from "../src/core/money";
import { acknowledgeSubmission, applyExecution, createOrder, markSubmissionUnknown, reconcileAccount, transitionOrder } from "../src/core/oms";
import type { LedgerAccount, ManagedOrder, ReconciliationSnapshot } from "../src/core/oms";
import { evaluateTrade } from "../src/core/risk";
import type { RiskContext, TradeProposal } from "../src/core/risk";

// Synthetic fixtures are confined to tests; they are never a production provider.
const NOW = "2026-09-11T14:00:00Z";
const BEFORE = "2026-09-11T13:59:59Z";
const AFTER = "2026-09-11T14:00:01Z";

function proposal(patch: Partial<TradeProposal> = {}): TradeProposal {
  return { id: "proposal-1", agentId: "agent-1", symbol: "TEST3", side: "BUY", quantity: 2,
    kind: "LIMIT", limitPrice: "100", stopPrice: null, createdAt: BEFORE,
    expiresAt: "2026-09-11T14:00:30Z", dataTimestamp: BEFORE,
    strategyVersion: "strategy-v1", reasoningSummary: "Synthetic test fixture", ...patch };
}

function context(patch: Partial<RiskContext> = {}): RiskContext {
  return {
    accountId: "account-1",
    now: NOW, liveTradingEnabled: true, ownerMfaVerified: true, brokerHealthy: true,
    reconciliationHealthy: true, killSwitchActive: false, circuitBreakerActive: false,
    strategyApproved: true, cloudAuthorized: true, accountCashOnly: true,
    capabilitiesVerified: true, costModelVerified: true, corporateActionsVerified: true,
    instrument: { symbol: "TEST3", exchange: "B3", assetClass: "EQUITY", tradingEnabled: true, lotSize: 1, priceTick: "0.01" },
    session: "OPEN", sessionObservedAt: BEFORE, allowedOrderKinds: ["LIMIT", "STOP_LIMIT"],
    authorizedSymbols: ["TEST3"], estimatedFees: "1", newsEmergencyScore: "0.1",
    limits: { maxPositionPerAgent: "500", maxPortfolioExposure: "1000", maxOrderValue: "300",
      maxDailyLoss: "50", maxWeeklyLoss: "100", maxDrawdownBps: "1000", minCashReserve: "100",
      maxOpenPositions: 5, maxSectorExposure: "500", maxCorrelatedExposure: "600",
      maxOrdersPerMinute: 3, maxOrdersPerDay: 10, maxSlippageBps: "100",
      newsEmergencyThreshold: "0.8", maxQuoteAgeMs: 60_000,
      maxBrokerSnapshotAgeMs: 60_000, maxClockSkewMs: 1_000 },
    quote: { symbol: "TEST3", bid: "99", ask: "100", observedAt: BEFORE, quality: "REAL_TIME", halted: false },
    snapshot: { accountId: "account-1", agentId: "agent-1", symbol: "TEST3", observedAt: BEFORE, cashAvailable: "1000", agentCashAvailable: "500", equity: "2000",
      portfolioExposure: "500", agentExposure: "100", sectorExposure: "100", correlatedExposure: "100",
      ownedQuantity: 0, reservedSellQuantity: 0, openPositions: 1, ordersLastMinute: 0,
      ordersToday: 0, dailyLoss: "0", weeklyLoss: "0", drawdownBps: "0" },
    ...patch,
  };
}

function submitted(patch: Partial<TradeProposal> = {}, brokerId = "broker-1"): ManagedOrder {
  let order = createOrder(proposal(patch), "account-1", `client-${patch.id ?? "1"}`);
  order = transitionOrder(order, "RISK_REVIEW", BEFORE);
  order = transitionOrder(order, "APPROVED", BEFORE);
  order = transitionOrder(order, "SUBMITTING", BEFORE);
  return acknowledgeSubmission(order, brokerId, BEFORE);
}

function account(patch: Partial<LedgerAccount> = {}): LedgerAccount {
  return { accountId: "account-1", agentId: "agent-1", symbol: "TEST3", cash: "1000",
    quantity: 0, costBasis: "0", realizedPnl: "0", totalFees: "0", ...patch };
}

function execution(patch: Partial<BrokerExecution> = {}): BrokerExecution {
  return { executionId: "fill-1", brokerOrderId: "broker-1", accountId: "account-1", symbol: "TEST3",
    side: "BUY", quantity: 1, price: "99", fees: "0.5", executedAt: NOW, ...patch };
}

describe("decimal accounting boundaries", () => {
  it("sums without binary float drift and preserves large decimal precision", () => {
    expect(sum(["0.1", "0.2"])).toBe("0.3");
    expect(money(decimal("999999999999999999.99999999").minus("0.00000001"))).toBe("999999999999999999.99999998");
  });
  it.each(["NaN", "Infinity", "1e5", " 1", "1,2", "01", "0.123456789", "9999999999999999999"])("rejects unsafe decimal %s", (value) => {
    expect(() => decimal(value)).toThrow("INVALID_DECIMAL");
  });
  it("requires timezone-bearing valid timestamps", () => {
    expect(() => timestamp("2026-09-11T14:00:00")).toThrow();
    expect(() => timestamp("2026-13-11T14:00:00Z")).toThrow();
    expect(() => timestamp("2026-02-30T14:00:00Z")).toThrow();
    expect(() => timestamp("2026-09-11T24:00:00Z")).toThrow();
  });
});

describe("deterministic fail-closed risk", () => {
  it("approves a fully configured bounded cash-equity proposal", () => {
    expect(evaluateTrade(proposal(), context())).toEqual({ approved: true, reasons: [],
      notional: "200", estimatedDebit: "201", evaluatedAt: NOW });
  });

  const blockers: Array<[string, Partial<RiskContext>, string]> = [
    ["live disabled", { liveTradingEnabled: false }, "LIVE_DISABLED"],
    ["MFA missing", { ownerMfaVerified: false }, "MFA_REQUIRED"],
    ["expired broker token", { brokerHealthy: false }, "BROKER_UNHEALTHY"],
    ["connection loss", { brokerHealthy: false }, "BROKER_UNHEALTHY"],
    ["kill switch", { killSwitchActive: true }, "KILL_SWITCH"],
    ["circuit breaker", { circuitBreakerActive: true }, "CIRCUIT_BREAKER"],
    ["reconciliation mismatch", { reconciliationHealthy: false }, "RECONCILIATION_REQUIRED"],
    ["missing risk config", { limits: null }, "RISK_CONFIGURATION_REQUIRED"],
    ["market closed", { session: "CLOSED" }, "MARKET_NOT_OPEN"],
    ["unknown session", { session: "UNKNOWN" }, "MARKET_NOT_OPEN"],
    ["auction", { session: "AUCTION" }, "MARKET_NOT_OPEN"],
    ["no strategy validation", { strategyApproved: false }, "STRATEGY_NOT_APPROVED"],
    ["no cloud agreement", { cloudAuthorized: false }, "CLOUD_NOT_AUTHORIZED"],
    ["margin account", { accountCashOnly: false }, "CASH_ACCOUNT_REQUIRED"],
    ["unverified fees", { costModelVerified: false }, "COST_MODEL_UNVERIFIED"],
    ["no quote", { quote: null }, "QUOTE_REQUIRED"],
    ["no account observation", { snapshot: null }, "INVALID_BROKER_SNAPSHOT"],
    ["news emergency", { newsEmergencyScore: "0.8" }, "NEWS_EMERGENCY"],
    ["unprocessed corporate action", { corporateActionsVerified: false }, "CORPORATE_ACTION_REVIEW_REQUIRED"],
    ["missing instrument metadata", { instrument: null }, "INSTRUMENT_METADATA_REQUIRED"],
  ];
  it.each(blockers)("blocks %s", (_name, patch, reason) => {
    const result = evaluateTrade(proposal(), context(patch));
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it.each(["DELAYED", "EOD", "STALE", "UNKNOWN"] as const)("does not trade on %s data", (quality) => {
    expect(evaluateTrade(proposal(), context({ quote: { ...context().quote!, quality } })).reasons).toContain("FEED_NOT_EXECUTABLE");
  });
  it("blocks stale quote, stale broker and stale market-session observations", () => {
    const stale = "2026-09-11T13:58:59Z";
    const result = evaluateTrade(proposal(), context({ quote: { ...context().quote!, observedAt: stale },
      snapshot: { ...context().snapshot!, observedAt: stale }, sessionObservedAt: stale }));
    expect(result.reasons).toEqual(expect.arrayContaining(["STALE_QUOTE", "STALE_BROKER_SNAPSHOT", "STALE_SESSION"]));
  });
  it("blocks future observations and stale proposal evidence", () => {
    expect(evaluateTrade(proposal(), context({ quote: { ...context().quote!, observedAt: "2026-09-11T14:00:02Z" } })).reasons).toContain("FUTURE_TIMESTAMP");
    expect(evaluateTrade(proposal({ dataTimestamp: "2026-09-10T14:00:00Z" }), context()).reasons).toContain("STALE_PROPOSAL_DATA");
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects quantity %s", (quantity) => {
    expect(evaluateTrade(proposal({ quantity }), context()).reasons).toContain("INVALID_QUANTITY");
  });
  it("rejects malformed, unbounded and unsupported instruments/orders", () => {
    expect(evaluateTrade(proposal({ symbol: "WINFUT" }), context()).reasons).toContain("SYMBOL_NOT_AUTHORIZED");
    expect(evaluateTrade(proposal({ kind: "STOP", limitPrice: null, stopPrice: "100" }), context()).reasons).toContain("UNBOUNDED_ORDER");
    expect(evaluateTrade(proposal({ kind: "STOP_LIMIT", stopPrice: "101" }), context()).reasons).toContain("INVALID_STOP_LIMIT_RELATION");
    expect(evaluateTrade(proposal({ limitPrice: "NaN" }), context()).approved).toBe(false);
    expect(evaluateTrade(proposal({ expiresAt: NOW }), context()).reasons).toContain("PROPOSAL_EXPIRED");
  });
  it("requires matching identity, equity class, lot and decimal tick size", () => {
    expect(evaluateTrade(proposal(), context({ snapshot: { ...context().snapshot!, agentId: "agent-2" } })).reasons).toContain("SNAPSHOT_IDENTITY_MISMATCH");
    expect(evaluateTrade(proposal(), context({ instrument: { ...context().instrument!, assetClass: "OPTION" } })).reasons).toContain("UNSUPPORTED_INSTRUMENT");
    expect(evaluateTrade(proposal(), context({ instrument: { ...context().instrument!, lotSize: 100 } })).reasons).toContain("INVALID_LOT_SIZE");
    expect(evaluateTrade(proposal({ limitPrice: "100.001" }), context()).reasons).toContain("INVALID_PRICE_TICK");
  });
  it("uses trusted fee estimates in cash and reserve checks", () => {
    const snapshot = { ...context().snapshot!, cashAvailable: "200.99", agentCashAvailable: "200.99" };
    expect(evaluateTrade(proposal(), context({ snapshot })).reasons).toEqual(expect.arrayContaining(["INSUFFICIENT_CASH", "INSUFFICIENT_AGENT_CASH", "CASH_RESERVE_LIMIT"]));
  });
  it("does not count cash-limit equality as insufficient", () => {
    const ctx = context({ snapshot: { ...context().snapshot!, cashAvailable: "201", agentCashAvailable: "201" },
      limits: { ...context().limits!, minCashReserve: "0" } });
    expect(evaluateTrade(proposal(), ctx).approved).toBe(true);
  });
  it("reserves other open sells before allowing a sale", () => {
    const snapshot = { ...context().snapshot!, ownedQuantity: 2, reservedSellQuantity: 1 };
    expect(evaluateTrade(proposal({ side: "SELL", limitPrice: "99" }), context({ snapshot })).reasons).toContain("SHORT_SELLING_FORBIDDEN");
    expect(evaluateTrade(proposal({ side: "SELL", quantity: 1, limitPrice: "99" }), context({ snapshot })).approved).toBe(true);
  });
  it("checks all exposure ceilings, leverage and open positions", () => {
    const limits = { ...context().limits!, maxPositionPerAgent: "299", maxPortfolioExposure: "699",
      maxSectorExposure: "299", maxCorrelatedExposure: "299", maxOpenPositions: 1 };
    const result = evaluateTrade(proposal(), context({ limits, snapshot: { ...context().snapshot!, equity: "700" } }));
    expect(result.reasons).toEqual(expect.arrayContaining(["AGENT_EXPOSURE_LIMIT", "PORTFOLIO_EXPOSURE_LIMIT", "SECTOR_EXPOSURE_LIMIT", "CORRELATED_EXPOSURE_LIMIT", "OPEN_POSITION_LIMIT", "LEVERAGE_FORBIDDEN"]));
  });
  it("checks loss/rate limits at equality and adverse slippage", () => {
    const snapshot = { ...context().snapshot!, dailyLoss: "50", weeklyLoss: "100", drawdownBps: "1000",
      ordersLastMinute: 3, ordersToday: 10 };
    const result = evaluateTrade(proposal({ limitPrice: "102" }), context({ snapshot }));
    expect(result.reasons).toEqual(expect.arrayContaining(["DAILY_LOSS_LIMIT", "WEEKLY_LOSS_LIMIT", "DRAWDOWN_LIMIT", "MINUTE_ORDER_LIMIT", "DAILY_ORDER_LIMIT", "SLIPPAGE_LIMIT"]));
  });
  it("fails closed on non-finite configuration and crossed quotes", () => {
    expect(evaluateTrade(proposal(), context({ limits: { ...context().limits!, maxOrderValue: "NaN" } })).approved).toBe(false);
    expect(evaluateTrade(proposal(), context({ quote: { ...context().quote!, bid: "101" } })).reasons).toContain("CROSSED_QUOTE");
  });
});

describe("OMS lifecycle and execution accounting", () => {
  it("requires risk-review sequencing and broker acknowledgement", () => {
    const order = createOrder(proposal(), "account-1", "client-1");
    expect(() => transitionOrder(order, "SUBMITTING", NOW)).toThrow("INVALID_ORDER_TRANSITION");
    expect(() => transitionOrder(order, "APPROVED", NOW)).toThrow("INVALID_ORDER_TRANSITION");
    expect(() => transitionOrder(submitted(), "FILLED", NOW)).toThrow("FILL_EVIDENCE_REQUIRED");
  });
  it("quarantines a timed-out submission and never permits automatic resend", () => {
    const acknowledged = submitted();
    const sending: ManagedOrder = { ...acknowledged, brokerOrderId: null, state: "SUBMITTING" };
    const unknown = markSubmissionUnknown(sending, NOW);
    expect(unknown.state).toBe("SUBMISSION_UNKNOWN");
    expect(() => transitionOrder(unknown, "SUBMITTING", AFTER)).toThrow();
    expect(() => transitionOrder(unknown, "APPROVED", AFTER)).toThrow();
    expect(acknowledgeSubmission(unknown, "broker-1", AFTER).state).toBe("SUBMITTED");
  });
  it("records definitive rejection without execution or resubmission", () => {
    const sending: ManagedOrder = { ...submitted(), brokerOrderId: null, state: "SUBMITTING" };
    const rejected = transitionOrder(sending, "REJECTED", NOW);
    expect(rejected.filledQuantity).toBe(0);
    expect(() => transitionOrder(rejected, "SUBMITTING", AFTER)).toThrow();
  });
  it("is idempotent for acknowledgement but rejects conflicting broker IDs", () => {
    const order = submitted();
    expect(acknowledgeSubmission(order, "broker-1", NOW)).toBe(order);
    expect(() => acknowledgeSubmission(order, "broker-2", NOW)).toThrow("BROKER_ORDER_ID_MISMATCH");
  });
  it("accounts partial fills, fees and final fill exactly once", () => {
    const first = applyExecution(submitted(), account(), execution(), NOW);
    expect(first.order.state).toBe("PARTIALLY_FILLED");
    expect(first.account).toMatchObject({ cash: "900.5", quantity: 1, costBasis: "99.5", totalFees: "0.5" });
    const duplicate = applyExecution(first.order, first.account, execution(), AFTER);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.entry).toBeNull();
    expect(duplicate.account).toBe(first.account);
    const final = applyExecution(first.order, first.account, execution({ executionId: "fill-2", price: "100", executedAt: AFTER }), AFTER);
    expect(final.order).toMatchObject({ state: "FILLED", filledQuantity: 2, filledNotional: "199", fees: "1" });
    expect(final.account).toMatchObject({ cash: "800", quantity: 2, costBasis: "200", totalFees: "1" });
    expect(final.entry).toMatchObject({ orderId: "proposal-1", brokerOrderId: "broker-1", source: "BROKER_EXECUTION", strategyVersion: "strategy-v1" });
  });
  it("rejects changed duplicate fills, overfills and cross-account executions", () => {
    const first = applyExecution(submitted(), account(), execution(), NOW);
    expect(() => applyExecution(first.order, first.account, execution({ price: "98" }), AFTER)).toThrow("EXECUTION_ID_CONFLICT");
    expect(() => applyExecution(first.order, first.account, execution({ executionId: "fill-2", quantity: 2 }), AFTER)).toThrow("OVERFILL_RECONCILIATION_REQUIRED");
    expect(() => applyExecution(submitted(), account(), execution({ accountId: "account-2" }), NOW)).toThrow("EXECUTION_IDENTITY_MISMATCH");
  });
  it("handles fills racing with cancellation, including delayed final evidence", () => {
    const pending = transitionOrder(submitted(), "CANCEL_REQUESTED", BEFORE);
    const first = applyExecution(pending, account(), execution(), NOW);
    expect(first.order.state).toBe("CANCEL_REQUESTED");
    const cancelled = transitionOrder(first.order, "CANCELLED", NOW);
    const final = applyExecution(cancelled, first.account, execution({ executionId: "fill-2", executedAt: NOW }), AFTER);
    expect(final.order.state).toBe("FILLED");
  });
  it("does not fabricate a fill when an order is cancelled", () => {
    const cancelled = transitionOrder(transitionOrder(submitted(), "CANCEL_REQUESTED", NOW), "CANCELLED", NOW);
    expect(cancelled.filledQuantity).toBe(0);
    expect(cancelled.executions).toHaveLength(0);
  });
  it("computes sell proceeds, remaining basis and realized P&L with fees", () => {
    const owned = account({ cash: "800", quantity: 2, costBasis: "200", totalFees: "1" });
    const sell = submitted({ id: "sell-1", side: "SELL", limitPrice: "105" }, "broker-sell");
    const fill = execution({ brokerOrderId: "broker-sell", side: "SELL", price: "105" });
    const first = applyExecution(sell, owned, fill, NOW);
    expect(first.account).toMatchObject({ cash: "904.5", costBasis: "100", quantity: 1, realizedPnl: "4.5", totalFees: "1.5" });
    const second = applyExecution(first.order, first.account, { ...fill, executionId: "sell-fill-2" }, AFTER);
    expect(second.account).toMatchObject({ cash: "1009", costBasis: "0", quantity: 0, realizedPnl: "9", totalFees: "2" });
  });
  it("preserves actual deficit and price violation as breaches, never hides the real execution", () => {
    const result = applyExecution(submitted(), account({ cash: "1" }), execution({ price: "101" }), NOW);
    expect(result.account.cash).toBe("-100.5");
    expect(result.breaches).toEqual(["CASH_DEFICIT_AFTER_EXECUTION", "LIMIT_PRICE_VIOLATION"]);
  });
  it("requires reconciliation rather than inventing short inventory", () => {
    const sell = submitted({ side: "SELL" });
    expect(() => applyExecution(sell, account(), execution({ side: "SELL" }), NOW)).toThrow("SHORT_FILL_RECONCILIATION_REQUIRED");
  });
});

describe("account reconciliation", () => {
  const snapshot = (patch: Partial<ReconciliationSnapshot> = {}): ReconciliationSnapshot => ({ accountId: "account-1", observedAt: NOW,
    cash: "1000", positions: [{ symbol: "TEST3", quantity: 2 }], complete: true, ...patch });
  const options = { now: AFTER, maxAgeMs: 60_000 };
  it("matches an exact complete observation", () => {
    expect(reconcileAccount(snapshot(), snapshot({ cash: "1000.00" }), options).matches).toBe(true);
  });
  it("reports cash and positions without changing the ledger", () => {
    const local = snapshot();
    const result = reconcileAccount(local, snapshot({ cash: "999", positions: [{ symbol: "TEST3", quantity: 3 }, { symbol: "OTHR4", quantity: 1 }] }), options);
    expect(result.discrepancies).toEqual(["CASH_MISMATCH", "POSITION_MISMATCH:OTHR4", "POSITION_MISMATCH:TEST3"]);
    expect(local.cash).toBe("1000");
  });
  it("fails on incomplete, stale, duplicate and cross-account snapshots", () => {
    expect(reconcileAccount(snapshot(), snapshot({ complete: false }), options).matches).toBe(false);
    expect(reconcileAccount(snapshot(), snapshot({ observedAt: "2026-09-10T14:00:00Z" }), options).discrepancies).toContain("BROKER_SNAPSHOT_TIME_INVALID");
    expect(reconcileAccount(snapshot(), snapshot({ accountId: "other" }), options).discrepancies).toContain("ACCOUNT_MISMATCH");
    expect(reconcileAccount(snapshot(), snapshot({ positions: [{ symbol: "TEST3", quantity: 1 }, { symbol: "TEST3", quantity: 1 }] }), options).discrepancies).toContain("INVALID_RECONCILIATION_INPUT");
  });
  it("does not silently consider a corporate action split reconciled", () => {
    expect(reconcileAccount(snapshot(), snapshot({ positions: [{ symbol: "TEST3", quantity: 4 }] }), options).discrepancies).toContain("POSITION_MISMATCH:TEST3");
  });
});
