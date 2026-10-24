import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { buyAndHoldStrategy, researchActions, researchBars, type DailyRow } from "@/core/backtest-autopilot";
import { trailingHoldResearchStrategy } from "@/core/strategies";
import { runBacktest, type ResearchConfig, type ResearchStrategy } from "@/core/research";
import { isinPrefix, type CorporateEvent } from "@/core/corporate-actions";
import { fetchB3CashHistory, fetchB3Events } from "@/providers/b3-events";

/**
 * Opt-in, stock by stock: the agents' rule (15% trailing stop, re-entry on a 20-day high) with
 * the owner's "never sell at a loss" floor, R$ 1.000 per stock in fractional shares and Genial's
 * real brokerage (R$ 0,99 per order) plus B3 fees. Whole period and both halves, against CDI and
 * buying and holding. Writes ATLAS_STOCKS_OUT. Needs ATLAS_BACKTEST_CSV (scripts/cotahist_extract.py).
 */
const CSV = process.env.ATLAS_BACKTEST_CSV;
const config: ResearchConfig = { initialCapital: "1000", periodsPerYear: 252, annualRiskFreeRate: 0.13,
  costs: { brokerageFixed: "0.99", brokerageBps: "0", exchangeFeeBps: "3", spreadBps: "10", slippageBps: "5" }, fractionalShares: "CASH_IN_LIEU" };
const RULE = () => trailingHoldResearchStrategy({ trailPct: 15, reentryLookback: 20, lot: 1, noLossPct: 1 });
const PERIODS: [string, string, string][] = [["2023-01 a 2026-10", "0000", "9999"], ["2023–2024", "2023-01-01", "2024-12-31"], ["2025–2026", "2025-01-01", "2026-12-31"]];
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

it.skipIf(!CSV)("ranks stocks for the agents' rule with the never-sell-at-a-loss floor", async () => {
  const lines = readFileSync(CSV!, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const all = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])) as unknown as DailyRow & { ticker: string });
  const last = all.reduce((m, r) => (r.date > m ? r.date : m), "0000");
  const tickers = [...new Set(all.map((r) => r.ticker))].sort().filter((t) => {
    const rows = all.filter((r) => r.ticker === t);
    return rows.length >= 500 && Date.parse(last) - Date.parse(rows.at(-1)!.date) <= 10 * 86400000;
  });
  // Exact ISIN from the official file: also covers units (TAEE11, BPAC11...), whose dividends
  // a share-class prefix would miss.
  const isinOf = new Map(all.map((r) => [r.ticker, (r as unknown as { isin: string }).isin]));
  const events = new Map<string, CorporateEvent[]>();
  for (const t of tickers) {
    const isin = isinOf.get(t) ?? isinPrefix(t);
    for (let attempt = 0; attempt < 2 && !events.has(t); attempt++) {
      try {
        // Stock events from the summary service; every dividend/JCP since 2023 from the full history.
        const stock = (await fetchB3Events(t.slice(0, 4))).filter((e) => e.kind !== "CASH" && isin && e.isin.startsWith(isin));
        events.set(t, [...stock, ...(await fetchB3CashHistory(t))]);
      }
      catch { await new Promise((r) => setTimeout(r, 3000)); }
    }
  }
  const run = (t: string, from: string, to: string, make: () => ResearchStrategy) => {
    const daily = all.filter((r) => r.ticker === t && r.date >= from && r.date <= to);
    const bars = researchBars(daily);
    const { actions } = researchActions(events.get(t) ?? [], bars);
    try {
      return runBacktest({ source: "B3", asOf: new Date().toISOString(), priceBasis: "RAW", bars, corporateActions: actions,
        corporateActionsVerifiedThrough: bars[bars.length - 1].closedAt }, make(), config);
    } catch { return null; }
  };
  const benchmarks: number[] = [];
  for (const [, from, to] of PERIODS) {
    const rows = all.filter((r) => r.date >= from && r.date <= to);
    benchmarks.push(await cdi(rows.reduce((m, r) => (r.date < m ? r.date : m), "9999"), rows.reduce((m, r) => (r.date > m ? r.date : m), "0000")));
  }
  const table = tickers.map((t) => {
    const rule = PERIODS.map(([, from, to]) => run(t, from, to, RULE));
    const hold = run(t, "0000", "9999", () => buyAndHoldStrategy(1));
    const lastClose = Number(all.filter((r) => r.ticker === t).at(-1)!.close);
    return { t, rule, hold, lastClose };
  }).filter((r) => r.rule.every(Boolean) && r.hold);
  table.sort((a, b) => b.rule[0]!.metrics.totalReturn - a.rule[0]!.metrics.totalReturn);
  const both = (r: (typeof table)[number]) => r.rule[1]!.metrics.totalReturn > benchmarks[1] && r.rule[2]!.metrics.totalReturn > benchmarks[2];
  const out = [`# Quais ações para as IAs`, "",
    `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-stocks.test.ts\` (execução manual). ${table.length} ações líquidas da B3 com histórico oficial (COTAHIST) de ${all.reduce((m, r) => (r.date < m ? r.date : m), "9999")} a ${last}.`,
    "", `**Regra testada:** a das IAs (compra ao passar da máxima de 20 pregões, vende após cair 15% do topo) **com a regra do dono: nunca vender abaixo de 1% acima do preço de compra**. R$ 1.000 por ação em fracionário, corretagem Genial R$ 0,99 por ordem, taxas B3 0,03%, spread e slippage. Decisão no fechamento, execução na abertura seguinte. Dividendos e JCP incluídos pelo histórico completo da B3 (JCP com 15% de IR descontado; pagamento aproximado em 30 dias após a data com); sem imposto sobre ganho.`,
    "", `CDI: período todo ${pct(benchmarks[0])} · 2023–2024 ${pct(benchmarks[1])} · 2025–2026 ${pct(benchmarks[2])}.`, "",
    "| Ação | Preço atual | Regra (todo) | 2023–2024 | 2025–2026 | Comprar e segurar | Pior queda | Operações | Bate o CDI nas duas metades |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...table.map((r) => `| ${r.t} | R$ ${r.lastClose.toFixed(2)} | ${pct(r.rule[0]!.metrics.totalReturn)} | ${pct(r.rule[1]!.metrics.totalReturn)} | ${pct(r.rule[2]!.metrics.totalReturn)} | ${pct(r.hold!.metrics.totalReturn)} | ${pct(r.rule[0]!.metrics.maxDrawdown)} | ${r.rule[0]!.trades.length} | ${both(r) ? "sim" : "não"} |`),
    "", `Ações que bateram o CDI nas duas metades: **${table.filter(both).map((r) => r.t).join(", ") || "nenhuma"}**.`, "",
    "## Como ler", "", "Resultado passado não garante resultado futuro. Uma ação boa nas duas metades tem menos chance de ter sido sorte, mas pode ir mal daqui para frente. Com a regra de nunca vender no prejuízo, uma ação que cai e não volta fica parada (aparece na pior queda)."];
  writeFileSync(process.env.ATLAS_STOCKS_OUT ?? "BACKTEST_ACOES.md", out.join("\n") + "\n");
}, 1800000);
