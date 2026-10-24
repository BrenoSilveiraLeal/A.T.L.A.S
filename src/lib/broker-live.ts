import "server-only";
import { bridgeExecution } from "./live-view";
import { HttpExecutionGateway, GatewayError } from "@/providers/execution-gateway";
import { adminClient } from "./supabase";

/**
 * Read-only live view of the Genial account through the local MT5 bridge. It exists only
 * where the bridge runs (the owner's Windows machine); elsewhere it reports unavailable.
 * Never places, modifies or cancels anything. The account number is masked.
 */
export async function readBrokerLive(ownerId: string) {
  const url = process.env.ATLAS_GATEWAY_URL, token = process.env.ATLAS_GATEWAY_TOKEN;
  const accountId = process.env.ATLAS_GATEWAY_ACCOUNT_ID, providerId = process.env.ATLAS_GATEWAY_PROVIDER_ID;
  if (!url || !token || !accountId || !providerId)
    return { available: false as const, reason: "A ponte com a Genial só roda no computador com o MetaTrader. Abra o ATLAS em http://127.0.0.1:3000 nesse computador." };
  let gateway: HttpExecutionGateway;
  try {
    gateway = await HttpExecutionGateway.connect({ url, token, expectedAccountId: accountId, expectedProviderId: providerId, timeoutMs: 4000 });
  } catch (error) {
    return { available: false as const, reason: error instanceof GatewayError && error.code === "TERMINAL_UNAVAILABLE"
      ? "O MetaTrader está fechado ou desconectado. Abra e faça login no terminal da Genial."
      : "A ponte com a Genial não respondeu. Rode C:\\atlas-data\\start-gateway.ps1 com o MetaTrader aberto." };
  }
  const assets = await adminClient().from("assets").select("ticker").eq("owner_id", ownerId).eq("active", true);
  const tickers = assets.error ? [] : assets.data.map((a) => a.ticker as string);
  const [account, health, positions, orders] = await Promise.all([gateway.getAccount(), gateway.healthCheck(), gateway.getPositions(), gateway.getOrders()]);
  // Older bridges lack "balance"; the rest of the view still works.
  const balance = await gateway.getBalance().catch(() => null);
  const quotes = [];
  for (const symbol of tickers) {
    try { quotes.push({ ...(await gateway.getQuote(symbol)), error: null }); }
    catch (error) { quotes.push({ symbol, error: error instanceof GatewayError ? error.code : "QUOTE_UNAVAILABLE" }); }
  }
  return {
    available: true as const,
    account: { ...account, accountId: `****${account.accountId.slice(-3)}` },
    provider: gateway.capabilities.providerId,
    // The bridge's own switch (gateway.env): true only when it may send orders.
    executionEnabled: (await bridgeExecution()) === true,
    health, balance, positions, orders, quotes, observedAt: new Date().toISOString(),
  };
}
