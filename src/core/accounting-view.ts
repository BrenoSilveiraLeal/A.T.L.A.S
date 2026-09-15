import Decimal from "decimal.js";
import { z } from "zod";

const amount = z.string().regex(/^-?\d{1,18}(?:\.\d{1,10})?$/);
const snapshotSchema = z.object({
  id: z.uuid(),
  brokerAccountId: z.uuid(),
  cash: amount,
  equity: amount.nullable(),
  invested: amount.nullable(),
  realizedPnl: amount.nullable(),
  unrealizedPnl: amount.nullable(),
  reconciled: z.boolean(),
  discrepancies: z.array(z.unknown()),
  sourceTimestamp: z.iso.datetime({ offset: true }),
});
export type RecordedPortfolio = z.infer<typeof snapshotSchema> & {
  totalPnl: string | null;
};

/** Historical display only. This result never authorizes spending or trading. */
export function recordedPortfolio(
  value: unknown,
  now = Date.now(),
): RecordedPortfolio | null {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const record = parsed.data;
  if (
    !record.reconciled ||
    record.discrepancies.length ||
    Date.parse(record.sourceTimestamp) > now
  )
    return null;
  const Exact = Decimal.clone({ precision: 64 });
  return {
    ...record,
    totalPnl:
      record.realizedPnl === null || record.unrealizedPnl === null
        ? null
        : new Exact(record.realizedPnl).plus(record.unrealizedPnl).toFixed(),
  };
}
