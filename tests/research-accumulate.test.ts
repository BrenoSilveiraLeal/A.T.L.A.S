import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { ACCUMULATE_DEFAULTS, type AccumulateOptions } from "@/core/accumulate";
import { simulateCdi, simulatePlan, simulateTeamPlan, type SimBar, type SimDividend, type SimRule } from "@/core/accumulate-sim";
import { isinPrefix } from "@/core/corporate-actions";
import { fetchB3CashHistory, fetchB3Events } from "@/providers/b3-events";

/**
 * Opt-in: the owner's plan (R$ 200/month split over the team) on official B3 history, with the
 * "accumulate on dips, sell near the top" rule against buying every month and against the CDI.
 * ATLAS_BACKTEST_CSV: date,ticker,isin,open,high,low,close,volume. Writes ATLAS_ACCUMULATE_OUT.
 */
const CSV = process.env.ATLAS_BACKTEST_CSV;
const TEAM = ["PETR4", "VALE3", "ITUB4", "B3SA3", "AXIA3", "EMBJ3"];
const MONTHLY = 200 / TEAM.length;
const PERIODS: [string, string, string][] = [["2023-01 a 2026-10", "0000", "9999"], ["2023–2024", "2023-01-01", "2024-12-31"], ["2025–2026", "2025-01-01", "2026-12-31"]];
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const variants: [string, SimRule][] = [
  ["Comprar todo mês (sem estratégia)", { kind: "monthly" }],
  ...([["Compra todo mês e vende com +40% depois de virar 8% do topo", -1000, 40], ["Compra todo mês e vende com +60% depois de virar 8% do topo", -1000, 60],
    ["Compra todo mês e vende com +100% depois de virar 8% do topo", -1000, 100],
    ["Compra todo mês, pula se estiver 10% acima do preço médio; vende com +60%", -10, 60],
    ["Compra todo mês, pula se estiver 10% acima do preço médio; nunca vende", -10, 100000]] as [string, number, number][])
    .map(([name, averageDownPct, targetPct]): [string, SimRule] => [name, { kind: "accumulate", options: { ...ACCUMULATE_DEFAULTS, dipPct: 0, averageDownPct, targetPct, confirm: false } }]),
  ...[63, 126, 252].flatMap((window) => [2, 5, 10].map((nearPct): [string, SimRule] => [
    `Faixa: compra perto da mínima de ${Math.round(window / 21)} meses, vende perto da máxima (±${nearPct}%)`,
    { kind: "range", options: { window, nearPct, minGainPct: 3 } },
  ])),
  ...[10, 15, 20, 25].flatMap((dip) => [20, 40, 60].map((target): [string, SimRule] => [
    `Acumular: compra ${dip}% abaixo da máxima, vende com +${target}%`,
    { kind: "accumulate", options: { ...ACCUMULATE_DEFAULTS, dipPct: dip, targetPct: target } as AccumulateOptions },
  ])),
];

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) { if (attempt === 4) throw error; await new Promise((r) => setTimeout(r, 4000 * attempt)); }
  }
}

async function cdiDaily(from: string, to: string) {
  const br = (d: string) => d.split("-").reverse().join("/");
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(from)}&dataFinal=${br(to)}`, { signal: AbortSignal.timeout(30000) });
  const rows = (await r.json()) as { data: string; valor: string }[];
  return new Map(rows.map((x) => [x.data.split("/").reverse().join("-"), Number(x.valor)]));
}

it.skipIf(!CSV)("owner's monthly plan: accumulate on dips vs monthly buying vs CDI", async () => {
  const lines = readFileSync(CSV!, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])));
  const data = new Map<string, { bars: SimBar[]; dividends: SimDividend[] }>();
  for (const t of TEAM) {
    const daily = rows.filter((r) => r.ticker === t).sort((a, b) => a.date.localeCompare(b.date));
    const prefix = isinPrefix(t);
    const stock = (await retry(() => fetchB3Events(t.slice(0, 4)))).filter((e) => e.kind !== "CASH" && prefix && e.isin.startsWith(prefix));
    const ratios = stock.map((e) => ({ date: e.lastDatePrior, ratio: e.kind === "GROUPING" ? Number(e.value) : 1 + Number(e.value) / 100 }));
    const factor = (date: string) => ratios.filter((x) => date <= x.date).reduce((f, x) => f * x.ratio, 1);
    const bars = daily.map((r) => ({ date: r.date, open: Number(r.open) / factor(r.date), close: Number(r.close) / factor(r.date) }));
    const cash = await retry(() => fetchB3CashHistory(t));
    // Credit on the first session after the "data com"; JCP net of 15% income tax.
    const dividends = cash.flatMap((e) => {
      const ex = bars.find((b) => b.date > e.lastDatePrior);
      return ex ? [{ date: ex.date, perShare: (Number(e.value) * (/JRS/.test(e.label) ? 0.85 : 1)) / factor(e.lastDatePrior) }] : [];
    });
    data.set(t, { bars, dividends });
  }
  const allDates = [...new Set([...data.values()].flatMap((d) => d.bars.map((b) => b.date)))].sort();
  const cdi = await retry(() => cdiDaily(allDates[0], allDates.at(-1)!));
  const out = [`# Plano mensal: acumular na baixa e vender na alta`, "",
    `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-accumulate.test.ts\` (execução manual). Histórico oficial da B3 (AXIA3 inclui ELET3 e EMBJ3 inclui EMBR3, trocas de código 1 para 1).`, "",
    `**Plano:** R$ 200 por mês divididos entre ${TEAM.join(", ")} (R$ ${MONTHLY.toFixed(2)} por ação), depositados no 1º pregão do mês. Compra só com R$ 100 ou mais por ordem. Corretagem Genial R$ 0,99 por ordem, taxas B3, spread e slippage. Dividendos e JCP (líquido) incluídos. Dinheiro parado não rende. Sem imposto.`, ""];
  for (const [label, from, to] of PERIODS) {
    const dates = allDates.filter((d) => d >= from && d <= to);
    const base = simulateCdi(dates, cdi, 200);
    out.push(`## ${label} · ${dates[0]} a ${dates.at(-1)}`, "", `Depositado: R$ ${base.deposited.toFixed(2)} · no CDI viraria R$ ${base.finalValue.toFixed(2)} (**${pct(base.gain)}**)`, "",
      "| Regra | Valor final (6 ações) | Ganho sobre o depositado | Bate o CDI? | Operações |", "| --- | --- | --- | --- | --- |");
    for (const [name, rule] of variants) {
      let deposited = 0, value = 0, trades = 0;
      for (const t of TEAM) {
        const d = data.get(t)!;
        const r = simulatePlan(d.bars.filter((b) => b.date >= from && b.date <= to), d.dividends.filter((x) => x.date >= from && x.date <= to), MONTHLY, rule);
        deposited += r.deposited; value += r.finalValue; trades += r.trades;
      }
      const gain = value / deposited - 1;
      out.push(`| ${name} | R$ ${value.toFixed(2)} | ${pct(gain)} | ${gain > base.gain ? "sim" : "não"} | ${trades} |`);
    }
    for (const [picks, target] of [[1, 1e5], [2, 1e5], [1, 60], [2, 60], [2, 40], [3, 60]]) {
      const cut = new Map([...data].map(([t, d]) => [t, { bars: d.bars.filter((b) => b.date >= from && b.date <= to), dividends: d.dividends.filter((x) => x.date >= from && x.date <= to) }]));
      const r = simulateTeamPlan(cut, 200, picks, target);
      out.push(`| Equipe: todo mês compra a(s) ${picks} mais barata(s) vs. máxima de 1 ano; ${target > 1000 ? "nunca vende" : `vende com +${target}% após virar 8%`} | R$ ${r.finalValue.toFixed(2)} | ${pct(r.gain)} | ${r.gain > base.gain ? "sim" : "não"} | ${r.trades} |`);
    }
    out.push("");
  }
  // Stock by stock for the default rule over the whole period.
  out.push("## Por ação (regra padrão: compra 15% abaixo da máxima, vende com +40% após virar 8% do topo)", "", "| Ação | Depositado | Valor final | Ganho | Operações | Maior queda com ações na mão |", "| --- | --- | --- | --- | --- | --- |");
  for (const t of TEAM) {
    const d = data.get(t)!;
    const r = simulatePlan(d.bars, d.dividends, MONTHLY, { kind: "accumulate", options: ACCUMULATE_DEFAULTS });
    out.push(`| ${t} | R$ ${r.deposited.toFixed(2)} | R$ ${r.finalValue.toFixed(2)} | ${pct(r.gain)} | ${r.trades} | ${(r.worstDrop * 100).toFixed(1)}% |`);
  }
  out.push("", "## Como ler", "", "Ganho sobre o depositado = (valor final ÷ total depositado) − 1; como o dinheiro entra aos poucos, ele fica menos tempo aplicado do que num investimento feito de uma vez. Uma regra só serve se bater o CDI nas duas metades. Resultado passado não garante resultado futuro.");
  writeFileSync(process.env.ATLAS_ACCUMULATE_OUT ?? "BACKTEST_ACUMULAR.md", out.join("\n") + "\n");
}, 1800000);
