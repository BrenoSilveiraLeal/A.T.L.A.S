import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/levels", () => ({ agentLevels: async () => ({ available: true,
  range: { low: 12, high: 20, buyBelow: 13.8 }, turnCloses: Array(20).fill(12),
  collapse: null, history: null, lastClose: "12.2" }) }));
vi.mock("@/lib/company-health", () => ({ cachedCompanyHealth: async () => null }));
vi.mock("@/lib/forecast", () => ({ consensusFor: async () => null }));

import { bossRelease } from "@/lib/boss";

it("passes the pot to the next agents after a fill or while an order is open, without caching eligibility", async () => {
  const ids = ["a", "b", "c", "d"];
  const data: Record<string, unknown[]> = {
    agents: ids.map((id) => ({ id, asset_id: id, status: "ACTIVE", enabled: true, autopilot: true })),
    assets: ids.map((id) => ({ id, ticker: `${id}TEST3` })), paper_agent_vitals: [],
    paper_orders: [], paper_fills: [], live_orders: [], live_fills: [],
  };
  const db = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, in: () => query, gte: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data[table], error: null }).then(resolve) };
    return query;
  } } as unknown as SupabaseClient;
  expect(await bossRelease(db, "eligibility-test", "d", 510)).toBe(0);
  data.paper_fills = [{ agent_id: "a" }, { agent_id: "b" }];
  data.paper_orders = [{ agent_id: "c" }];
  expect(await bossRelease(db, "eligibility-test", "d", 510)).toBe(510);
  // A virtual fill must never prevent its real order from receiving money.
  expect(await bossRelease(db, "eligibility-test", "a", 510, {}, "live")).toBe(255);
  data.live_fills = [{ agent_id: "a" }, { agent_id: "b" }];
  data.live_orders = [{ agent_id: "c" }];
  expect(await bossRelease(db, "eligibility-test", "d", 510, {}, "live")).toBe(510);
});
