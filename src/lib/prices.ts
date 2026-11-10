import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpExecutionGateway } from "@/providers/execution-gateway";

/**
 * Price now for every team stock, as fresh as the free sources allow:
 * - on the owner's computer, the Genial MetaTrader bridge (live, free, no request limit);
 * - elsewhere (Vercel, computer off), the latest price an agent recorded from brapi, whose free
 *   plan only refreshes every 30 minutes.
 */
/** Is the Genial bridge answering on this computer? (cached 30 s) */
let bridgeCheck: { at: number; up: boolean } | null = null;
export async function bridgeReachable() {
  if (bridgeCheck && Date.now() - bridgeCheck.at < 30000) return bridgeCheck.up;
  const url = process.env.ATLAS_GATEWAY_URL, token = process.env.ATLAS_GATEWAY_TOKEN;
  const accountId = process.env.ATLAS_GATEWAY_ACCOUNT_ID, providerId = process.env.ATLAS_GATEWAY_PROVIDER_ID;
  let up = false;
  if (url && token && accountId && providerId) {
    try {
      const gateway = await HttpExecutionGateway.connect({ url, token, expectedAccountId: accountId, expectedProviderId: providerId, timeoutMs: 5000 });
      up = (await gateway.healthCheck()).healthy;
    } catch { up = false; }
  }
  bridgeCheck = { at: Date.now(), up };
  return up;
}

/**
 * One stock's price now from the Genial MetaTrader bridge, or null when the bridge is off (then the
 * caller falls back to the free feed). Owner's computer only.
 */
export async function bridgeQuote(ticker: string): Promise<{ price: number; at: string } | null> {
  const url = process.env.ATLAS_GATEWAY_URL, token = process.env.ATLAS_GATEWAY_TOKEN;
  const accountId = process.env.ATLAS_GATEWAY_ACCOUNT_ID, providerId = process.env.ATLAS_GATEWAY_PROVIDER_ID;
  if (process.env.VERCEL || !url || !token || !accountId || !providerId) return null;
  try {
    const gateway = await HttpExecutionGateway.connect({ url, token, expectedAccountId: accountId, expectedProviderId: providerId, timeoutMs: 6000 });
    const q = await gateway.getQuote(ticker);
    const price = Number(q.last ?? q.bid ?? q.ask);
    return price > 0 ? { price, at: q.quotedAt } : null;
  } catch {
    return null;
  }
}

/**
 * The session's 5-minute closes for the intraday chart (owner, 10/11/2026: the chart only had the
 * quotes the page itself had seen, a lone dot after the close). Read from the bridge at most once a
 * minute per stock; an older bridge without the method just gives none.
 */
const barsCache = new Map<string, { at: number; bars: { price: number; at: string }[] }>();
async function intradayBars(gateway: HttpExecutionGateway, ticker: string) {
  const hit = barsCache.get(ticker);
  if (hit && Date.now() - hit.at < 60000) return hit.bars;
  let bars: { price: number; at: string }[] = [];
  try { bars = (await gateway.getBars(ticker)).map((b) => ({ price: Number(b.close), at: b.at })).filter((b) => b.price > 0); }
  catch { bars = hit?.bars ?? []; }
  barsCache.set(ticker, { at: Date.now(), bars });
  return bars;
}

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
      const bars: Record<string, { price: number; at: string }[]> = {};
      // A slow/unavailable symbol must not serialize a timeout for every stock in the team.
      for (let i = 0; i < tickers.length; i += 4) await Promise.all(tickers.slice(i, i + 4).map(async (ticker) => {
        try {
          const q = await gateway.getQuote(ticker);
          const price = Number(q.last ?? q.bid ?? q.ask);
          if (Number.isFinite(price) && price > 0 && Number.isFinite(Date.parse(q.quotedAt))) prices[ticker] = { price, at: q.quotedAt };
        } catch { /* this stock has no quote right now */ }
        const day = await intradayBars(gateway, ticker);
        if (day.length) bars[ticker] = day;
      }));
      if (Object.keys(prices).length) return { source: "MT5" as const, refreshSeconds: 5, prices, bars };
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
