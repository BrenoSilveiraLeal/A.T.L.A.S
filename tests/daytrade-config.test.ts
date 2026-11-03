import { describe, expect, it } from "vitest";
import raw from "../config/daytrade.json";
import { dashConfigSchema, ownerExecutionSettingsSchema, paperReadiness, readiness, roomLimits } from "@/core/daytrade/config";
import { runCycle, type CycleInput } from "@/core/daytrade/cycle";
import { INITIAL_STATUS } from "@/core/daytrade/desks";
import { WORKERS, type DeskWorker } from "@/core/daytrade/agents";

const config = dashConfigSchema.parse(raw);
const ready = dashConfigSchema.parse({
  ...raw,
  instruments: [{ ...raw.instruments[0], symbol: "WINZ26", tickSize: 5, pointValue: 0.2, marginPerContract: 100, verified: true,
    expirySource: "https://www.b3.com.br/pt_br/solucoes/plataformas/puma-trading-system/para-participantes-e-traders/calendario-de-negociacao/vencimentos/calendario-de-vencimentos-de-contratos-financeiros/" }, raw.instruments[1]],
  session: { ...raw.session, open: "09:00", lastEntry: "17:00", flatBy: "17:45", verified: true },
  risk: { ...raw.risk, maxLossPerTrade: 50, maxLossPerDay: 150, maxExposure: 1000, capitalBudget: 1200 },
  costs: { ...raw.costs, brokeragePerContract: 0, exchangeFeesPerContract: 0.3, verified: true },
  strategy: { id: "abertura", version: "v1", approved: true },
});
const base: CycleInput = { status: INITIAL_STATUS, limits: null, now: "2026-11-02T13:00:00Z", halted: false, feedSnapshot: null, news: { events: [], complete: false, source: "", refreshedAt: "" }, positions: [], lossToday: 0, riskStateReconciled: false, pointValue: null };

describe("DASH settings file", () => {
  it("is valid, simulated, and lists everything still unverified", () => {
    expect(config.mode).toBe("SIMULATED");
    expect(config.risk.stopRequired).toBe(true);
    const missing = readiness(config);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.join(" ")).toContain("Perda máxima do dia");
    expect(roomLimits(config)).toBeNull();
  });

  it("refuses LIVE mode, a missing stop rule and a per-trade loss above the day's", () => {
    expect(dashConfigSchema.safeParse({ ...raw, mode: "LIVE" }).success).toBe(false);
    expect(dashConfigSchema.safeParse({ ...raw, risk: { ...raw.risk, stopRequired: false } }).success).toBe(false);
    expect(dashConfigSchema.safeParse({ ...raw, risk: { ...raw.risk, maxLossPerTrade: 200, maxLossPerDay: 100 } }).success).toBe(false);
  });

  it("is ready once every fact is filled in and checked", () => {
    expect(readiness(ready)).toEqual([]);
    expect(roomLimits(ready)).toMatchObject({ maxLossPerTrade: 50, maxLossPerDay: 150 });
  });

  it("requires a separate DASH budget and keeps exposure within that allocation", () => {
    expect(readiness(config).join(" ")).toContain("DASH");
    expect(dashConfigSchema.safeParse({ ...ready, risk: { ...ready.risk, capitalBudget: 500 } }).success).toBe(false);
    expect(roomLimits(dashConfigSchema.parse({ ...ready, risk: { ...ready.risk, capitalBudget: 1200 } })))
      .toMatchObject({ capitalBudget: 1200, maxExposure: 1000 });
  });

  it("blocks paper when allocated capital cannot cover one contract margin", () => {
    const underfunded = dashConfigSchema.parse({ ...ready, risk: { ...ready.risk, maxExposure: 90, capitalBudget: 99 } });
    expect(paperReadiness(underfunded).join(" ")).toContain("margem de um contrato");
  });

  it("requires a budget to confirm owner paper settings", () => {
    const settings = {
      capitalBudget: null, marginPerContract: 100, brokeragePerContract: 0, exchangeFeesPerContract: 0.3,
      slippageTicks: 1, maxLossPerTrade: 50, maxLossPerDay: 100, maxExposure: 100,
      lastEntry: "17:00", flatBy: "17:45", sourceNote: "Nota Genial e B3", confirmSource: true,
    };
    expect(ownerExecutionSettingsSchema.safeParse(settings).success).toBe(false);
    expect(ownerExecutionSettingsSchema.safeParse({ ...settings, capitalBudget: 200 }).success).toBe(true);
    expect(ownerExecutionSettingsSchema.safeParse({ ...settings, capitalBudget: 90 }).success).toBe(false);
  });

  it("keeps tax rates informational until a complete fiscal ledger exists", () => {
    expect(config.tax.dayTradeRate).toBe(0.2);
    expect(config.tax.withholdingRate).toBe(0.01);
    expect(config.tax.note).toContain("não apura IRRF");
  });
});

describe("DASH cycle", () => {
  it("does nothing with the kill switch on, or without data (idle workers)", () => {
    expect(runCycle({ ...base, halted: true }).journal.at(-1)?.message).toContain("Kill switch");
    const idle = runCycle(base);
    expect(idle.send).toEqual([]);
    expect(idle.journal.some((e) => e.message.includes("Sem dado confiável"))).toBe(true);
  });

  it("goes through the room and never sends in simulated mode", () => {
    const working = <I, O>(desk: DeskWorker<I, O>["desk"], output: O): DeskWorker<I, O> => ({ desk, step: () => ({ state: "WORKING", output, reason: "ok" }) });
    const signal = { id: "s1", instrument: "WINZ26", side: "BUY" as const, strategyVersion: "v1", entry: 100000, stop: 99900, target: 100200, reason: "teste", createdAt: base.now };
    const workers = {
      ...WORKERS,
      feed: working("feed", { provenance: [{ source: "sim", receivedAt: base.now, delayMs: 10, simulated: true }], candles: [], book: [] }),
      price: working("price", { candles: [], book: [] }),
      news: working("news", { blockEntries: false, sizeFactor: 1, reasons: [] }),
      strategy: working("strategy", [signal]),
      chief: working("chief", [{ desk: "chief" as const, vote: "APPROVE" as const, reason: "ok" }]),
      risk: working("risk", { approved: true, reasons: [] }),
      execution: working("execution", { proposalId: "s1", instrument: "WINZ26", side: "BUY" as const, quantity: 1, type: "LIMIT" as const, price: 100000, stop: 99900 }),
    };
    const status = { ...INITIAL_STATUS, data: "REAL" as const, broker: "ProfitDLL", instrument: "WINZ26", market: "OPEN" as const };
    const result = runCycle({ ...base, status, limits: roomLimits(ready), pointValue: 0.2, riskStateReconciled: true }, workers);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].maxLoss).toBeCloseTo(22.6);
    expect(result.send).toEqual([]);
    expect(result.simulated).toHaveLength(1);
    // Without the contract's point value, the loss is unknown and the room refuses.
    expect(runCycle({ ...base, status, limits: roomLimits(ready), pointValue: null }, workers).simulated).toEqual([]);
  });
});
