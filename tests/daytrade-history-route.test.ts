import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/daytrade/history/route";

const mocks = vi.hoisted(() => ({ adminClient: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn(), order: vi.fn(), limit: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ adminClient: mocks.adminClient }));

const owner = "11000000-0000-4000-8000-000000000001";
const secret = "fixture-profitdll-secret";

function request(method: "GET" | "POST", body?: Record<string, unknown>, token = secret) {
  return new Request("https://atlas.example.test/api/daytrade/history", {
    method,
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    instrument: "WINZ26",
    sessionDay: "2026-10-30",
    tradeCount: 2,
    bars: [{
      bucketAt: "2026-10-30T09:00:00-03:00",
      open: 130000, high: 130000, low: 130000, close: 130000,
      volume: 2, turnover: 260000,
    }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T17:00:00-03:00"));
  vi.resetAllMocks();
  vi.stubEnv("ATLAS_OWNER_ID", owner);
  vi.stubEnv("PROFITDLL_INGEST_SECRET", secret);
  mocks.rpc.mockResolvedValue({ data: { status: "IMPORTED", bars: 1, trades: 2, sessionDay: "2026-10-30" }, error: null });
  mocks.limit.mockResolvedValue({ data: [], error: null });
  mocks.order.mockReturnValue({ limit: mocks.limit });
  mocks.lt.mockReturnValue({ order: mocks.order });
  mocks.gte.mockReturnValue({ lt: mocks.lt });
  mocks.eq.mockReturnValue({ eq: mocks.eq, gte: mocks.gte });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.adminClient.mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("DASH ProfitDLL historical import boundary", () => {
  it("requires the dedicated gateway secret before accessing history storage", async () => {
    const response = await GET(request("GET", undefined, ""));
    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a price outside the contract tick before calling the persistence RPC", async () => {
    const payload = sessionPayload({ bars: [{
      bucketAt: "2026-10-30T09:00:00-03:00",
      open: 130001, high: 130001, low: 130001, close: 130001,
      volume: 2, turnover: 260002,
    }] });
    const response = await POST(request("POST", payload));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("HISTORY_BAR_TICK_INVALID");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("validates and persists completed history through the transactional RPC", async () => {
    const response = await POST(request("POST", sessionPayload()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "IMPORTED", sessionDay: "2026-10-30" });
    expect(mocks.rpc).toHaveBeenCalledWith("dt_import_market_history", expect.objectContaining({
      p_owner_id: owner,
      p_instrument: "WINZ26",
      p_session_day: "2026-10-30",
      p_trade_count: 2,
      p_bars: [{
        bucket_at: "2026-10-30T09:00:00-03:00", open: 130000, high: 130000,
        low: 130000, close: 130000, volume: 2, turnover: 260000,
      }],
    }));
  });

  it("rejects timestamps outside the requested local trading session", async () => {
    const payload = sessionPayload({ bars: [{
      bucketAt: "2026-10-30T08:59:00-03:00",
      open: 130000, high: 130000, low: 130000, close: 130000,
      volume: 2, turnover: 260000,
    }] });
    const response = await POST(request("POST", payload));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("HISTORY_BAR_TIME_INVALID");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
