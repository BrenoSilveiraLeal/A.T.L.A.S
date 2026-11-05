import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LiveFill {
  execution_id: string; agent_id: string; ticker: string; side: "BUY" | "SELL";
  quantity: number; price: string; fee: string; executed_at: string;
}

/** Read the entire immutable execution ledger, without silently stopping at the API row limit. */
export async function allLiveFills(db: SupabaseClient, owner: string): Promise<LiveFill[]> {
  const rows: LiveFill[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = db.from("live_fills").select("execution_id,agent_id,ticker,side,quantity,price,fee,executed_at")
      .eq("owner_id", owner).order("execution_id").limit(500);
    if (cursor !== undefined) query = query.gt("execution_id", cursor);
    const result = await query;
    if (result.error) throw new Error("LIVE_FILLS_UNAVAILABLE");
    const page = result.data as LiveFill[];
    rows.push(...page);
    if (page.length < 500) return rows.sort((a, b) => b.executed_at.localeCompare(a.executed_at) || a.execution_id.localeCompare(b.execution_id));
    cursor = page[page.length - 1].execution_id;
  }
}
