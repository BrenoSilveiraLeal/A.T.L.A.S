import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/daytrade/[resource]/route";

const mocks = vi.hoisted(() => ({
  adminClient: vi.fn(),
  loadDashConfiguration: vi.fn(),
  from: vi.fn(),
  queriedTables: [] as string[],
  overflow: true,
}));

vi.mock("@/lib/auth", async (original) => ({
  ...await original<typeof import("@/lib/auth")>(),
  requireOwner: vi.fn(async () => ({ user: { id: "11000000-0000-4000-8000-000000000001" } })),
}));
vi.mock("@/lib/supabase", () => ({ adminClient: mocks.adminClient }));
vi.mock("@/lib/daytrade/store", async (original) => ({
  ...await original<typeof import("@/lib/daytrade/store")>(),
  loadDashConfiguration: mocks.loadDashConfiguration,
}));

const bar = { bucket_at: "2026-11-02T09:00:00-03:00", open: 130000, high: 130005, low: 129995, close: 130000, volume: 1, turnover: 130000 };

function queryFor() {
  let from = 0;
  const query = {
    select: () => query,
    eq: () => query,
    lt: () => query,
    order: () => query,
    range: (start: number) => { from = start; return query; },
    then: (resolve: (value: { data: typeof bar[]; error: null }) => unknown) => {
      const data = from === 20_000 ? (mocks.overflow ? [bar] : []) : Array.from({ length: 1000 }, () => bar);
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return query;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.overflow = true;
  mocks.queriedTables = [];
  mocks.loadDashConfiguration.mockResolvedValue({ config: {
    instruments: [{ id: "WIN", enabled: true, symbol: "WINZ26", verified: true, pointValue: 0.2, tickSize: 5, marginPerContract: 1000 }],
    costs: { verified: false, brokeragePerContract: null, exchangeFeesPerContract: null, slippageTicks: 1 },
  } });
  mocks.from.mockImplementation((table: string) => {
    mocks.queriedTables.push(table);
    return queryFor();
  });
  mocks.adminClient.mockReturnValue({ from: mocks.from });
});

async function getBacktest() {
  return GET(new Request("https://atlas.example.test/api/daytrade/backtest"), {
    params: Promise.resolve({ resource: "backtest" }),
  });
}

describe("DASH walk-forward history limit", () => {
  it("refuses a partial sample when any completed row exists past the 20,000-bar cap", async () => {
    const response = await getBacktest();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "DATASET_TOO_LARGE", maximumBars: 20_000, researchOnly: true });
    expect(mocks.queriedTables).toEqual(Array(21).fill("dt_market_bars"));
    expect(mocks.queriedTables).not.toContain("dt_market_history_sessions");
  });

  it("allows exactly 20,000 rows to continue through the normal readiness checks", async () => {
    mocks.overflow = false;
    const response = await getBacktest();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "COSTS_NOT_CONFIGURED", researchOnly: true });
    expect(mocks.queriedTables).toEqual(Array(21).fill("dt_market_bars"));
  });
});
