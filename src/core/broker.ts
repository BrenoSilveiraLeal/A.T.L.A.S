import type { DecimalString } from "./money";

export type OrderSide = "BUY" | "SELL";
export type OrderKind = "LIMIT" | "STOP" | "STOP_LIMIT";
export type MarketSession =
  | "OPEN"
  | "CLOSED"
  | "AUCTION"
  | "CIRCUIT_BREAKER"
  | "UNKNOWN";
export type QuoteQuality =
  | "REAL_TIME"
  | "DELAYED"
  | "EOD"
  | "STALE"
  | "UNKNOWN";

export interface BrokerCapabilities {
  readonly providerId: string;
  readonly documentationUrl: string;
  readonly verifiedAt: string;
  readonly cashEquities: boolean;
  readonly overnight: boolean;
  readonly fractionalLots: boolean;
  readonly orderKinds: readonly OrderKind[];
  readonly clientOrderLookup: boolean;
  readonly nativeIdempotency: boolean;
  readonly completeAccountReconciliation: boolean;
  readonly cloudAuthorized: boolean;
}

export interface BrokerAccount {
  readonly accountId: string;
  readonly currency: "BRL";
  readonly mode: "REAL" | "OFFICIAL_SANDBOX";
  readonly cashOnly: boolean;
  readonly observedAt: string;
}

export interface BrokerCash {
  readonly settled: DecimalString;
  readonly available: DecimalString;
  readonly reserved: DecimalString;
  readonly pendingSettlement: DecimalString;
  readonly observedAt: string;
}

export interface BrokerPosition {
  readonly symbol: string;
  readonly quantity: number;
  readonly averagePrice: DecimalString;
  readonly observedAt: string;
}

export interface BrokerOrderRequest {
  readonly clientOrderId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly kind: OrderKind;
  readonly limitPrice: DecimalString | null;
  readonly stopPrice: DecimalString | null;
  readonly timeInForce: "DAY" | "GTC";
}

export interface BrokerOrder {
  /** Official gateway echo of accepted terms; mandatory to confirm a modification. */
  readonly request?: BrokerOrderRequest;
  readonly brokerOrderId: string;
  readonly clientOrderId: string | null;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly filledQuantity: number;
  readonly status:
    | "PENDING"
    | "OPEN"
    | "PARTIALLY_FILLED"
    | "FILLED"
    | "CANCELLED"
    | "REJECTED"
    | "EXPIRED"
    | "UNKNOWN";
  readonly observedAt: string;
}

export interface BrokerExecution {
  readonly executionId: string;
  readonly brokerOrderId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly price: DecimalString;
  readonly fees: DecimalString;
  /** False for provisional terminal charges; never post these as final fees. */
  readonly feesVerified?: boolean;
  readonly executedAt: string;
}

/**
 * Adapter contract only. An adapter is admitted after provider/owner authorization.
 * Implementations must exhaust pagination for snapshots and use execution cursors.
 * placeOrder timeouts are ambiguous; never retry blindly. Query first, quarantine if unknown.
 */
export interface BrokerProvider {
  readonly capabilities: BrokerCapabilities;
  connect(): Promise<void>;
  healthCheck(): Promise<{
    healthy: boolean;
    observedAt: string;
    reason: string | null;
  }>;
  getAccount(): Promise<BrokerAccount>;
  getCash(): Promise<BrokerCash>;
  getPositions(): Promise<readonly BrokerPosition[]>;
  getOrders(): Promise<readonly BrokerOrder[]>;
  getOrder(brokerOrderId: string): Promise<BrokerOrder | null>;
  getOrderByClientId(clientOrderId: string): Promise<BrokerOrder | null>;
  placeOrder(request: BrokerOrderRequest): Promise<BrokerOrder>;
  modifyOrder(
    brokerOrderId: string,
    changes: Pick<BrokerOrderRequest, "quantity" | "limitPrice" | "stopPrice">,
    idempotencyKey: string,
  ): Promise<BrokerOrder>;
  cancelOrder(
    brokerOrderId: string,
    idempotencyKey: string,
  ): Promise<BrokerOrder>;
  getExecutions(
    cursor: string | null,
  ): Promise<{
    executions: readonly BrokerExecution[];
    nextCursor: string | null;
  }>;
}
