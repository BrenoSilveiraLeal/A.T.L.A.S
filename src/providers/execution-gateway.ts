import "server-only";
import { z } from "zod";
import type {
  BrokerAccount, BrokerCapabilities, BrokerCash, BrokerExecution, BrokerOrder,
  BrokerOrderRequest, BrokerPosition, BrokerProvider,
} from "@/core/broker";

/** The wire contract belongs to ATLAS, not to a particular terminal or broker. */
export type ExecutionGatewayKind = "MT5" | "PROFIT_DLL" | "OFFICIAL_BROKER_API";
const id = z.string().trim().min(1).max(200);
const amount = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,8})?$/);
const at = z.iso.datetime({ offset: true });
const qty = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const requestSchema = z.object({
  clientOrderId: id, accountId: id, symbol: id, side: z.enum(["BUY", "SELL"]),
  quantity: qty.positive(), kind: z.enum(["LIMIT", "STOP", "STOP_LIMIT"]),
  limitPrice: amount.nullable(), stopPrice: amount.nullable(), timeInForce: z.enum(["DAY", "GTC"]),
}).strict();
const orderSchema = z.object({
  brokerOrderId: id, clientOrderId: id.nullable(), accountId: id, symbol: id,
  side: z.enum(["BUY", "SELL"]), quantity: qty.positive(), filledQuantity: qty,
  status: z.enum(["PENDING", "OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED", "UNKNOWN"]),
  observedAt: at, request: requestSchema.optional(),
}).strict().refine((o) => o.filledQuantity <= o.quantity);
const capabilitiesSchema = z.object({
  providerId: id, documentationUrl: z.url({ protocol: /^https$/ }), verifiedAt: at,
  cashEquities: z.boolean(), overnight: z.boolean(), fractionalLots: z.boolean(),
  orderKinds: z.array(z.enum(["LIMIT", "STOP", "STOP_LIMIT"])),
  clientOrderLookup: z.boolean(), nativeIdempotency: z.boolean(),
  completeAccountReconciliation: z.boolean(), cloudAuthorized: z.boolean(),
}).strict();
const executionSchema = z.object({
  executionId: id, brokerOrderId: id, accountId: id, symbol: id,
  side: z.enum(["BUY", "SELL"]), quantity: qty.positive(), price: amount,
  fees: amount, feesVerified: z.boolean().optional(), executedAt: at,
}).strict();

export class GatewayError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GatewayError"; }
}

export interface GatewayConnection {
  url: string;
  token: string;
  expectedAccountId: string;
  expectedProviderId: string;
  timeoutMs?: number;
}

/** No redirects, URL credentials or arbitrary URLs supplied by an agent/browser. */
export function validateGatewayConnection(config: GatewayConnection): URL {
  const url = new URL(config.url);
  const local = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      config.token.length < 32 || !id.safeParse(config.expectedAccountId).success ||
      !id.safeParse(config.expectedProviderId).success ||
      !Number.isInteger(config.timeoutMs ?? 8000) || (config.timeoutMs ?? 8000) < 100 || (config.timeoutMs ?? 8000) > 15000)
    throw new GatewayError("INVALID_GATEWAY_CONFIGURATION");
  return url;
}

export class HttpExecutionGateway implements BrokerProvider {
  private constructor(
    readonly capabilities: BrokerCapabilities,
    private readonly config: GatewayConnection,
    private readonly transport: typeof fetch,
  ) {}

  static async connect(config: GatewayConnection, transport: typeof fetch = fetch) {
    validateGatewayConnection(config);
    const capabilities = await rpc(config, transport, "capabilities", {}, capabilitiesSchema);
    if (capabilities.providerId !== config.expectedProviderId) throw new GatewayError("GATEWAY_PROVIDER_MISMATCH");
    const gateway = new HttpExecutionGateway(capabilities, config, transport);
    await gateway.connect();
    return gateway;
  }

  private call<T>(method: string, params: unknown, schema: z.ZodType<T>) {
    return rpc(this.config, this.transport, method, params, schema);
  }
  private account<T extends { accountId: string }>(value: T): T {
    if (value.accountId !== this.config.expectedAccountId) throw new GatewayError("GATEWAY_ACCOUNT_MISMATCH");
    return value;
  }
  async connect(): Promise<void> { await this.getAccount(); }
  healthCheck() {
    return this.call("health", {}, z.object({ healthy: z.boolean(), observedAt: at, reason: id.nullable() }).strict());
  }
  async getAccount(): Promise<BrokerAccount> {
    return this.account(await this.call("account", {}, z.object({
      accountId: id, currency: z.literal("BRL"), mode: z.enum(["REAL", "OFFICIAL_SANDBOX"]),
      cashOnly: z.boolean(), observedAt: at,
    }).strict()));
  }
  getCash(): Promise<BrokerCash> {
    return this.call("cash", {}, z.object({ settled: amount, available: amount, reserved: amount, pendingSettlement: amount, observedAt: at }).strict());
  }
  getPositions(): Promise<readonly BrokerPosition[]> {
    return this.call("positions", {}, z.array(z.object({ symbol: id, quantity: qty, averagePrice: amount, observedAt: at }).strict()));
  }
  async getOrders(): Promise<readonly BrokerOrder[]> {
    return (await this.call("orders", {}, z.array(orderSchema))).map((o) => this.account(o));
  }
  async getOrder(brokerOrderId: string): Promise<BrokerOrder | null> {
    const value = await this.call("order", { brokerOrderId: id.parse(brokerOrderId) }, orderSchema.nullable());
    if (value && value.brokerOrderId !== brokerOrderId) throw new GatewayError("GATEWAY_ORDER_MISMATCH");
    return value ? this.account(value) : null;
  }
  async getOrderByClientId(clientOrderId: string): Promise<BrokerOrder | null> {
    const value = await this.call("orderByClientId", { clientOrderId: id.parse(clientOrderId) }, orderSchema.nullable());
    if (value && value.clientOrderId !== clientOrderId) throw new GatewayError("GATEWAY_ORDER_MISMATCH");
    return value ? this.account(value) : null;
  }
  async placeOrder(request: BrokerOrderRequest): Promise<BrokerOrder> {
    this.account(request);
    return this.account(await this.call("submit", { request: requestSchema.parse(request), idempotencyKey: request.clientOrderId }, orderSchema));
  }
  async modifyOrder(brokerOrderId: string, changes: Pick<BrokerOrderRequest, "quantity" | "limitPrice" | "stopPrice">, idempotencyKey: string): Promise<BrokerOrder> {
    const terms = z.object({ quantity: qty.positive(), limitPrice: amount.nullable(), stopPrice: amount.nullable() }).strict().parse(changes);
    const result = this.account(await this.call("modify", { brokerOrderId: id.parse(brokerOrderId), changes: terms, idempotencyKey: id.parse(idempotencyKey) }, orderSchema));
    if (result.brokerOrderId !== brokerOrderId) throw new GatewayError("GATEWAY_ORDER_MISMATCH");
    return result;
  }
  async cancelOrder(brokerOrderId: string, idempotencyKey: string): Promise<BrokerOrder> {
    const result = this.account(await this.call("cancel", { brokerOrderId: id.parse(brokerOrderId), idempotencyKey: id.parse(idempotencyKey) }, orderSchema));
    if (result.brokerOrderId !== brokerOrderId) throw new GatewayError("GATEWAY_ORDER_MISMATCH");
    return result;
  }
  async getExecutions(cursor: string | null): Promise<{ executions: readonly BrokerExecution[]; nextCursor: string | null }> {
    const result = await this.call("executions", { cursor }, z.object({ executions: z.array(executionSchema), nextCursor: z.string().max(1000).nullable() }).strict());
    return { ...result, executions: result.executions.map((e) => this.account(e)) };
  }
}

async function rpc<T>(config: GatewayConnection, transport: typeof fetch, method: string, params: unknown, schema: z.ZodType<T>): Promise<T> {
  const endpoint = new URL("rpc", validateGatewayConnection(config));
  // Mutations are deliberately sent ONCE. Timeout and malformed replies remain ambiguous.
  const response = await transport(endpoint, {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, accountId: config.expectedAccountId, method, params }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 8000),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new GatewayError("EMPTY_GATEWAY_RESPONSE");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) { await reader.cancel(); throw new GatewayError("GATEWAY_RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  let result: unknown;
  try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new GatewayError("INVALID_GATEWAY_RESPONSE"); }
  if (!response.ok) {
    const failure = z.object({ code: z.string().regex(/^[A-Z0-9_]{1,80}$/) }).safeParse(result);
    throw new GatewayError(failure.success ? failure.data.code : "GATEWAY_UNAVAILABLE");
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new GatewayError("INVALID_GATEWAY_RESPONSE");
  return parsed.data;
}
