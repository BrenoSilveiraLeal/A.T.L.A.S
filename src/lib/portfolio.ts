import Decimal from "decimal.js";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const Exact = Decimal.clone({ precision: 64 });
const amount = z.string().regex(/^-?\d{1,18}(?:\.\d{1,10})?$/);
const timestamp = z.iso.datetime({ offset: true });
const accountSchema = z.object({ id: z.uuid(), provider: z.string().min(1).max(200) });
const snapshotSchema = z.object({
  id: z.uuid(),
  brokerAccountId: z.uuid(),
  cash: amount,
  equity: amount.nullable(),
  invested: amount.nullable(),
  realizedPnl: amount.nullable(),
  unrealizedPnl: amount.nullable(),
  reconciled: z.literal(true),
  discrepancies: z.array(z.unknown()).length(0),
  sourceTimestamp: timestamp,
  createdAt: timestamp,
});
const positionSchema = z.object({
  id: z.uuid(),
  brokerAccountId: z.uuid(),
  assetId: z.uuid(),
  ticker: z.string().regex(/^[A-Z0-9._-]{1,20}$/),
  exchange: z.string().min(1).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
  agentId: z.uuid().nullable(),
  agentName: z.string().min(1).max(80).nullable(),
  agentAssetId: z.uuid().nullable(),
  quantity: amount,
  reservedQuantity: amount,
  averagePrice: amount.nullable(),
  realizedPnl: amount.nullable(),
  reconciledAt: timestamp,
});
const responseSchema = z.object({
  brokerAccounts: z.array(accountSchema).max(1000),
  brokerAccountId: z.uuid().nullable(),
  snapshots: z.array(z.unknown()).max(1000),
  positions: z.array(z.unknown()).max(1000),
  historyTruncated: z.boolean(),
  positionsTruncated: z.boolean(),
});

export type PortfolioSnapshot = z.infer<typeof snapshotSchema>;
export type PortfolioPosition = z.infer<typeof positionSchema>;
export interface PortfolioHistory {
  brokerAccounts: z.infer<typeof accountSchema>[];
  brokerAccountId: string | null;
  snapshots: PortfolioSnapshot[];
  positions: PortfolioPosition[];
  historyTruncated: boolean;
  positionsTruncated: boolean;
}

/** Historical display evidence only; this never grants cash or trade authority. */
export function parsePortfolioHistory(value: unknown, now = Date.now()): PortfolioHistory {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(now)) throw new Error("INVALID_PORTFOLIO_HISTORY");
  const data = parsed.data;
  const accounts = [...new Map(data.brokerAccounts.map((account) => [account.id, account])).values()];
  if (data.brokerAccountId !== null && !accounts.some((account) => account.id === data.brokerAccountId)) {
    throw new Error("PORTFOLIO_ACCOUNT_MISMATCH");
  }
  const candidates = data.snapshots.flatMap((raw) => {
    const result = snapshotSchema.safeParse(raw);
    if (!result.success) return [];
    const row = result.data;
    if (row.brokerAccountId !== data.brokerAccountId || Date.parse(row.createdAt) > now ||
      Date.parse(row.sourceTimestamp) > Date.parse(row.createdAt)) return [];
    return [row];
  }).sort((a, b) => Date.parse(a.sourceTimestamp) - Date.parse(b.sourceTimestamp) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const distinctSnapshots = [...new Map(candidates.map((row) => [Date.parse(row.sourceTimestamp), row])).values()];
  const positions = data.positions.flatMap((raw) => {
    const result = positionSchema.safeParse(raw);
    if (!result.success) return [];
    const row = result.data;
    if (row.brokerAccountId !== data.brokerAccountId || Date.parse(row.reconciledAt) > now ||
      (row.agentId === null ? row.agentName !== null || row.agentAssetId !== null :
        row.agentName === null || row.agentAssetId !== row.assetId) ||
      new Exact(row.quantity).lt(0) || new Exact(row.reservedQuantity).lt(0) ||
      new Exact(row.reservedQuantity).gt(row.quantity) ||
      (row.averagePrice !== null && new Exact(row.averagePrice).lt(0))) return [];
    return [row];
  });
  const distinctPositions = [...new Map(positions.map((row) => [row.id, row])).values()]
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.id.localeCompare(b.id));
  return {
    brokerAccounts: accounts,
    brokerAccountId: data.brokerAccountId,
    snapshots: distinctSnapshots.slice(-200),
    positions: distinctPositions.slice(0, 500),
    historyTruncated: data.historyTruncated || distinctSnapshots.length > 200,
    positionsTruncated: data.positionsTruncated || distinctPositions.length > 500,
  };
}

/** Call only after requireOwner() has validated owner identity and AAL2. */
export async function loadPortfolioHistory(
  client: SupabaseClient,
  ownerId: string,
  brokerAccountId?: string | null,
): Promise<PortfolioHistory> {
  z.uuid().parse(ownerId);
  if (brokerAccountId != null) z.uuid().parse(brokerAccountId);
  const { data, error } = await client.rpc("get_portfolio_history", {
    p_owner_id: ownerId,
    p_broker_account_id: brokerAccountId ?? null,
    p_limit: 200,
  });
  if (error) throw new Error("PORTFOLIO_HISTORY_UNAVAILABLE");
  const result = parsePortfolioHistory(data);
  if (brokerAccountId && result.brokerAccountId !== brokerAccountId) {
    throw new Error("PORTFOLIO_ACCOUNT_MISMATCH");
  }
  return result;
}

/** Only normalized SVG coordinates become JS numbers; financial values stay exact. */
export function portfolioChartGeometry(snapshots: readonly PortfolioSnapshot[]) {
  const values = snapshots.filter((row) => row.equity !== null).slice(-200);
  if (!values.length) return null;
  const amounts = values.map((row) => new Exact(row.equity!));
  const min = Exact.min(...amounts), max = Exact.max(...amounts);
  const start = Math.min(...values.map((row) => Date.parse(row.sourceTimestamp)));
  const end = Math.max(...values.map((row) => Date.parse(row.sourceTimestamp)));
  const span = max.minus(min);
  return {
    minimum: min.toFixed(), maximum: max.toFixed(), start, end,
    points: values.map((snapshot, index) => ({
      snapshot,
      x: end === start ? 360 : 24 + (Date.parse(snapshot.sourceTimestamp) - start) / (end - start) * 672,
      y: span.isZero() ? 115 : 20 + max.minus(amounts[index]).div(span).toNumber() * 190,
    })),
  };
}
