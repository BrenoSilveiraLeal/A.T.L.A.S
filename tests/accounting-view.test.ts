import { describe, expect, it } from "vitest";
import { recordedPortfolio } from "@/core/accounting-view";

const now = Date.parse("2026-09-14T18:00:00Z");
const record = {
  id: "11111111-1111-4111-8111-111111111111",
  brokerAccountId: "22222222-2222-4222-8222-222222222222",
  cash: "100.0000000000",
  equity: "200.0000000000",
  invested: "100.0000000000",
  realizedPnl: "9007199254740992.0100000000",
  unrealizedPnl: "-0.0100000000",
  reconciled: true,
  discrepancies: [],
  sourceTimestamp: "2026-09-10T18:00:00Z",
};

describe("recorded portfolio display", () => {
  it("keeps the original historical timestamp and exact decimal P&L", () => {
    expect(recordedPortfolio(record, now)).toMatchObject({
      sourceTimestamp: record.sourceTimestamp,
      totalPnl: "9007199254740992",
    });
  });
  it("does not display mismatched, unconfirmed, future or malformed snapshots as reconciled", () => {
    for (const input of [
      null,
      { ...record, reconciled: false },
      { ...record, discrepancies: [{ field: "cash" }] },
      { ...record, sourceTimestamp: "2026-09-15T00:00:00Z" },
      { ...record, cash: 100 },
      { ...record, cash: "NaN" },
    ]) {
      expect(recordedPortfolio(input, now)).toBeNull();
    }
  });
  it("preserves unknown P&L without substituting zero", () => {
    expect(
      recordedPortfolio({ ...record, unrealizedPnl: null }, now)?.totalPnl,
    ).toBeNull();
  });
});
