import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPortfolioHistory, parsePortfolioHistory, portfolioChartGeometry } from "@/lib/portfolio";

const accountId = "10000000-0000-4000-8000-000000000001";
const anotherAccount = "10000000-0000-4000-8000-000000000002";
const assetId = "20000000-0000-4000-8000-000000000001";
const agentId = "30000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-09-15T00:00:00Z");
const snapshot = {
  id: "40000000-0000-4000-8000-000000000001", brokerAccountId: accountId,
  cash: "9007199254740992.0100000000", equity: "9007199254740993.0100000000",
  invested: "1.0000000000", realizedPnl: null, unrealizedPnl: "-0.0100000000",
  reconciled: true, discrepancies: [],
  sourceTimestamp: "2026-09-10T18:00:00Z", createdAt: "2026-09-10T18:00:01Z",
};
const position = {
  id: "50000000-0000-4000-8000-000000000001", brokerAccountId: accountId,
  assetId, ticker: "TEST3", exchange: "B3", currency: "BRL", agentId,
  agentName: "Agente fixture", agentAssetId: assetId,
  quantity: "9007199254740992.0100000000", reservedQuantity: "0.0100000000",
  averagePrice: "100.0123456789", realizedPnl: null, reconciledAt: "2026-09-10T18:00:00Z",
};
const response = {
  brokerAccounts: [{ id: accountId, provider: "Broker fixture" }], brokerAccountId: accountId,
  snapshots: [snapshot], positions: [position], historyTruncated: false, positionsTruncated: false,
};

describe("account-scoped portfolio history", () => {
  it("preserves exact decimals, unknown values and real source times", () => {
    const data = parsePortfolioHistory(response, now);
    expect(data.snapshots[0]).toEqual(snapshot);
    expect(data.positions[0]).toEqual(position);
    expect(data.snapshots[0].realizedPnl).toBeNull();
  });
  it("rejects an undeclared selected account", () => {
    expect(() => parsePortfolioHistory({ ...response, brokerAccountId: anotherAccount }, now)).toThrow("PORTFOLIO_ACCOUNT_MISMATCH");
  });
  it("returns no invented records when there is no account", () => {
    expect(parsePortfolioHistory({ ...response, brokerAccounts: [], brokerAccountId: null }, now)).toMatchObject({ snapshots: [], positions: [] });
  });
  it.each([
    { reconciled: false }, { discrepancies: [{ field: "cash" }] }, { brokerAccountId: anotherAccount },
    { equity: 100 }, { cash: "NaN" }, { equity: "1e3" },
    { sourceTimestamp: "2026-09-16T00:00:00Z" }, { createdAt: "2026-09-16T00:00:00Z" },
    { sourceTimestamp: "2026-02-30T00:00:00Z" }, { sourceTimestamp: "2026-09-10T18:00:02Z" },
  ])("excludes invalid snapshot evidence: %j", (override) => {
    expect(parsePortfolioHistory({ ...response, snapshots: [{ ...snapshot, ...override }] }, now).snapshots).toEqual([]);
  });
  it.each([
    { brokerAccountId: anotherAccount }, { agentAssetId: anotherAccount }, { agentName: null },
    { agentId: null }, { quantity: "-1" }, { reservedQuantity: "9007199254740992.0200000000" },
    { averagePrice: "-0.01" }, { reconciledAt: "2026-09-16T00:00:00Z" }, { quantity: 1 },
  ])("excludes invalid or misattributed positions: %j", (override) => {
    expect(parsePortfolioHistory({ ...response, positions: [{ ...position, ...override }] }, now).positions).toEqual([]);
  });
  it("preserves a genuinely unassigned position", () => {
    const row = { ...position, agentId: null, agentName: null, agentAssetId: null };
    expect(parsePortfolioHistory({ ...response, positions: [row] }, now).positions).toEqual([row]);
  });
  it("keeps only the latest corrected snapshot at the same instant", () => {
    const corrected = { ...snapshot, id: "40000000-0000-4000-8000-000000000002", equity: "100", createdAt: "2026-09-10T18:00:02Z" };
    expect(parsePortfolioHistory({ ...response, snapshots: [corrected, snapshot] }, now).snapshots).toEqual([corrected]);
  });
  it("caps history at the newest 200 source observations and signals truncation", () => {
    const snapshots = Array.from({ length: 205 }, (_, index) => ({ ...snapshot,
      id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      sourceTimestamp: new Date(now - (210 - index) * 86400000).toISOString(),
      createdAt: new Date(now - (210 - index) * 86400000 + 1000).toISOString(),
    }));
    const data = parsePortfolioHistory({ ...response, snapshots }, now);
    expect(data.snapshots).toEqual(snapshots.slice(-200));
    expect(data.historyTruncated).toBe(true);
  });
  it("converts only normalized chart coordinates to Number, preserving subcent changes at large balances", () => {
    const snapshots = parsePortfolioHistory({ ...response, snapshots: [snapshot, {
      ...snapshot, id: "40000000-0000-4000-8000-000000000002", equity: "9007199254740993.0100000001",
      sourceTimestamp: "2026-09-11T18:00:00Z", createdAt: "2026-09-11T18:00:01Z",
    }, {
      ...snapshot, id: "40000000-0000-4000-8000-000000000003", equity: "9007199254740993.0100000002",
      sourceTimestamp: "2026-09-14T18:00:00Z", createdAt: "2026-09-14T18:00:01Z",
    }] }, now).snapshots;
    const chart = portfolioChartGeometry(snapshots)!;
    expect(chart.points.map(({ x, y }) => [x, y])).toEqual([[24, 210], [192, 115], [696, 20]]);
    expect(chart.minimum).toBe("9007199254740993.01");
    expect(chart.maximum).toBe("9007199254740993.0100000002");
    expect(chart.points).toHaveLength(3); // The two unobserved days are not generated.
  });
  it("does not draw unknown equity as zero and handles a single flat point", () => {
    const data = parsePortfolioHistory(response, now);
    expect(portfolioChartGeometry([{ ...data.snapshots[0], equity: null }])).toBeNull();
    expect(portfolioChartGeometry(data.snapshots)?.points[0]).toMatchObject({ x: 360, y: 115 });
  });
  it("calls the bounded backend RPC with the exact authorized owner and account", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: response, error: null });
    await loadPortfolioHistory({ rpc } as unknown as SupabaseClient, agentId, accountId);
    expect(rpc).toHaveBeenCalledWith("get_portfolio_history", { p_owner_id: agentId, p_broker_account_id: accountId, p_limit: 200 });
  });
  it("rejects malformed identifiers before querying and sanitizes database errors", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "secret database internals" } });
    await expect(loadPortfolioHistory({ rpc } as unknown as SupabaseClient, "invalid", accountId)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    await expect(loadPortfolioHistory({ rpc } as unknown as SupabaseClient, agentId, accountId)).rejects.toThrow("PORTFOLIO_HISTORY_UNAVAILABLE");
  });
});
