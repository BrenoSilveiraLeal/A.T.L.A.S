import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every fee ATLAS paid or simulated, newest first: brokerage + B3 per executed order, from the
 * real Genial deals and from the simulation. Totals per month and per source.
 */
export async function loadCosts(db: SupabaseClient, ownerId: string) {
  const [paper, live, agents, assets] = await Promise.all([
    db.from("paper_fills").select("id,agent_id,asset_id,side,quantity,fill_price,fee,filled_at").eq("owner_id", ownerId).order("filled_at", { ascending: false }).limit(500),
    db.from("live_fills").select("execution_id,agent_id,ticker,side,quantity,price,fee,executed_at").eq("owner_id", ownerId).order("executed_at", { ascending: false }).limit(500),
    db.from("agents").select("id,name").eq("owner_id", ownerId),
    db.from("assets").select("id,ticker").eq("owner_id", ownerId),
  ]);
  for (const r of [paper, live, agents, assets]) if (r.error) throw new Error("COSTS_DATABASE_UNAVAILABLE");
  const name = (id: string) => agents.data?.find((a) => a.id === id)?.name ?? "IA";
  const rows = [
    ...(live.data ?? []).map((f) => ({ id: `r:${f.execution_id}`, source: "REAL" as const, at: f.executed_at, agent: name(f.agent_id), ticker: f.ticker,
      side: f.side, quantity: f.quantity, value: Number(f.quantity) * Number(f.price), fee: Number(f.fee) })),
    ...(paper.data ?? []).map((f) => ({ id: `s:${f.id}`, source: "SIMULATION" as const, at: f.filled_at, agent: name(f.agent_id),
      ticker: assets.data?.find((a) => a.id === f.asset_id)?.ticker ?? "", side: f.side, quantity: f.quantity,
      value: Number(f.quantity) * Number(f.fill_price), fee: Number(f.fee) })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const months: Record<string, { real: number; simulation: number; orders: number }> = {};
  for (const r of rows) {
    const month = new Date(r.at).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
    months[month] ??= { real: 0, simulation: 0, orders: 0 };
    months[month][r.source === "REAL" ? "real" : "simulation"] += r.fee;
    months[month].orders++;
  }
  const sum = (source: "REAL" | "SIMULATION") => rows.filter((r) => r.source === source).reduce((s, r) => s + r.fee, 0);
  const traded = (source: "REAL" | "SIMULATION") => rows.filter((r) => r.source === source).reduce((s, r) => s + r.value, 0);
  return {
    totals: { real: sum("REAL"), simulation: sum("SIMULATION"), realTraded: traded("REAL"), simulationTraded: traded("SIMULATION") },
    months: Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).map(([month, v]) => ({ month, ...v })),
    rows: rows.slice(0, 200),
  };
}
