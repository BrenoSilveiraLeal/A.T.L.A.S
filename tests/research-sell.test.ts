import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { simulatePlan, type SimBar, type SimDividend, type SimRule } from "@/core/accumulate-sim";
import { RANGE_DEFAULTS } from "@/core/range";
import { isinPrefix } from "@/core/corporate-actions";
import { fetchB3CashHistory, fetchB3Events } from "@/providers/b3-events";

/**
 * Opt-in: owner, 27/10/2026 ("vender no melhor momento possível... lucro máximo"): ways to sell
 * against the rule in use, same purchases, on official B3 history.
 * ATLAS_BACKTEST_CSV: date,ticker,isin,open,high,low,close,volume. Writes ATLAS_SELL_OUT.
 */
const CSV = process.env.ATLAS_BACKTEST_CSV;
const MONTHLY = 100;
const PERIODS: [string, string, string][] = [["2023-01 a 2026-10", "0000", "9999"], ["2023–2024", "2023-01-01", "2024-12-31"], ["2025–2026", "2025-01-01", "2026-12-31"]];
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const variants: [string, SimRule][] = [
  ["EM USO: vende perto da máxima de 6 meses no primeiro dia de queda", { kind: "range", options: RANGE_DEFAULTS }],
  ...[2, 3, 5].map((d): [string, SimRule] => [`Perto da máxima, vende só quando cair ${d}% do topo desde a compra`, { kind: "range", options: { ...RANGE_DEFAULTS, sellDropPct: d } }]),
  ...[10, 15, 20].flatMap((arm) => [5, 8, 10].map((t): [string, SimRule] => [`Em uso + trava de lucro: depois de +${arm}%, vende se cair ${t}% do topo`, { kind: "range", options: { ...RANGE_DEFAULTS, trailArmPct: arm, trailPct: t } }])),
  ...[10, 20, 30].flatMap((arm) => [5, 10, 15].map((t): [string, SimRule] => [`Só a trava (deixa subir além da máxima): depois de +${arm}%, vende se cair ${t}% do topo`, { kind: "range", options: { ...RANGE_DEFAULTS, nearHighSell: false, trailArmPct: arm, trailPct: t } }])),
  ...[3, 5].flatMap((d) => [[15, 8], [20, 10]].map(([arm, t]): [string, SimRule] => [`Cair ${d}% do topo perto da máxima + trava +${arm}%/${t}%`, { kind: "range", options: { ...RANGE_DEFAULTS, sellDropPct: d, trailArmPct: arm, trailPct: t } }])),
];

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) { if (attempt === 4) throw error; await new Promise((r) => setTimeout(r, 4000 * attempt)); }
  }
}

it.skipIf(!CSV)("ways to sell vs the rule in use", async () => {
  const lines = readFileSync(CSV!, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])));
  const tickers = [...new Set(rows.map((r) => r.ticker))].sort();
  const data = new Map<string, { bars: SimBar[]; dividends: SimDividend[] }>();
  for (const t of tickers) {
    const daily = rows.filter((r) => r.ticker === t).sort((a, b) => a.date.localeCompare(b.date));
    const prefix = isinPrefix(t);
    const stock = (await retry(() => fetchB3Events(t.slice(0, 4)))).filter((e) => e.kind !== "CASH" && prefix && e.isin.startsWith(prefix));
    const ratios = stock.map((e) => ({ date: e.lastDatePrior, ratio: e.kind === "GROUPING" ? Number(e.value) : 1 + Number(e.value) / 100 }));
    const factor = (date: string) => ratios.filter((x) => date <= x.date).reduce((f, x) => f * x.ratio, 1);
    const bars = daily.map((r) => ({ date: r.date, open: Number(r.open) / factor(r.date), close: Number(r.close) / factor(r.date) }));
    const cash = await retry(() => fetchB3CashHistory(t));
    const dividends = cash.flatMap((e) => {
      const ex = bars.find((b) => b.date > e.lastDatePrior);
      return ex ? [{ date: ex.date, perShare: (Number(e.value) * (/JRS/.test(e.label) ? 0.85 : 1)) / factor(e.lastDatePrior) }] : [];
    });
    data.set(t, { bars, dividends });
  }
  const out = ["# Quando vender", "",
    `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-sell.test.ts\` (execução manual). Histórico oficial da B3 de ${tickers.length} ações (${tickers.join(", ")}).`, "",
    `**Plano:** R$ ${MONTHLY} por mês em cada ação, separadamente. Corretagem Genial R$ 0,99, taxas B3, spread e slippage, dividendos e JCP líquidos. Compra igual à regra em uso; muda só a venda, nunca abaixo do preço médio + 3%. Dinheiro parado não rende.`, ""];
  for (const [label, from, to] of PERIODS) {
    out.push(`## ${label}`, "", "| Regra | Valor final | Ganho sobre o depositado | Ações com lucro | Pior queda de uma posição (mediana) | Operações |", "| --- | --- | --- | --- | --- | --- |");
    const results = variants.map(([name, rule]) => {
      let deposited = 0, value = 0, trades = 0, winners = 0;
      const drops: number[] = [];
      for (const [, d] of data) {
        const r = simulatePlan(d.bars.filter((b) => b.date >= from && b.date <= to), d.dividends.filter((x) => x.date >= from && x.date <= to), MONTHLY, rule, 40);
        deposited += r.deposited; value += r.finalValue; trades += r.trades; if (r.finalValue > r.deposited) winners++; drops.push(r.worstDrop);
      }
      drops.sort((a, b) => a - b);
      return { name, deposited, value, trades, winners, drop: drops[Math.floor(drops.length / 2)] };
    });
    for (const r of results) out.push(`| ${r.name} | R$ ${r.value.toFixed(2)} | ${pct(r.value / r.deposited - 1)} | ${r.winners}/${data.size} | ${pct(-r.drop)} | ${r.trades} |`);
    out.push("", `Depositado: R$ ${results[0].deposited.toFixed(2)}`, "");
  }
  // Stock by stock with the rule in use: which stocks this way of trading suits.
  out.push("## Ação por ação com a regra em uso (2023-01 a 2026-10)", "", "| Ação | Ganho sobre o depositado | Operações |", "| --- | --- | --- |");
  const each = [...data].map(([t, d]) => ({ t, r: simulatePlan(d.bars, d.dividends, MONTHLY, { kind: "range", options: RANGE_DEFAULTS }, 40) }))
    .sort((a, b) => b.r.gain - a.r.gain);
  for (const { t, r } of each) out.push(`| ${t} | ${pct(r.gain)} | ${r.trades} |`);
  out.push("");
  writeFileSync(process.env.ATLAS_SELL_OUT ?? "docs/BACKTEST_VENDA.md", out.join("\n") + "\n");
}, 900000);
