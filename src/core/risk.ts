import type { MarketSession, OrderKind, OrderSide, QuoteQuality } from "./broker";
import { decimal, isNonNegativeAmount, isPositiveAmount, isShareQuantity, money, timestamp } from "./money";

export interface TradeProposal {
  readonly id: string;
  readonly agentId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly kind: OrderKind;
  readonly limitPrice: string | null;
  readonly stopPrice: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly dataTimestamp: string;
  readonly strategyVersion: string;
  readonly reasoningSummary: string;
}

/** Exposure caps are BRL amounts; drawdown/slippage are basis points (100 bps = 1%). */
export interface RiskLimits {
  readonly maxPositionPerAgent: string;
  readonly maxPortfolioExposure: string;
  readonly maxOrderValue: string;
  readonly maxDailyLoss: string;
  readonly maxWeeklyLoss: string;
  readonly maxDrawdownBps: string;
  readonly minCashReserve: string;
  readonly maxOpenPositions: number;
  readonly maxSectorExposure: string;
  readonly maxCorrelatedExposure: string;
  readonly maxOrdersPerMinute: number;
  readonly maxOrdersPerDay: number;
  readonly maxSlippageBps: string;
  readonly newsEmergencyThreshold: string;
  readonly maxQuoteAgeMs: number;
  readonly maxBrokerSnapshotAgeMs: number;
  readonly maxClockSkewMs: number;
}

export interface RiskQuote {
  readonly symbol: string;
  readonly bid: string;
  readonly ask: string;
  readonly observedAt: string;
  readonly quality: QuoteQuality;
  readonly halted: boolean;
}

/** All cash/exposure/count values must already include outstanding reservations/commitments. */
export interface RiskSnapshot {
  readonly accountId: string;
  readonly agentId: string;
  readonly symbol: string;
  readonly observedAt: string;
  readonly cashAvailable: string;
  readonly agentCashAvailable: string;
  readonly equity: string;
  readonly portfolioExposure: string;
  readonly agentExposure: string;
  readonly sectorExposure: string;
  readonly correlatedExposure: string;
  readonly ownedQuantity: number;
  readonly reservedSellQuantity: number;
  readonly openPositions: number;
  readonly ordersLastMinute: number;
  readonly ordersToday: number;
  readonly dailyLoss: string;
  readonly weeklyLoss: string;
  readonly drawdownBps: string;
}

export interface RiskContext {
  readonly accountId: string;
  readonly now: string;
  readonly limits: RiskLimits | null;
  readonly quote: RiskQuote | null;
  readonly snapshot: RiskSnapshot | null;
  readonly liveTradingEnabled: boolean;
  readonly ownerMfaVerified: boolean;
  readonly brokerHealthy: boolean;
  readonly reconciliationHealthy: boolean;
  readonly killSwitchActive: boolean;
  readonly circuitBreakerActive: boolean;
  readonly strategyApproved: boolean;
  readonly cloudAuthorized: boolean;
  readonly accountCashOnly: boolean;
  readonly capabilitiesVerified: boolean;
  readonly costModelVerified: boolean;
  readonly corporateActionsVerified: boolean;
  readonly instrument: {
    readonly symbol: string;
    readonly exchange: string;
    readonly assetClass: string;
    readonly tradingEnabled: boolean;
    readonly lotSize: number;
    readonly priceTick: string;
  } | null;
  readonly session: MarketSession;
  readonly sessionObservedAt: string;
  readonly allowedOrderKinds: readonly OrderKind[];
  readonly authorizedSymbols: readonly string[];
  /** Trusted fee model, not a value invented by an agent/LLM. */
  readonly estimatedFees: string;
  readonly newsEmergencyScore: string;
}

export interface RiskResult {
  readonly approved: boolean;
  readonly reasons: readonly string[];
  readonly notional: string | null;
  readonly estimatedDebit: string | null;
  readonly evaluatedAt: string;
}

function validLimits(limits: RiskLimits): boolean {
  const positive = [limits.maxPositionPerAgent, limits.maxPortfolioExposure, limits.maxOrderValue,
    limits.maxDailyLoss, limits.maxWeeklyLoss, limits.maxDrawdownBps, limits.maxSectorExposure,
    limits.maxCorrelatedExposure, limits.newsEmergencyThreshold];
  return positive.every(isPositiveAmount)
    && [limits.minCashReserve, limits.maxSlippageBps].every(isNonNegativeAmount)
    && decimal(limits.maxDrawdownBps).lte(10_000)
    && decimal(limits.newsEmergencyThreshold).lte(1)
    && [limits.maxOpenPositions, limits.maxOrdersPerMinute, limits.maxOrdersPerDay,
      limits.maxQuoteAgeMs, limits.maxBrokerSnapshotAgeMs].every((value) => isShareQuantity(value))
    && isShareQuantity(limits.maxClockSkewMs, true);
}

function validSnapshot(snapshot: RiskSnapshot): boolean {
  return [snapshot.cashAvailable, snapshot.agentCashAvailable, snapshot.equity,
    snapshot.portfolioExposure, snapshot.agentExposure, snapshot.sectorExposure,
    snapshot.correlatedExposure, snapshot.dailyLoss, snapshot.weeklyLoss, snapshot.drawdownBps].every(isNonNegativeAmount)
    && [snapshot.ownedQuantity, snapshot.reservedSellQuantity, snapshot.openPositions,
      snapshot.ordersLastMinute, snapshot.ordersToday].every((value) => isShareQuantity(value, true))
    && snapshot.reservedSellQuantity <= snapshot.ownedQuantity
    && decimal(snapshot.agentCashAvailable).lte(decimal(snapshot.cashAvailable))
    && decimal(snapshot.agentExposure).lte(decimal(snapshot.portfolioExposure))
    && decimal(snapshot.sectorExposure).lte(decimal(snapshot.portfolioExposure))
    && decimal(snapshot.correlatedExposure).lte(decimal(snapshot.portfolioExposure));
}

/** Pure pre-trade validation. Caller must hold the database lock through reservation/commit. */
export function evaluateTrade(proposal: TradeProposal, context: RiskContext): RiskResult {
  const reasons = new Set<string>();
  let notional: string | null = null;
  let estimatedDebit: string | null = null;
  const deny = (condition: boolean, reason: string) => { if (condition) reasons.add(reason); };
  const finish = (): RiskResult => ({ approved: reasons.size === 0, reasons: [...reasons], notional, estimatedDebit, evaluatedAt: context.now });

  deny(context.liveTradingEnabled !== true, "LIVE_DISABLED");
  deny(context.ownerMfaVerified !== true, "MFA_REQUIRED");
  deny(context.brokerHealthy !== true, "BROKER_UNHEALTHY");
  deny(context.reconciliationHealthy !== true, "RECONCILIATION_REQUIRED");
  deny(context.killSwitchActive !== false, "KILL_SWITCH");
  deny(context.circuitBreakerActive !== false, "CIRCUIT_BREAKER");
  deny(context.strategyApproved !== true, "STRATEGY_NOT_APPROVED");
  deny(context.cloudAuthorized !== true, "CLOUD_NOT_AUTHORIZED");
  deny(context.accountCashOnly !== true, "CASH_ACCOUNT_REQUIRED");
  deny(context.capabilitiesVerified !== true, "BROKER_CAPABILITIES_UNVERIFIED");
  deny(context.costModelVerified !== true, "COST_MODEL_UNVERIFIED");
  deny(context.corporateActionsVerified !== true, "CORPORATE_ACTION_REVIEW_REQUIRED");
  deny(context.session !== "OPEN", "MARKET_NOT_OPEN");

  try {
    if (!context.limits || !validLimits(context.limits)) { reasons.add("RISK_CONFIGURATION_REQUIRED"); return finish(); }
    const limits = context.limits;
    const now = timestamp(context.now);
    const checkAge = (value: string, maxAge: number, staleReason: string) => {
      const age = now - timestamp(value);
      deny(age < -limits.maxClockSkewMs, "FUTURE_TIMESTAMP");
      deny(age > maxAge, staleReason);
    };
    checkAge(context.sessionObservedAt, limits.maxQuoteAgeMs, "STALE_SESSION");
    checkAge(proposal.createdAt, limits.maxQuoteAgeMs, "STALE_PROPOSAL");
    checkAge(proposal.dataTimestamp, limits.maxQuoteAgeMs, "STALE_PROPOSAL_DATA");
    deny(timestamp(proposal.expiresAt) <= now || timestamp(proposal.expiresAt) <= timestamp(proposal.createdAt), "PROPOSAL_EXPIRED");
    deny(!proposal.id || !proposal.agentId || !proposal.strategyVersion || !proposal.reasoningSummary, "INVALID_PROPOSAL");
    deny(!/^[A-Z0-9]{4,16}$/.test(proposal.symbol), "INVALID_SYMBOL");
    deny(!context.authorizedSymbols.includes(proposal.symbol), "SYMBOL_NOT_AUTHORIZED");
    deny(proposal.side !== "BUY" && proposal.side !== "SELL", "INVALID_SIDE");
    deny(!isShareQuantity(proposal.quantity), "INVALID_QUANTITY");
    deny(!context.allowedOrderKinds.includes(proposal.kind), "UNSUPPORTED_ORDER_KIND");
    // A standalone STOP has no guaranteed execution-price bound in this initial cash-equity kernel.
    deny(proposal.kind !== "LIMIT" && proposal.kind !== "STOP_LIMIT", "UNBOUNDED_ORDER");
    deny(!isPositiveAmount(proposal.limitPrice), "INVALID_LIMIT_PRICE");
    if (!context.instrument) { reasons.add("INSTRUMENT_METADATA_REQUIRED"); return finish(); }
    const instrument = context.instrument;
    deny(instrument.symbol !== proposal.symbol || instrument.exchange !== "B3" || instrument.assetClass !== "EQUITY", "UNSUPPORTED_INSTRUMENT");
    deny(instrument.tradingEnabled !== true, "INSTRUMENT_NOT_TRADABLE");
    if (!isShareQuantity(instrument.lotSize) || !isPositiveAmount(instrument.priceTick)) {
      reasons.add("INVALID_INSTRUMENT_METADATA"); return finish();
    }
    deny(isShareQuantity(proposal.quantity) && proposal.quantity % instrument.lotSize !== 0, "INVALID_LOT_SIZE");
    if (isPositiveAmount(proposal.limitPrice)) deny(!decimal(proposal.limitPrice).mod(decimal(instrument.priceTick)).isZero(), "INVALID_PRICE_TICK");
    if (proposal.kind === "STOP_LIMIT") {
      deny(!isPositiveAmount(proposal.stopPrice), "INVALID_STOP_PRICE");
      if (isPositiveAmount(proposal.limitPrice) && isPositiveAmount(proposal.stopPrice)) {
        deny(!decimal(proposal.stopPrice).mod(decimal(instrument.priceTick)).isZero(), "INVALID_STOP_TICK");
        deny(proposal.side === "BUY" && decimal(proposal.limitPrice).lt(decimal(proposal.stopPrice)), "INVALID_STOP_LIMIT_RELATION");
        deny(proposal.side === "SELL" && decimal(proposal.limitPrice).gt(decimal(proposal.stopPrice)), "INVALID_STOP_LIMIT_RELATION");
      }
    } else deny(proposal.stopPrice !== null, "UNEXPECTED_STOP_PRICE");

    if (!context.quote) { reasons.add("QUOTE_REQUIRED"); return finish(); }
    const quote = context.quote;
    deny(quote.symbol !== proposal.symbol, "QUOTE_SYMBOL_MISMATCH");
    deny(quote.quality !== "REAL_TIME", "FEED_NOT_EXECUTABLE");
    deny(quote.halted !== false, "ASSET_HALTED_OR_UNKNOWN");
    checkAge(quote.observedAt, limits.maxQuoteAgeMs, "STALE_QUOTE");
    if (!isPositiveAmount(quote.bid) || !isPositiveAmount(quote.ask)) { reasons.add("INVALID_QUOTE"); return finish(); }
    deny(decimal(quote.bid).gt(decimal(quote.ask)), "CROSSED_QUOTE");

    if (!context.snapshot || !validSnapshot(context.snapshot)) { reasons.add("INVALID_BROKER_SNAPSHOT"); return finish(); }
    const snapshot = context.snapshot;
    deny(!context.accountId || snapshot.accountId !== context.accountId || snapshot.agentId !== proposal.agentId || snapshot.symbol !== proposal.symbol, "SNAPSHOT_IDENTITY_MISMATCH");
    checkAge(snapshot.observedAt, limits.maxBrokerSnapshotAgeMs, "STALE_BROKER_SNAPSHOT");
    deny(decimal(snapshot.portfolioExposure).gt(decimal(snapshot.equity)), "LEVERAGE_DETECTED");
    deny(decimal(snapshot.dailyLoss).gte(decimal(limits.maxDailyLoss)), "DAILY_LOSS_LIMIT");
    deny(decimal(snapshot.weeklyLoss).gte(decimal(limits.maxWeeklyLoss)), "WEEKLY_LOSS_LIMIT");
    deny(decimal(snapshot.drawdownBps).gte(decimal(limits.maxDrawdownBps)), "DRAWDOWN_LIMIT");
    deny(snapshot.ordersLastMinute >= limits.maxOrdersPerMinute, "MINUTE_ORDER_LIMIT");
    deny(snapshot.ordersToday >= limits.maxOrdersPerDay, "DAILY_ORDER_LIMIT");
    if (!isNonNegativeAmount(context.estimatedFees) || !isNonNegativeAmount(context.newsEmergencyScore) || decimal(context.newsEmergencyScore).gt(1)) {
      reasons.add("INVALID_COST_OR_NEWS_STATE"); return finish();
    }
    deny(decimal(context.newsEmergencyScore).gte(decimal(limits.newsEmergencyThreshold)), "NEWS_EMERGENCY");
    if (!isShareQuantity(proposal.quantity) || !isPositiveAmount(proposal.limitPrice)) return finish();

    const value = decimal(proposal.limitPrice).mul(proposal.quantity);
    const debit = value.plus(decimal(context.estimatedFees));
    notional = money(value);
    estimatedDebit = money(proposal.side === "BUY" ? debit : decimal(context.estimatedFees));
    deny(value.gt(decimal(limits.maxOrderValue)), "ORDER_VALUE_LIMIT");
    const reference = decimal(proposal.side === "BUY" ? quote.ask : quote.bid);
    const adverse = proposal.side === "BUY" ? decimal(proposal.limitPrice).minus(reference) : reference.minus(decimal(proposal.limitPrice));
    deny(adverse.div(reference).mul(10_000).gt(decimal(limits.maxSlippageBps)), "SLIPPAGE_LIMIT");

    if (proposal.side === "BUY") {
      deny(debit.gt(decimal(snapshot.cashAvailable)), "INSUFFICIENT_CASH");
      deny(debit.gt(decimal(snapshot.agentCashAvailable)), "INSUFFICIENT_AGENT_CASH");
      deny(decimal(snapshot.cashAvailable).minus(debit).lt(decimal(limits.minCashReserve)), "CASH_RESERVE_LIMIT");
      deny(decimal(snapshot.agentExposure).plus(value).gt(decimal(limits.maxPositionPerAgent)), "AGENT_EXPOSURE_LIMIT");
      deny(decimal(snapshot.portfolioExposure).plus(value).gt(decimal(limits.maxPortfolioExposure)), "PORTFOLIO_EXPOSURE_LIMIT");
      deny(decimal(snapshot.portfolioExposure).plus(debit).gt(decimal(snapshot.equity)), "LEVERAGE_FORBIDDEN");
      deny(decimal(snapshot.sectorExposure).plus(value).gt(decimal(limits.maxSectorExposure)), "SECTOR_EXPOSURE_LIMIT");
      deny(decimal(snapshot.correlatedExposure).plus(value).gt(decimal(limits.maxCorrelatedExposure)), "CORRELATED_EXPOSURE_LIMIT");
      deny(snapshot.ownedQuantity === 0 && snapshot.openPositions >= limits.maxOpenPositions, "OPEN_POSITION_LIMIT");
    } else {
      deny(proposal.quantity > snapshot.ownedQuantity - snapshot.reservedSellQuantity, "SHORT_SELLING_FORBIDDEN");
    }
  } catch {
    reasons.add("INVALID_INPUT");
  }
  return finish();
}
