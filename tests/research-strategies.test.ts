import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { autopilotResearchStrategy, buyAndHoldStrategy, researchActions, researchBars, type DailyRow } from "@/core/backtest-autopilot";
import { breakoutResearchStrategy, levelsResearchStrategy, LEVELS_DEFAULTS, longTrendResearchStrategy, trailingHoldResearchStrategy } from "@/core/strategies";
import { runBacktest, type ResearchConfig, type ResearchStrategy } from "@/core/research";
import { isinPrefix, type CorporateEvent } from "@/core/corporate-actions";
import { fetchB3Events } from "@/providers/b3-events";

/**
 * Opt-in comparison of candidate agent rules on official B3 history (see
 * research-autopilot.test.ts for data preparation). Writes ATLAS_STRATEGIES_OUT.
 */
const CSV = process.env.ATLAS_BACKTEST_CSV;
const config: ResearchConfig = { initialCapital: "10000", periodsPerYear: 252, annualRiskFreeRate: 0.13,
  costs: { brokerageFixed: "0", brokerageBps: "0", exchangeFeeBps: "3", spreadBps: "10", slippageBps: "5" }, fractionalShares: "CASH_IN_LIEU" };
const CANDIDATES: [string, () => ResearchStrategy][] = [
  ["Atual: médias 20/50 + stop 8%", () => autopilotResearchStrategy()],
  ["Níveis: piso/teto 20 dias, tendência 100", () => levelsResearchStrategy()],
  ["Níveis: piso/teto 40 dias, tendência 100", () => levelsResearchStrategy({ ...LEVELS_DEFAULTS, lookback: 40, lot: 100 })],
  ["Níveis: piso/teto 20 dias, tendência 200", () => levelsResearchStrategy({ ...LEVELS_DEFAULTS, trendPeriod: 200, lot: 100 })],
  ["Rompimento: máxima 55 / mínima 20", () => breakoutResearchStrategy()],
  ["Rompimento: máxima 20 / mínima 10", () => breakoutResearchStrategy({ entryLookback: 20, exitLookback: 10, lot: 100 })],
  ["Segurar acima da média de 200 dias", () => longTrendResearchStrategy()],
  ["Segurar acima da média de 100 dias", () => longTrendResearchStrategy({ period: 100, bufferPct: 2, lot: 100 })],
  ["Segurar com stop móvel de 20%", () => trailingHoldResearchStrategy()],
  ["Segurar com stop móvel de 15%", () => trailingHoldResearchStrategy({ trailPct: 15, reentryLookback: 20, lot: 100 })],
  ["Comprar e segurar (referência)", () => buyAndHoldStrategy()],
];
const PERIODS: [string, string, string][] = [["Período completo", "0000", "9999"], ["2023–2024", "2023-01-01", "2024-12-31"], ["2025–2026", "2025-01-01", "2026-12-31"]];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function cdi(from: string, to: string) {
  const br = (d: string) => d.split("-").reverse().join("/");
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(from)}&dataFinal=${br(to)}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (response.ok) return ((await response.json()) as { valor: string }[]).reduce((f, r) => f * (1 + Number(r.valor) / 100), 1) - 1;
    if (attempt === 3) throw new Error(`BCB SGS 12 unavailable (${response.status})`);
    await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
  }
}

it.skipIf(!CSV)("compares candidate rules on official B3 history", async () => {
  const lines = readFileSync(CSV!, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const all = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])) as unknown as DailyRow & { ticker: string });
  const last = all.reduce((m, r) => (r.date > m ? r.date : m), "0000");
  const tickers = [...new Set(all.map((r) => r.ticker))].sort()
    .filter((t) => Date.parse(last) - Date.parse(all.filter((r) => r.ticker === t).at(-1)!.date) <= 10 * 86400000);
  const events = new Map<string, CorporateEvent[]>();
  for (const t of tickers) {
    const prefix = isinPrefix(t);
    for (let attempt = 0; attempt < 2 && !events.has(t); attempt++) {
      try { events.set(t, (await fetchB3Events(t.slice(0, 4))).filter((e) => prefix && e.isin.startsWith(prefix))); }
      catch { await new Promise((r) => setTimeout(r, 3000)); }
    }
  }
  const out: string[] = [`# Comparação de regras para as IAs`, "",
    `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-strategies.test.ts\` (execução manual). Dados oficiais da B3 (${tickers.length} ações, lote padrão), eventos oficiais da B3, custos hipotéticos (taxas B3 0,03%, meio spread e slippage 0,05% cada por lado), decisão no fechamento e execução na abertura seguinte. Sem eventos B3 para: ${tickers.filter((t) => !events.has(t)).join(", ") || "nenhuma"}.`, ""];
  for (const [name, from, to] of PERIODS) {
    const rows = all.filter((r) => r.date >= from && r.date <= to);
    const first = rows.reduce((m, r) => (r.date < m ? r.date : m), "9999"), end = rows.reduce((m, r) => (r.date > m ? r.date : m), "0000");
    const benchmark = await cdi(first, end);
    out.push(`## ${name} (${first} a ${end}) · CDI ${pct(benchmark)}`, "",
      "| Regra | Retorno médio | Mediana | Bate o CDI | Bate segurar | Pior queda média | Operações por ação |", "| --- | --- | --- | --- | --- | --- | --- |");
    const hold = new Map<string, number>();
    const results: [string, number[], number[], number[], string[]][] = [];
    for (const [label, make] of CANDIDATES) {
      const returns: number[] = [], drawdowns: number[] = [], trades: number[] = [], beats: string[] = [];
      for (const t of tickers) {
        const daily = rows.filter((r) => r.ticker === t);
        if (daily.length < 60) continue;
        const bars = researchBars(daily);
        const { actions } = researchActions(events.get(t) ?? [], bars);
        try {
          const result = runBacktest({ source: "B3", asOf: new Date().toISOString(), priceBasis: "RAW", bars, corporateActions: actions,
            corporateActionsVerifiedThrough: bars[bars.length - 1].closedAt }, make(), config);
          returns.push(result.metrics.totalReturn); drawdowns.push(result.metrics.maxDrawdown); trades.push(result.trades.length);
          if (label.startsWith("Comprar")) hold.set(t, result.metrics.totalReturn);
          else beats.push(t);
        } catch { /* reported below as missing */ }
      }
      results.push([label, returns, drawdowns, trades, beats]);
    }
    for (const [label, returns, drawdowns, trades] of results) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const sorted = [...returns].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
      const holdValues = [...hold.values()];
      const beatHold = label.startsWith("Comprar") ? "—" : `${returns.filter((r, i) => r > holdValues[i]).length}/${returns.length}`;
      out.push(`| ${label} | ${pct(mean)} | ${pct(median)} | ${returns.filter((r) => r > benchmark).length}/${returns.length} | ${beatHold} | ${pct(drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length)} | ${(trades.reduce((a, b) => a + b, 0) / trades.length).toFixed(1)} |`);
    }
    out.push("");
  }
  out.push("## Como ler", "", "Uma regra só merece dinheiro real se for boa **nas duas metades** do período, não só no total: isso reduz a chance de o resultado ser sorte. Sem imposto. Resultado passado não garante resultado futuro.");
  writeFileSync(process.env.ATLAS_STRATEGIES_OUT ?? "BACKTEST_STRATEGIES.md", out.join("\n") + "\n");
}, 900000);
