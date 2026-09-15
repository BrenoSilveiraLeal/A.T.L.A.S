import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScheduler } from "@/lib/scheduler";
import { OBSERVATION_DEFINITION } from "@/core/strategy-config";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), health: vi.fn(), quote: vi.fn(), history: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ adminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/data", () => ({
  readQuote: mocks.quote, readHistory: mocks.history,
  readNews: async () => [], readMacro: async () => [],
}));

const owner = "11000000-0000-4000-8000-000000000001";
const agent = "22000000-0000-4000-8000-000000000001";
const asset = "33000000-0000-4000-8000-000000000001";
const strategy = "44000000-0000-4000-8000-000000000001";
const version = "55000000-0000-4000-8000-000000000001";
const profile = "66000000-0000-4000-8000-000000000001";
const job = { job_id: "77000000-0000-4000-8000-000000000001", agent_id: agent, lease_token: "88000000-0000-4000-8000-000000000001" };
const limits = {
  maxPositionPerAgent: "1000", maxPortfolioExposure: "2000", maxOrderValue: "500",
  maxDailyLoss: "100", maxWeeklyLoss: "200", maxDrawdownBps: "500", minCashReserve: "100",
  maxOpenPositions: 2, maxSectorExposure: "1000", maxCorrelatedExposure: "1000",
  maxOrdersPerMinute: 1, maxOrdersPerDay: 4, maxSlippageBps: "5", newsEmergencyThreshold: "0.8",
  maxQuoteAgeMs: 1000, maxBrokerSnapshotAgeMs: 1000, maxClockSkewMs: 100,
};
let agentConfiguration: Record<string, unknown>;
let strategyDefinition: object;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
  vi.stubEnv("ATLAS_OWNER_ID", owner);
  agentConfiguration = { strategy_id: strategy, strategy_version_id: version, risk_profile_id: profile };
  strategyDefinition = OBSERVATION_DEFINITION;
  mocks.health.mockResolvedValue({ error: null });
  mocks.from.mockImplementation((table: string) => {
    let columns: string;
    const query = {
      select: (value: string) => { columns = value; return query; },
      eq: () => query,
      upsert: mocks.health,
      single: async () => ({ data:
        table === "agents" ? columns === "asset_id" ? { asset_id: asset } : agentConfiguration :
        table === "assets" ? { id: asset, ticker: "TEST3" } :
        table === "strategy_versions" ? { id: version, strategy_id: strategy, version: "3", definition: strategyDefinition } :
        { id: profile, name: "Fixture risk", version: 2, limits, configured: true }, error: null }),
    };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_due_agents" ? [job] : name === "finish_agent_analysis" ? "decision-fixture" : true, error: null }));
  mocks.quote.mockResolvedValue({ ticker: "TEST3", price: "20", currency: "BRL", dataTimestamp: "2026-09-15T11:59:00Z", retrievedAt: "2026-09-15T12:00:00Z", source: "https://example.test/quote", feed: "DELAYED", freshness: "DELAYED", ageSeconds: 60, tradable: false });
  mocks.history.mockResolvedValue({ ticker: "TEST3", interval: "1d", range: "3mo", retrievedAt: "2026-09-15T12:00:00Z", source: "https://example.test/history", feed: "EOD", tradable: false, bars: [] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("scheduler pinned configuration integration", () => {
  it("persists the selected immutable version and risk limits alongside a HOLD decision", async () => {
    const result = await runScheduler();
    expect(result.jobs[0]).toMatchObject({ status: "SUCCEEDED" });
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "finish_agent_analysis")![1];
    expect(commit).toMatchObject({
      p_owner_id: owner, p_job_id: job.job_id, p_lease_token: job.lease_token,
      p_result: { decision: "HOLD", suggestedQuantity: 0, suggestedOrderType: null, risk: { approved: false } },
      p_inputs: { configuration: {
        strategyId: strategy, versionId: version, version: "3", definition: OBSERVATION_DEFINITION,
        riskProfileId: profile, riskProfileVersion: 2, riskLimits: limits,
      } },
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("complete_agent_job", expect.anything());
  });

  it("identifies the existing unconfigured observer with null configuration evidence", async () => {
    agentConfiguration = { strategy_id: null, strategy_version_id: null, risk_profile_id: null };
    expect((await runScheduler()).jobs[0]).toMatchObject({ status: "SUCCEEDED" });
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "finish_agent_analysis")![1];
    expect(commit.p_inputs.configuration).toBeNull();
    expect(commit.p_result.decision).toBe("HOLD");
  });

  it.each(["partial", "unknown-engine"])("fails a %s configuration before consuming quote/history provider budget", async (condition) => {
    if (condition === "partial") agentConfiguration.strategy_version_id = null;
    else strategyDefinition = { ...OBSERVATION_DEFINITION, engine: "unregistered/2.0.0" };
    expect((await runScheduler()).jobs[0]).toMatchObject({ status: "FAILED", code: "ANALYSIS_FAILED", statePersisted: true });
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "finish_agent_analysis")).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_agent_job", {
      p_owner_id: owner, p_job_id: job.job_id, p_lease_token: job.lease_token, p_status: "FAILED", p_error: "ANALYSIS_FAILED",
    });
  });
});
