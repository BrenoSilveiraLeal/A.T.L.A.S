import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpExecutionGateway } from "@/providers/execution-gateway";

/**
 * Price now for every team stock, as fresh as the free sources allow:
 * - on the owner's computer, the Genial MetaTrader bridge (live, free, no request limit);
 * - elsewhere (Vercel, computer off), the latest price an agent recorded from brapi, whose free
 *   plan only refreshes every 30 minutes.
 */
export async function loadPrices(db: SupabaseClient, ownerId: string) {
  const assets = await db.from("assets").select("ticker").eq("owner_id", ownerId).eq("active", true);
  if (assets.error) throw new Error("PRICES_DATABASE_UNAVAILABLE");
  const tickers = assets.data.map((a) => String(a.ticker));
  const url = process.env.ATLAS_GATEWAY_URL, token = process.env.ATLAS_GATEWAY_TOKEN;
  const accountId = process.env.ATLAS_GATEWAY_ACCOUNT_ID, providerId = process.env.ATLAS_GATEWAY_PROVIDER_ID;
  if (url && token && accountId && providerId) {
    try {
      const gateway = await HttpExecutionGateway.connect({ url, token, expectedAccountId: accountId, expectedProviderId: providerId, timeoutMs: 6000 });
      const prices: Record<string, { price: number; at: string }> = {};
      for (const ticker of tickers) {
        try {
          const q = await gateway.getQuote(ticker);
          const price = Number(q.last ?? q.bid ?? q.ask);
          if (price > 0) prices[ticker] = { price, at: q.quotedAt };
        } catch { /* this stock has no quote right now */ }
      }
      if (Object.keys(prices).length) return { source: "MT5" as const, refreshSeconds: 5, prices };
    } catch { /* bridge off: fall back to brapi */ }
  }
  const vitals = await db.from("paper_agent_vitals").select("agent_id,mark_price,mark_timestamp").eq("owner_id", ownerId);
  const agents = await db.from("agents").select("id,asset_id").eq("owner_id", ownerId);
  const ids = await db.from("assets").select("id,ticker").eq("owner_id", ownerId);
  const prices: Record<string, { price: number; at: string }> = {};
  for (const v of vitals.data ?? []) {
    const assetId = agents.data?.find((a) => a.id === v.agent_id)?.asset_id;
    const ticker = ids.data?.find((a) => a.id === assetId)?.ticker;
    if (ticker && v.mark_price) prices[String(ticker)] = { price: Number(v.mark_price), at: String(v.mark_timestamp) };
  }
  return { source: "brapi" as const, refreshSeconds: 1800, prices };
}
