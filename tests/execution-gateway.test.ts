import { describe, expect, it, vi } from "vitest";
import { HttpExecutionGateway, validateGatewayConnection } from "../src/providers/execution-gateway";
import type { GatewayConnection } from "../src/providers/execution-gateway";
import type { BrokerOrderRequest } from "../src/core/broker";

// Test-only transport; the production adapter has no synthesized account data.
const NOW = "2026-09-16T14:00:00Z";
const config: GatewayConnection = { url: "http://127.0.0.1:8787", token: "test-only-token-with-at-least-32-characters",
  expectedAccountId: "account-1", expectedProviderId: "gateway-1", timeoutMs: 100 };
const capabilities = { providerId: "gateway-1", documentationUrl: "https://example.test/docs", verifiedAt: NOW,
  cashEquities: true, overnight: false, fractionalLots: true, orderKinds: ["LIMIT", "STOP_LIMIT"],
  clientOrderLookup: true, nativeIdempotency: true, completeAccountReconciliation: true, cloudAuthorized: false };
const account = { accountId: "account-1", currency: "BRL", mode: "REAL", cashOnly: true, observedAt: NOW };
const request: BrokerOrderRequest = { clientOrderId: "client-1", accountId: "account-1", symbol: "TEST3", side: "BUY",
  quantity: 2, kind: "LIMIT", limitPrice: "100", stopPrice: null, timeInForce: "DAY" };
const order = { brokerOrderId: "broker-1", clientOrderId: "client-1", accountId: "account-1", symbol: "TEST3",
  side: "BUY", quantity: 2, filledQuantity: 0, status: "OPEN", observedAt: NOW, request };
function transport(overrides: Record<string, unknown> = {}) {
  const payloads: Record<string, unknown> = { capabilities, account, submit: order, order, orderByClientId: order,
    orders: [order], modify: order, cancel: { ...order, status: "CANCELLED" },
    executions: { executions: [], nextCursor: null }, ...overrides };
  return vi.fn<typeof fetch>(async (_input, init) => {
    const rpc = JSON.parse(String(init?.body)) as { method: string };
    return Response.json(payloads[rpc.method]);
  });
}

describe("gateway server configuration", () => {
  it.each(["http://127.0.0.1:8787", "http://[::1]:8787", "https://gateway.example.test"])(
    "accepts authenticated configured endpoint %s", (url) => {
      expect(validateGatewayConnection({ ...config, url }).origin).toBe(new URL(url).origin);
    });
  it.each(["http://gateway.example.test", "http://localhost:8787", "ftp://127.0.0.1", "https://user:pass@gateway.example.test",
    "https://gateway.example.test/path", "https://gateway.example.test/?token=secret", "https://gateway.example.test/#token"])(
    "rejects unsafe gateway URL %s", (url) => {
      expect(() => validateGatewayConnection({ ...config, url })).toThrow();
    });
  it.each([{ token: "short" }, { expectedAccountId: "" }, { expectedProviderId: "" }, { timeoutMs: 99 },
    { timeoutMs: 15_001 }, { timeoutMs: 100.5 }])("rejects invalid credential/identity/timeout configuration %j", (patch) => {
      expect(() => validateGatewayConnection({ ...config, ...patch })).toThrow("INVALID_GATEWAY_CONFIGURATION");
    });
});

describe("gateway RPC adapter", () => {
  it("verifies provider and account before issuing correctly scoped authenticated RPC", async () => {
    const send = transport(); const gateway = await HttpExecutionGateway.connect(config, send);
    await gateway.placeOrder(request);
    expect(send).toHaveBeenCalledTimes(3);
    const [url, options] = send.mock.calls[2];
    expect(String(url)).toBe("http://127.0.0.1:8787/rpc");
    expect(options).toMatchObject({ method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toEqual({ version: 1, accountId: "account-1", method: "submit",
      params: { request, idempotencyKey: "client-1" } });
  });
  it("refuses a different provider or account in handshake", async () => {
    await expect(HttpExecutionGateway.connect(config, transport({ capabilities: { ...capabilities, providerId: "other" } }))).rejects.toThrow("GATEWAY_PROVIDER_MISMATCH");
    await expect(HttpExecutionGateway.connect(config, transport({ account: { ...account, accountId: "other" } }))).rejects.toThrow("GATEWAY_ACCOUNT_MISMATCH");
  });
  it("requires explicit capabilities and strict account schema", async () => {
    const missing: Record<string, unknown> = { ...capabilities }; delete missing.clientOrderLookup;
    await expect(HttpExecutionGateway.connect(config, transport({ capabilities: missing }))).rejects.toThrow("INVALID_GATEWAY_RESPONSE");
    await expect(HttpExecutionGateway.connect(config, transport({ account: { ...account, currency: "USD" } }))).rejects.toThrow("INVALID_GATEWAY_RESPONSE");
    await expect(HttpExecutionGateway.connect(config, transport({ account: { ...account, balance: "999" } }))).rejects.toThrow("INVALID_GATEWAY_RESPONSE");
  });
  it("rejects cross-account requests before transport and cross-account results", async () => {
    const send = transport(); const gateway = await HttpExecutionGateway.connect(config, send);
    await expect(gateway.placeOrder({ ...request, accountId: "other" })).rejects.toThrow("GATEWAY_ACCOUNT_MISMATCH");
    expect(send).toHaveBeenCalledTimes(2);
    const crossAccount = await HttpExecutionGateway.connect(config, transport({ orders: [{ ...order, accountId: "other" }] }));
    await expect(crossAccount.getOrders()).rejects.toThrow("GATEWAY_ACCOUNT_MISMATCH");
  });
  it("requires the exact queried broker/client identity and distinguishes absence", async () => {
    const gateway = await HttpExecutionGateway.connect(config, transport());
    await expect(gateway.getOrder("other")).rejects.toThrow("GATEWAY_ORDER_MISMATCH");
    await expect(gateway.getOrderByClientId("other")).rejects.toThrow("GATEWAY_ORDER_MISMATCH");
    const absent = await HttpExecutionGateway.connect(config, transport({ order: null, orderByClientId: null }));
    expect(await absent.getOrder("missing")).toBeNull(); expect(await absent.getOrderByClientId("missing")).toBeNull();
  });
  it.each([{ quantity: 0 }, { quantity: 1.5 }, { filledQuantity: 3 }, { observedAt: "not-a-date" },
    { status: "SUCCESS" }, { extra: "unexpected" }])("refuses malformed broker order evidence %j", async (patch) => {
      const gateway = await HttpExecutionGateway.connect(config, transport({ submit: { ...order, ...patch } }));
      await expect(gateway.placeOrder(request)).rejects.toThrow("INVALID_GATEWAY_RESPONSE");
    });
  it("submits a mutation once on timeout/transport error and returns no manufactured outcome", async () => {
    const send = transport(); const gateway = await HttpExecutionGateway.connect(config, send);
    send.mockRejectedValueOnce(new Error("transport-disconnected"));
    await expect(gateway.placeOrder(request)).rejects.toThrow("transport-disconnected");
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("submits a mutation once on HTTP failure and sanitizes arbitrary server error text", async () => {
    const send = transport(); const gateway = await HttpExecutionGateway.connect(config, send);
    send.mockResolvedValueOnce(Response.json({ code: "error includes bearer secret" }, { status: 500 }));
    await expect(gateway.placeOrder(request)).rejects.toThrow("GATEWAY_UNAVAILABLE");
    expect(send).toHaveBeenCalledTimes(3);
    send.mockResolvedValueOnce(Response.json({ code: "ACCOUNT_NOT_AUTHORIZED" }, { status: 403 }));
    await expect(gateway.placeOrder(request)).rejects.toThrow("ACCOUNT_NOT_AUTHORIZED");
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("rejects malformed/empty/oversized bodies without retrying", async () => {
    const send = transport(); const gateway = await HttpExecutionGateway.connect(config, send);
    send.mockResolvedValueOnce(new Response("<html>proxy error</html>"));
    await expect(gateway.getOrders()).rejects.toThrow("INVALID_GATEWAY_RESPONSE");
    send.mockResolvedValueOnce(new Response(null));
    await expect(gateway.getOrders()).rejects.toThrow("EMPTY_GATEWAY_RESPONSE");
    send.mockResolvedValueOnce(new Response("x".repeat(2_000_001)));
    await expect(gateway.getOrders()).rejects.toThrow("GATEWAY_RESPONSE_TOO_LARGE");
    expect(send).toHaveBeenCalledTimes(5);
  });
  it("preserves execution paging and rejects cross-account fill events", async () => {
    const execution = { executionId: "fill-1", brokerOrderId: "broker-1", accountId: "account-1", symbol: "TEST3",
      side: "BUY", quantity: 1, price: "100", fees: "0.5", executedAt: NOW };
    const send = transport({ executions: { executions: [execution], nextCursor: "cursor-2" } });
    const gateway = await HttpExecutionGateway.connect(config, send);
    expect(await gateway.getExecutions("cursor-1")).toEqual({ executions: [execution], nextCursor: "cursor-2" });
    expect(JSON.parse(String(send.mock.calls[2][1]?.body)).params).toEqual({ cursor: "cursor-1" });
    send.mockResolvedValueOnce(Response.json({ executions: [{ ...execution, accountId: "other" }], nextCursor: null }));
    await expect(gateway.getExecutions(null)).rejects.toThrow("GATEWAY_ACCOUNT_MISMATCH");
  });
  it("rejects malformed modifications before transport and mismatched returned order IDs", async () => {
    const send = transport(); const gateway = await HttpExecutionGateway.connect(config, send);
    for (const quantity of [0, 0.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(gateway.modifyOrder("broker-1", { quantity, limitPrice: "100", stopPrice: null }, "modify-1")).rejects.toThrow();
    for (const limitPrice of ["01", "1e2", "0.123456789", "9999999999999999999"])
      await expect(gateway.modifyOrder("broker-1", { quantity: 2, limitPrice, stopPrice: null }, "modify-1")).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
    await expect(gateway.modifyOrder("other", { quantity: 2, limitPrice: "100", stopPrice: null }, "modify-1")).rejects.toThrow("GATEWAY_ORDER_MISMATCH");
    await expect(gateway.cancelOrder("other", "cancel-1")).rejects.toThrow("GATEWAY_ORDER_MISMATCH");
  });
});
