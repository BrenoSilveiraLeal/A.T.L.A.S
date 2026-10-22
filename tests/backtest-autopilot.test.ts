import { describe, expect, it } from "vitest";
import { autopilotResearchStrategy, buyAndHoldStrategy, researchActions, researchBars, type DailyRow } from "@/core/backtest-autopilot";
import { runBacktest, type ResearchConfig } from "@/core/research";

const config: ResearchConfig = { initialCapital: "10000", periodsPerYear: 252, annualRiskFreeRate: 0.15,
  costs: { brokerageFixed: "0", brokerageBps: "0", exchangeFeeBps: "3", spreadBps: "10", slippageBps: "5" } };
function rows(closes: number[], start = "2025-01-02"): DailyRow[] {
  const day = new Date(`${start}T00:00:00Z`);
  return closes.map((close) => {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
    const row = { date: day.toISOString().slice(0, 10), open: close.toFixed(2), high: (close * 1.01).toFixed(2), low: (close * 0.99).toFixed(2), close: close.toFixed(2), volume: "1000" };
    day.setUTCDate(day.getUTCDate() + 1);
    return row;
  });
}
const dataset = (bars: ReturnType<typeof researchBars>, actions: ReturnType<typeof researchActions>["actions"] = []) => ({
  source: "synthetic", asOf: "2026-10-01T00:00:00.000Z", priceBasis: "RAW" as const, bars, corporateActions: actions,
  corporateActionsVerifiedThrough: bars[bars.length - 1].closedAt });

describe("autopilot research adapter", () => {
  it("maps official events to the first trading day after the record date, merging same-day cash", () => {
    const bars = researchBars(rows([10, 10, 10, 10], "2025-03-03"));
    const { actions, notes } = researchActions([
      { kind: "CASH", label: "DIVIDENDO", isin: "BRTESTACNOR0", value: "0.50", lastDatePrior: "2025-03-03", paymentDate: "2025-04-01" },
      { kind: "CASH", label: "JRS CAP PROPRIO", isin: "BRTESTACNOR0", value: "1.00", lastDatePrior: "2025-03-03", paymentDate: "2025-04-10" },
      { kind: "BONUS", label: "BONIFICACAO", isin: "BRTESTACNOR0", value: "5", lastDatePrior: "2025-03-04", paymentDate: null },
      { kind: "GROUPING", label: "GRUPAMENTO", isin: "BRTESTACNOR0", value: "0.1", lastDatePrior: "2024-01-01", paymentDate: null },
    ], bars);
    expect(actions).toEqual([
      { id: "cash:2025-03-04T13:00:00.000Z", type: "CASH_DIVIDEND", effectiveAt: "2025-03-04T13:00:00.000Z", availableAt: "2025-03-04T13:00:00.000Z", payableAt: "2025-04-10T13:00:00.000Z", cashPerShare: "1.35" },
      { id: "split:2025-03-05T13:00:00.000Z", type: "SPLIT", effectiveAt: "2025-03-05T13:00:00.000Z", availableAt: "2025-03-05T13:00:00.000Z", ratio: "1.05" },
    ]);
    expect(notes).toEqual([]);
  });

  it("buys whole standard lots in an uptrend and exits when the trend turns", () => {
    const closes = [...Array.from({ length: 70 }, (_, i) => 10 + i * 0.1), ...Array.from({ length: 60 }, (_, i) => 16.9 - i * 0.15)];
    const result = runBacktest(dataset(researchBars(rows(closes))), autopilotResearchStrategy(), config);
    expect(result.fills[0].side).toBe("BUY");
    expect(Number(result.fills[0].quantity) % 100).toBe(0);
    expect(result.fills.some((f) => f.side === "SELL")).toBe(true);
    expect(result.finalQuantity).toBe("0");
  });

  it("keeps averages and the stop continuous across a 1→2 split", () => {
    const before = Array.from({ length: 80 }, (_, i) => 20 + i * 0.05);
    const after = Array.from({ length: 10 }, (_, i) => (20 + 80 * 0.05) / 2 + i * 0.02);
    const bars = researchBars(rows([...before, ...after]));
    const split = bars[80].timestamp;
    const result = runBacktest(dataset(bars, [{ id: "s", type: "SPLIT", effectiveAt: split, availableAt: split, ratio: "2" }]),
      autopilotResearchStrategy(), config);
    // Without adjustment the halved price would look like a crash and trigger a sale.
    expect(result.fills.filter((f) => f.side === "SELL")).toHaveLength(0);
    expect(Number(result.finalQuantity)).toBeGreaterThan(0);
  });

  it("benchmarks buy and hold with the same lots and costs", () => {
    const result = runBacktest(dataset(researchBars(rows(Array.from({ length: 60 }, (_, i) => 10 + i * 0.05)))), buyAndHoldStrategy(), config);
    expect(result.fills).toHaveLength(1);
    expect(result.metrics.totalReturn).toBeGreaterThan(0);
  });
  it("can credit split fractions in cash instead of refusing the run", () => {
    const bars = researchBars(rows(Array.from({ length: 60 }, (_, i) => 10 + i * 0.05)));
    const at = bars[55].timestamp;
    const data = dataset(bars, [{ id: "b", type: "SPLIT", effectiveAt: at, availableAt: at, ratio: "1.005" }]);
    expect(() => runBacktest(data, buyAndHoldStrategy(), config)).toThrow("FRACTIONAL_SPLIT_UNSUPPORTED");
    const result = runBacktest(data, buyAndHoldStrategy(), { ...config, fractionalShares: "CASH_IN_LIEU" });
    expect(Number(result.finalQuantity) % 1).toBe(0);
    expect(Number(result.finalCash)).toBeGreaterThan(Number(runBacktest(dataset(bars), buyAndHoldStrategy(), config).finalCash));
  });
});

