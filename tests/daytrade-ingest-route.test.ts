import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/daytrade/[resource]/route";
import type { DashConfig } from "@/core/daytrade/config";

const mocks = vi.hoisted(() => ({
  adminClient: vi.fn(),
  loadDashConfiguration: vi.fn(),
  recordHeartbeat: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ adminClient: mocks.adminClient }));
vi.mock("@/lib/daytrade/store", async (original) => ({
  ...await original<typeof import("@/lib/daytrade/store")>(),
  loadDashConfiguration: mocks.loadDashConfiguration,
  recordHeartbeat: mocks.recordHeartbeat,
}));

const owner = "11000000-0000-4000-8000-000000000001";
const config = {
  instruments: [{ id: "WIN", enabled: true, symbol: "WINZ26", verified: true, expiresOn: "2026-12-16", tickSize: 5, pointValue: 0.2, marginPerContract: null }],
  risk: { maxLossPerTrade: null, maxLossPerDay: null, maxExposure: null, maxOpenPositions: 1, maxContracts: 1, maxTradesPerDay: 3 },
  costs: { brokeragePerContract: null, exchangeFeesPerContract: null, verified: false, slippageTicks: 1 },
  data: { maxDelayMs: 2000, staleAfterMs: 10000 },
} as DashConfig;

function request(body: Record<string, unknown>) {
  return new Request("https://atlas.example.test/api/daytrade/quote", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer fixture-profitdll-secret",
    },
    body: JSON.stringify(body),
  });
}

function quote(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    provider: "PROFITDLL_DAYTRADE",
    instrument: "WINZ26",
    last: 125,
    bid: 120,
    ask: 125,
    exchangeAt: new Date(now - 500).toISOString(),
    receivedAt: new Date(now).toISOString(),
    sequence: 1,
    closedBars: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ATLAS_OWNER_ID", owner);
  vi.stubEnv("PROFITDLL_INGEST_SECRET", "fixture-profitdll-secret");
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async () => ({ error: null }),
  };
  mocks.from.mockReturnValue(query);
  mocks.adminClient.mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.recordHeartbeat.mockResolvedValue(undefined);
  mocks.loadDashConfiguration.mockResolvedValue({ config });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("DASH ProfitDLL quote ingestion boundary", () => {
  it("rejects requests without the dedicated gateway secret before config or database access", async () => {
    const unauthenticated = new Request("https://atlas.example.test/api/daytrade/quote", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(quote()),
    });
    const response = await POST(unauthenticated, { params: Promise.resolve({ resource: "quote" }) });
    expect(response.status).toBe(401);
    expect(mocks.loadDashConfiguration).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects prices outside the verified WIN tick before persisting anything", async () => {
    const response = await POST(request(quote({ last: 126 })), { params: Promise.resolve({ resource: "quote" }) });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("QUOTE_TICK_INVALID");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects delayed exchange data using the server clock", async () => {
    const response = await POST(request(quote({
      exchangeAt: new Date(Date.now() - 5000).toISOString(),
    })), { params: Promise.resolve({ resource: "quote" }) });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("QUOTE_STALE");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the gateway tick sequence so snapshots cannot bypass replay ordering", async () => {
    const payload = quote();
    delete (payload as Record<string, unknown>).sequence;
    const response = await POST(request(payload), { params: Promise.resolve({ resource: "quote" }) });
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes only validated quotes to the atomic sequence RPC and reports replay as conflict", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const payload = quote();
    const response = await POST(request(payload), { params: Promise.resolve({ resource: "quote" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("QUOTE_OUT_OF_ORDER");
    expect(mocks.rpc).toHaveBeenCalledWith("dt_accept_market_quote", expect.objectContaining({
      p_owner_id: owner,
      p_instrument: "WINZ26",
      p_provider: "PROFITDLL_DAYTRADE",
      p_sequence: 1,
      p_bars: [],
    }));
  });

  it("keeps the quote but excludes candles after the earlier contract expiry close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-16T18:01:10-03:00"));
    const now = Date.now();
    const response = await POST(request(quote({
      last: 130000, bid: 129995, ask: 130000,
      exchangeAt: new Date(now - 500).toISOString(), receivedAt: new Date(now).toISOString(),
      bar: {
        bucketAt: "2026-12-16T18:01:00-03:00",
        open: 130000, high: 130000, low: 130000, close: 130000, volume: 1, turnover: 130000,
      },
      closedBars: [{
        bucketAt: "2026-12-16T18:00:00-03:00",
        open: 130000, high: 130000, low: 130000, close: 130000, volume: 1, turnover: 130000,
      }],
    })), { params: Promise.resolve({ resource: "quote" }) });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("dt_accept_market_quote", expect.objectContaining({
      p_last: 130000,
      p_bars: [],
    }));
  });
});
