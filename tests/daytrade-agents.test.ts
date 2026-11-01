import { describe, expect, it } from "vitest";
import { DESKS, INITIAL_STATUS, type DashStatus } from "@/core/daytrade/desks";
import { maySend, PIPELINE, POWERS, reviewProposal, WORKERS, type RoomVote, type TradeProposal } from "@/core/daytrade/agents";

const proposal: TradeProposal = {
  signal: { id: "s1", instrument: "WINZ26", side: "BUY", strategyVersion: "v1", entry: 100, stop: 99, target: 102, reason: "teste", createdAt: "2026-11-01T13:00:00Z" },
  quantity: 1, maxLoss: 50, proposedBy: "strategy",
};
const open: DashStatus = { ...INITIAL_STATUS, data: "SIMULATED", market: "OPEN" };
const limits = { maxLossPerTrade: 100, maxLossPerDay: 300, maxOpenPositions: 1, maxExposure: 1000 };
const yes = (desk: RoomVote["desk"]): RoomVote => ({ desk, vote: "APPROVE", reason: "ok" });

describe("DASH desks' contracts", () => {
  it("has a worker for every desk, idle until implemented, never inventing data", () => {
    for (const d of DESKS) {
      const result = (WORKERS[d.id].step as (i: unknown, c: unknown) => { state: string; output: unknown })(undefined, { status: INITIAL_STATUS, now: "", limits: null });
      expect(result.state).toBe("IDLE");
      expect(result.output).toBeNull();
    }
    expect(PIPELINE.every((id) => DESKS.some((d) => d.id === id))).toBe(true);
  });

  it("lets only execution send orders", () => {
    expect(Object.entries(POWERS).filter(([, p]) => p.sendOrders).map(([id]) => id)).toEqual(["execution"]);
    expect(POWERS.risk.veto).toBe(true);
    expect(POWERS.supervisor.killSwitch).toBe(true);
  });

  it("approves in the analysis room only with risk and the chief, trustworthy data and a stop", () => {
    const votes = [yes("strategy"), yes("risk"), yes("execution"), yes("chief")];
    expect(reviewProposal(proposal, votes, { status: open, limits }).approved).toBe(true);
    expect(reviewProposal(proposal, votes, { status: INITIAL_STATUS, limits }).approved).toBe(false);
    expect(reviewProposal(proposal, votes, { status: open, limits: null }).approved).toBe(false);
    expect(reviewProposal(proposal, votes.filter((v) => v.desk !== "risk"), { status: open, limits }).approved).toBe(false);
    expect(reviewProposal(proposal, [...votes.slice(0, 3), { desk: "chief", vote: "REJECT", reason: "não" }], { status: open, limits }).approved).toBe(false);
    expect(reviewProposal({ ...proposal, signal: { ...proposal.signal, stop: 101 } }, votes, { status: open, limits }).approved).toBe(false);
    expect(reviewProposal({ ...proposal, maxLoss: 500 }, votes, { status: open, limits }).approved).toBe(false);
  });

  it("never sends anything in simulated mode or without a broker", () => {
    const approved = { approved: true, reasons: [] };
    expect(maySend(approved, open).send).toBe(false);
    expect(maySend(approved, { ...open, mode: "LIVE" }).send).toBe(false);
    expect(maySend(approved, { ...open, mode: "LIVE", broker: "Corretora" }).send).toBe(true);
    expect(maySend({ approved: false, reasons: ["x"] }, { ...open, mode: "LIVE", broker: "Corretora" }).send).toBe(false);
  });
});
