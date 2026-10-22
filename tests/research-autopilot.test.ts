import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { autopilotResearchStrategy, buyAndHoldStrategy, researchActions, researchBars, type DailyRow } from "@/core/backtest-autopilot";
import { runBacktest, type ResearchConfig, type ResearchResult } from "@/core/research";
import { isinPrefix } from "@/core/corporate-actions";
import { fetchB3Events } from "@/providers/b3-events";

/**
 * Opt-in research run (network + local official data). Not part of CI:
 *   python -I scripts/cotahist_extract.py bars.csv PETR4,... COTAHIST_A2023.ZIP ...
 *   ATLAS_BACKTEST_CSV=bars.csv ATLAS_BACKTEST_OUT=docs/BACKTEST_AUTOPILOT.md npx vitest run tests/research-autopilot.test.ts
 */
const CSV = process.env.ATLAS_BACKTEST_CSV;
const config: ResearchConfig = { initialCapital: "10000", periodsPerYear: 252, annualRiskFreeRate: 0.13,
  // Hypothetical: zero brokerage (to confirm with Genial), B3 fees ≈ 3 bps, half of a 10 bps spread, 5 bps slippage.
  costs: { brokerageFixed: "0", brokerageBps: "0", exchangeFeeBps: "3", spreadBps: "10", slippageBps: "5" },
  fractionalShares: "CASH_IN_LIEU" };

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
function yearly(result: ResearchResult) {
  const byYear = new Map<string, { first: number; last: number }>();
  let previous = Number(config.initialCapital);
  for (const point of result.equity) {
    const year = point.timestamp.slice(0, 4), equity = Number(point.equity);
    const entry = byYear.get(year) ?? { first: previous, last: equity };
    entry.last = equity;
    byYear.set(year, entry);
    previous = equity;
  }
  return new Map([...byYear].map(([y, e]) => [y, e.last / e.first - 1]));
}

async function cdi(from: string, to: string) {
  const br = (d: string) => d.split("-").reverse().join("/");
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(from)}&dataFinal=${br(to)}`;
  let rows: { data: string; valor: string }[] = [];
  for (let attempt = 1; ; attempt++) {
    // The BCB API intermittently answers 502 with an HTML page.
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (response.ok) { rows = await response.json(); break; }
    if (attempt === 3) throw new Error(`BCB SGS 12 unavailable (${response.status})`);
    await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
  }
  const byYear = new Map<string, number>();
  let total = 1;
  for (const r of rows) {
    const factor = 1 + Number(r.valor) / 100, year = r.data.slice(6);
    total *= factor;
    byYear.set(year, (byYear.get(year) ?? 1) * factor);
  }
  return { total: total - 1, byYear: new Map([...byYear].map(([y, f]) => [y, f - 1])), url };
}

it.skipIf(!CSV)("autopilot rule on official B3 history vs buy-and-hold and CDI", async () => {
  const lines = readFileSync(CSV!, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const all = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])) as unknown as DailyRow & { ticker: string });
  const tickers = [...new Set(all.map((r) => r.ticker))].sort();
  const first = all.reduce((m, r) => (r.date < m ? r.date : m), "9999"), last = all.reduce((m, r) => (r.date > m ? r.date : m), "0000");
  const benchmark = await cdi(first, last);
  const out: string[] = [];
  const rowsOut: string[] = [];
  const yearsOut: string[] = [];
  const notesOut: string[] = [];
  let sumAuto = 0, sumHold = 0, wins = 0, beatsCdi = 0, n = 0;
  for (const ticker of tickers) {
    const daily = all.filter((r) => r.ticker === ticker);
    const lastBar = daily[daily.length - 1].date;
    if (Date.parse(last) - Date.parse(lastBar) > 10 * 86400000) {
      notesOut.push(`${ticker}: excluída, último pregão em ${lastBar} (código deixou de ser negociado; comparação seria distorcida).`);
      continue;
    }
    const bars = researchBars(daily);
    const prefix = isinPrefix(ticker);
    let events: Awaited<ReturnType<typeof fetchB3Events>> = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try { events = (await fetchB3Events(ticker.slice(0, 4))).filter((e) => prefix && e.isin.startsWith(prefix)); break; }
      catch (e) {
        if (attempt) notesOut.push(`${ticker}: eventos da B3 indisponíveis (${String(e)}); resultado sem proventos/ajustes.`);
        else await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    const { actions, notes } = researchActions(events, bars);
    notes.forEach((x) => notesOut.push(`${ticker}: ${x}`));
    const dataset = { source: "B3 COTAHIST (oficial) + eventos B3", asOf: new Date().toISOString(), priceBasis: "RAW" as const,
      bars, corporateActions: actions, corporateActionsVerifiedThrough: bars[bars.length - 1].closedAt };
    let auto: ResearchResult, hold: ResearchResult;
    try {
      auto = runBacktest(dataset, autopilotResearchStrategy(), config);
      hold = runBacktest(dataset, buyAndHoldStrategy(), config);
    } catch (e) { notesOut.push(`${ticker}: backtest recusado pelo motor (${String(e)}).`); continue; }
    const a = auto.metrics, h = hold.metrics;
    n++; sumAuto += a.totalReturn; sumHold += h.totalReturn;
    if (a.totalReturn > h.totalReturn) wins++;
    if (a.totalReturn > benchmark.total) beatsCdi++;
    rowsOut.push(`| ${ticker} | ${pct(a.totalReturn)} | ${pct(h.totalReturn)} | ${pct(a.maxDrawdown)} | ${pct(h.maxDrawdown)} | ${auto.trades.length} | ${pct(a.winRate)} | ${pct(a.exposure)} | R$ ${Number(a.totalFees).toFixed(2)} |`);
    const ya = yearly(auto), yh = yearly(hold);
    yearsOut.push(`| ${ticker} | ${[...ya.keys()].map((y) => `${y}: ${pct(ya.get(y)!)} / ${pct(yh.get(y) ?? null)}`).join(" · ")} |`);
  }
  out.push(`# Backtest da regra do piloto automático`, "",
    `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-autopilot.test.ts\` (execução manual, fora do CI).`, "",
    `**Período:** ${first} a ${last}. **Dados:** cotações oficiais da B3 (COTAHIST, mercado à vista, lote padrão, preços brutos) e eventos oficiais da B3 (proventos, desdobramentos, grupamentos, bonificações).`,
    `**Regra:** a mesma do piloto (compra quando SMA20 > SMA50 e preço > SMA20; vende quando SMA20 < SMA50 ou cai 8% abaixo da entrada), decisão no fechamento e execução na abertura seguinte, lotes de 100 ações, R$ 10.000 por ação.`,
    `**Custos hipotéticos:** corretagem zero (a confirmar com a Genial), taxas B3 0,03%, meio spread 0,05% e slippage 0,05% por lado. Sem imposto. O contexto de notícias **não** entra no backtest (não há histórico das notícias disponíveis em cada dia).`, "",
    `## Resumo`, "",
    `- Ações testadas: **${n}**. Média do retorno total: piloto **${pct(sumAuto / n)}** × comprar e segurar **${pct(sumHold / n)}**.`,
    `- O piloto superou comprar e segurar em **${wins} de ${n}** ações e superou o **CDI do período (${pct(benchmark.total)})** em **${beatsCdi} de ${n}**.`, "",
    `## Por ação`, "",
    `| Ação | Retorno piloto | Retorno comprar e segurar | Pior queda piloto | Pior queda segurar | Operações | Acerto | Tempo posicionado | Custos |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`, ...rowsOut, "",
    `## Por ano (piloto / comprar e segurar)`, "", `| Ação | Anos |`, `| --- | --- |`, ...yearsOut, "",
    `CDI por ano: ${[...benchmark.byYear].map(([y, r]) => `${y}: ${pct(r)}`).join(" · ")} ([fonte BCB SGS 12](${benchmark.url})).`, "",
    `## Observações`, "", ...(notesOut.length ? notesOut.map((x) => `- ${x}`) : ["- Nenhuma."]), "",
    `## Como ler`, "",
    `Resultado passado não garante resultado futuro, e poucas ações e poucos anos não provam uma estratégia. O backtest serve para descobrir se a regra **faz sentido** antes de arriscar dinheiro: se ela não supera o CDI nem comprar e segurar com custos baixos, ela precisa mudar antes do dinheiro real.`);
  writeFileSync(process.env.ATLAS_BACKTEST_OUT ?? "BACKTEST_AUTOPILOT.md", out.join("\n") + "\n");
}, 600000);
