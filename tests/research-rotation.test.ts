import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { ROTATION_DEFAULTS, runEqualWeightHold, runRotation, type RotationOptions, type RotationResult, type SeriesBar } from "@/core/rotation";
import { isinPrefix, type CorporateEvent } from "@/core/corporate-actions";
import { fetchB3Events } from "@/providers/b3-events";

/**
 * Opt-in portfolio rotation research on official B3 history (see research-autopilot.test.ts
 * for the CSV). All variants are compared on the same windows, starting 2024-01-02 so the
 * longest warm-up (252 sessions) is complete. Writes ATLAS_ROTATION_OUT.
 */
const CSV = process.env.ATLAS_BACKTEST_CSV;
const VARIANTS: [string, Partial<RotationOptions>][] = [
  ["Top 3 · força 6 meses · tendência 200 · troca mensal", {}],
  ["Top 2 · força 6 meses · tendência 200 · troca mensal", { top: 2 }],
  ["Top 5 · força 6 meses · tendência 200 · troca mensal", { top: 5 }],
  ["Top 3 · força 3 meses · tendência 100 · troca mensal", { lookback: 63, trendPeriod: 100 }],
  ["Top 3 · força 12 meses · tendência 200 · troca mensal", { lookback: 252 }],
  ["Top 3 · força 6 meses · sem filtros · troca mensal", { trendPeriod: 0, absoluteMomentum: false }],
  ["Top 3 · força 6 meses · tendência 200 · troca a cada 2 semanas", { rebalanceEvery: 10 }],
];
const WINDOWS: [string, string, string][] = [["2024-01 a 2026-10", "2024-01-02", "9999"], ["2024", "2024-01-02", "2024-12-31"], ["2025–2026", "2025-01-01", "9999"]];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function window(result: RotationResult, from: string, to: string) {
  const points = result.equity.filter((p) => p.date >= from && p.date <= to);
  if (points.length < 2) return { ret: NaN, dd: NaN };
  let peak = points[0].value, dd = 0;
  for (const p of points) { peak = Math.max(peak, p.value); dd = Math.max(dd, 1 - p.value / peak); }
  return { ret: points.at(-1)!.value / points[0].value - 1, dd, first: points[0].date, last: points.at(-1)!.date };
}

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

it.skipIf(!CSV)("portfolio rotation vs equal-weight hold and CDI", async () => {
  const lines = readFileSync(CSV!, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])) as Record<string, string>);
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), "0000");
  const series: Record<string, SeriesBar[]> = {};
  const missing: string[] = [];
  for (const ticker of [...new Set(rows.map((r) => r.ticker))].sort()) {
    const daily = rows.filter((r) => r.ticker === ticker);
    if (Date.parse(last) - Date.parse(daily.at(-1)!.date) > 10 * 86400000) continue; // delisted code
    const prefix = isinPrefix(ticker);
    let events: CorporateEvent[] | null = null;
    for (let attempt = 0; attempt < 2 && !events; attempt++) {
      try { events = (await fetchB3Events(ticker.slice(0, 4))).filter((e) => prefix && e.isin.startsWith(prefix) && e.kind !== "CASH"); }
      catch { await new Promise((r) => setTimeout(r, 3000)); }
    }
    if (!events) missing.push(ticker);
    const ratios = (events ?? []).map((e) => ({ date: e.lastDatePrior, ratio: e.kind === "GROUPING" ? Number(e.value) : 1 + Number(e.value) / 100 }));
    series[ticker] = daily.map((r) => {
      const factor = ratios.filter((x) => r.date <= x.date).reduce((f, x) => f * x.ratio, 1);
      return { date: r.date, open: Number(r.open) / factor, close: Number(r.close) / factor };
    });
  }
  const hold = runEqualWeightHold(series);
  const results: [string, RotationResult][] = VARIANTS.map(([name, patch]) => [name, runRotation(series, { ...ROTATION_DEFAULTS, ...patch })]);
  const out = [`# Rotação de carteira: as IAs escolhem as ações mais fortes`, "",
    `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-rotation.test.ts\` (execução manual). ${Object.keys(series).length} ações, preços oficiais da B3 ajustados por desdobramentos/grupamentos/bonificações; proventos em dinheiro ignorados também na referência. Decisão no fechamento, execução na abertura seguinte, custo de 0,13% por operação. Sem eventos B3 para: ${missing.join(", ") || "nenhuma"}.`, ""];
  for (const [label, from, to] of WINDOWS) {
    const base = window(hold, from, to);
    const benchmark = await cdi(base.first!, base.last!);
    out.push(`## ${label} (${base.first} a ${base.last}) · CDI ${pct(benchmark)}`, "", "| Regra | Retorno | Pior queda | Operações (período todo) |", "| --- | --- | --- | --- |");
    for (const [name, result] of results) {
      const w = window(result, from, to);
      out.push(`| ${name} | ${pct(w.ret)} | ${pct(w.dd)} | ${result.trades} |`);
    }
    out.push(`| Comprar e segurar as ${Object.keys(series).length} ações (referência) | ${pct(base.ret)} | ${pct(base.dd)} | ${hold.trades} |`, "");
  }
  out.push("## Como ler", "", "A regra só serve se for melhor que o CDI **e** que comprar e segurar nas duas janelas parciais. Sem imposto. Resultado passado não garante resultado futuro.");
  writeFileSync(process.env.ATLAS_ROTATION_OUT ?? "BACKTEST_ROTATION.md", out.join("\n") + "\n");
}, 900000);
