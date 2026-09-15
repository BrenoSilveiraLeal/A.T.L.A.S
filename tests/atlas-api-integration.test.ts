import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/atlas/[resource]/route";
import { ApiError } from "@/lib/auth";
import { OBSERVATION_DEFINITION } from "@/core/strategy-config";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  adminClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...await original<typeof import("@/lib/auth")>(),
  requireOwner: mocks.requireOwner,
}));
vi.mock("@/lib/supabase", () => ({ adminClient: mocks.adminClient }));

const owner = "11000000-0000-4000-8000-000000000001";
const account = "22000000-0000-4000-8000-000000000001";
const emptyPortfolio = {
  brokerAccounts: [], brokerAccountId: null, snapshots: [], positions: [],
  historyTruncated: false, positionsTruncated: false,
};

function context(resource: string) {
  return { params: Promise.resolve({ resource }) };
}
function postRequest(body: unknown, origin = "https://atlas.example.test") {
  return new Request("https://atlas.example.test/api/atlas/strategies", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ATLAS_APP_URL", "https://atlas.example.test");
  const query = { select: () => query, order: () => query, limit: mocks.limit };
  mocks.from.mockReturnValue(query);
  mocks.limit.mockResolvedValue({ data: [], error: null });
  mocks.adminClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.requireOwner.mockResolvedValue({ db: { from: mocks.from }, user: { id: owner } });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "get_portfolio_history" ? emptyPortfolio : true, error: null,
  }));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("authenticated ATLAS configuration and portfolio routes", () => {
  it("loads an empty real portfolio through the service RPC with the authenticated owner", async () => {
    const response = await GET(new Request("https://atlas.example.test/api/atlas/portfolio-history"), context("portfolio-history"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emptyPortfolio);
    expect(mocks.requireOwner).toHaveBeenCalledWith();
    expect(mocks.rpc).toHaveBeenCalledWith("get_portfolio_history", {
      p_owner_id: owner, p_broker_account_id: null, p_limit: 200,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("passes a selected account without taking an owner identity from query parameters", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...emptyPortfolio, brokerAccounts: [{ id: account, provider: "Fixture" }], brokerAccountId: account }, error: null });
    const response = await GET(new Request(`https://atlas.example.test/api/atlas/portfolio-history?accountId=${account}&ownerId=${account}`), context("portfolio-history"));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("get_portfolio_history", {
      p_owner_id: owner, p_broker_account_id: account, p_limit: 200,
    });
  });

  it("rejects malformed account identities before accessing the privileged RPC", async () => {
    const response = await GET(new Request("https://atlas.example.test/api/atlas/portfolio-history?accountId=invalid"), context("portfolio-history"));
    expect(response.status).toBe(400);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it.each(["portfolio-history", "strategies", "strategy-versions"])("requires AAL2 before serving %s", async (resource) => {
    mocks.requireOwner.mockRejectedValue(new ApiError(403, "MFA_REQUIRED", "Confirme o segundo fator."));
    const response = await GET(new Request(`https://atlas.example.test/api/atlas/${resource}`), context(resource));
    expect(response.status).toBe(403);
    expect(mocks.adminClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([["strategies", "strategies"], ["strategy-versions", "strategy_versions"]])("reads %s through the owner's RLS session", async (resource, table) => {
    const response = await GET(new Request(`https://atlas.example.test/api/atlas/${resource}`), context(resource));
    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith(table);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it("publishes only the supported observation definition after consuming the mutation rate limit", async () => {
    const response = await POST(postRequest({ name: "Observer fixture", description: "", definition: OBSERVATION_DEFINITION }), context("strategies"));
    expect(response.status).toBe(201);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["consume_rate_limit", "publish_observation_strategy"]);
    expect(mocks.rpc).toHaveBeenCalledWith("publish_observation_strategy", {
      p_owner_id: owner, p_strategy_id: null, p_name: "Observer fixture", p_description: "", p_definition: OBSERVATION_DEFINITION,
    });
  });

  it.each(["strategies", "agent-config"])("rejects unsafe input to %s before its configuration mutation", async (resource) => {
    const response = await POST(postRequest({ ownerId: account, live: true }), context(resource));
    expect(response.status).toBe(400);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["consume_rate_limit"]);
  });

  it.each(["strategies", "agent-config"])("blocks foreign origins for %s before authentication and database access", async (resource) => {
    const response = await POST(postRequest({}, "https://attacker.example.test"), context(resource));
    expect(response.status).toBe(403);
    expect(mocks.requireOwner).not.toHaveBeenCalled();
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });
});
