import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allLiveFills } from "@/lib/live-fills";

it("paginates more than 1000 executions and keeps the owner filter on every page", async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({ execution_id: String(i).padStart(5, "0"), executed_at: "2026-11-04T15:00:00Z" }));
  let requests = 0;
  const db = { from: () => {
    let cursor = "", owner = "", limit = 0;
    const query = { select: () => query, eq: (_key: string, value: string) => { owner = value; return query; },
      order: () => query, gt: (_key: string, value: string) => { cursor = value; return query; },
      limit: (value: number) => { limit = value; return query; },
      then: (resolve: (value: unknown) => unknown) => { requests++; expect(owner).toBe("owner"); return Promise.resolve({ data: rows.filter((row) => row.execution_id > cursor).slice(0, limit), error: null }).then(resolve); } };
    return query;
  } } as unknown as SupabaseClient;
  expect(await allLiveFills(db, "owner")).toHaveLength(1201);
  expect(requests).toBe(3);
});
