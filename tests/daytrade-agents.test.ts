import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKS, INITIAL_STATUS, type DashStatus } from "@/core/daytrade/desks";
import { maySend, PIPELINE, POWERS, reviewProposal, strategyWorker, WORKERS, type RoomVote, type TradeProposal } from "@/core/daytrade/agents";

const proposal: TradeProposal = {
  signal: { id: "s1", instrument: "WINZ26", side: "BUY", strategyVersion: "v1", entry: 100, stop: 99, target: 102, reason: "teste", createdAt: "2026-11-01T13:00:00Z" },
  quantity: 1, maxLoss: 50, proposedBy: "strategy",
};
const open: DashStatus = { ...INITIAL_STATUS, data: "REAL", broker: "ProfitDLL", instrument: "WINZ26", market: "OPEN" };
const limits = { maxLossPerTrade: 100, maxLossPerDay: 300, maxOpenPositions: 1, maxExposure: 1000, maxContracts: 1, marginPerContract: 100, pointValue: 50, tickSize: 0.01, costPerSide: 0, slippageTicks: 0 };
const riskContext = { status: open, limits, positions: [], lossToday: 0, riskStateReconciled: true };
const yes = (desk: RoomVote["desk"]): RoomVote => ({ desk, vote: "APPROVE", reason: "ok" });

afterEach(() => vi.useRealTimers());

describe("DASH desks' contracts", () => {
  it("has a fail-closed risk worker and keeps data-dependent desks idle", () => {
    for (const d of DESKS) {
      const result = (WORKERS[d.id].step as (i: unknown, c: unknown) => { state: string; output: unknown })(undefined, { status: INITIAL_STATUS, now: "", limits: null });
      if (d.id === "risk" || d.id === "price" || d.id === "strategy" || d.id === "backtest" || d.id === "execution" || d.id === "orders" || d.id === "news" || d.id === "positions" || d.id === "feed") {
        expect(result.state).toBe("BLOCKED");
        if (d.id === "risk") expect(result.output).toMatchObject({ approved: false });
      } else {
        expect(result.state).toBe("IDLE");
        expect(result.output).toBeNull();
      }
    }
    expect(PIPELINE.every((id) => DESKS.some((d) => d.id === id))).toBe(true);
  });

  it("lets only execution send orders", () => {
    expect(Object.entries(POWERS).filter(([, p]) => p.sendOrders).map(([id]) => id)).toEqual([]);
    expect(POWERS.risk.veto).toBe(true);
    expect(POWERS.supervisor.killSwitch).toBe(true);
  });

  it("approves in the analysis room only with risk and the chief, trustworthy data and a stop", () => {
    const votes = [yes("strategy"), yes("risk"), yes("execution"), yes("chief")];
    expect(reviewProposal(proposal, votes, riskContext).approved).toBe(true);
    expect(reviewProposal(proposal, votes, { ...riskContext, status: INITIAL_STATUS }).approved).toBe(false);
    expect(reviewProposal(proposal, votes, { ...riskContext, limits: null }).approved).toBe(false);
    expect(reviewProposal(proposal, votes.filter((v) => v.desk !== "risk"), riskContext).approved).toBe(false);
    expect(reviewProposal(proposal, [...votes.slice(0, 3), { desk: "chief", vote: "REJECT", reason: "não" }], riskContext).approved).toBe(false);
    expect(reviewProposal({ ...proposal, signal: { ...proposal.signal, stop: 101 } }, votes, riskContext).approved).toBe(false);
    expect(reviewProposal({ ...proposal, maxLoss: 500 }, votes, riskContext).approved).toBe(false);
  });

  it("never sends anything in simulated mode or without a broker", () => {
    const approved = { approved: true, reasons: [] };
    expect(maySend(approved, open).send).toBe(false);
    expect(maySend(approved, { ...open, mode: "LIVE" }).send).toBe(false);
    expect(maySend(approved, { ...open, mode: "LIVE", broker: "Corretora" }).send).toBe(false);
    expect(maySend({ approved: false, reasons: ["x"] }, { ...open, mode: "LIVE", broker: "Corretora" }).send).toBe(false);
  });

  it("respects the earlier WIN expiry close when producing strategy observations", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-16T18:01:00-03:00"));
    const now = new Date().toISOString();
    const provenance = { source: "PROFITDLL_DAYTRADE", receivedAt: now, delayMs: 0, simulated: false };
    const candles = Array.from({ length: 541 }, (_, index) => {
      const date = new Date(Date.parse("2026-12-16T09:00:00-03:00") + index * 60_000).toISOString();
      const price = index === 540 ? 110 : 100;
      const low = index < 15 ? 95 : price;
      return {
        instrument: "WINZ26", start: date, open: price, high: price, low, close: price,
        volume: 1, turnover: price, provenance,
      };
    });
    const context = { status: open, now, limits: null, instrumentTickSize: 5 };
    const input = { candles, book: [], gate: { blockEntries: false, sizeFactor: 1, reasons: [] } };

    expect(strategyWorker.step(input, context).output).toHaveLength(1);
    expect(strategyWorker.step({ ...input, expiresOn: "2026-12-16" }, context).output).toEqual([]);
  });
});
