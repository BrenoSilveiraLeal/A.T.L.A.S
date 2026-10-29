"use client";
import { useState } from "react";
import { formatBrl } from "@/core/format";
import { swings } from "@/core/swings";
import { SELLS_NEAR_HIGH } from "@/core/range";

/**
 * Six months of daily candles for an agent's stock: the 6-month low and high, the buy and sell
 * lines, dates underneath and a tooltip with the day's prices and change. Next to it, the main
 * rises and falls of the period with their dates and size.
 */
export interface Bar { date: string; open: number; high: number; low: number; close: number }
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const brl = (v: number) => formatBrl(v.toFixed(2));
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

export function PriceHistory({ ticker, bars, levels }: {
  ticker: string; bars: readonly Bar[]; levels: { low: number; high: number; buyBelow: number; sellAbove: number };
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (bars.length < 2) return null;
  const W = 640, H = 230, left = 56, right = 10, top = 12, bottom = 196;
  const lo = Math.min(...bars.map((b) => b.low), levels.buyBelow), hi = Math.max(...bars.map((b) => b.high), levels.sellAbove);
  const y = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const step = (W - left - right) / bars.length;
  const x = (i: number) => left + step * (i + 0.5);
  const lowIndex = bars.reduce((m, b, i) => (b.close < bars[m].close ? i : m), 0);
  const highIndex = bars.reduce((m, b, i) => (b.close > bars[m].close ? i : m), 0);
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const monthStarts = bars.flatMap((b, i) => (i === 0 || b.date.slice(5, 7) !== bars[i - 1].date.slice(5, 7) ? [i] : []));
  const legs = swings(bars.map((b) => ({ date: b.date, close: b.close })), 8).reverse();
  const shown = hover === null ? null : bars[hover];
  // Keep the low/high labels inside the chart near the edges.
  const anchor = (i: number) => (x(i) < left + 70 ? "start" : x(i) > W - right - 70 ? "end" : "middle");
  const prev = hover !== null && hover > 0 ? bars[hover - 1].close : null;
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * W;
    setHover(Math.min(bars.length - 1, Math.max(0, Math.floor((sx - left) / step))));
  };
  return (
    <div className="price-history">
      <span className="score-kicker">{ticker} · últimos 6 meses (fechamento)</span>
      <div className="price-history-body">
        <div className="price-history-chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico de ${ticker} nos últimos 6 meses: mínima ${brl(levels.low)}, máxima ${brl(levels.high)}.`}
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((v) => <g key={v}><line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className="ph-grid" />
              <text x={left - 6} y={y(v) + 4} className="ph-axis" textAnchor="end">{v.toFixed(2).replace(".", ",")}</text></g>)}
            {monthStarts.map((i) => <text key={i} x={x(i)} y={H - 14} className="ph-axis" textAnchor="middle">{MONTHS[Number(bars[i].date.slice(5, 7)) - 1]}</text>)}
            <line x1={left} x2={W - right} y1={y(levels.buyBelow)} y2={y(levels.buyBelow)} className="ph-buy" />
            <text x={W - right} y={y(levels.buyBelow) - 4} className="ph-label buy" textAnchor="end">compra até {brl(levels.buyBelow)}</text>
            {SELLS_NEAR_HIGH && <line x1={left} x2={W - right} y1={y(levels.sellAbove)} y2={y(levels.sellAbove)} className="ph-sell" />}
            {SELLS_NEAR_HIGH && <text x={W - right} y={y(levels.sellAbove) + 12} className="ph-label sell" textAnchor="end">vende a partir de {brl(levels.sellAbove)}</text>}
            {bars.map((b, i) => {
              const up = b.close >= b.open;
              return <g key={b.date} className={up ? "ph-up" : "ph-down"}>
                <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} />
                <rect x={x(i) - step * 0.33} width={Math.max(1, step * 0.66)} y={y(Math.max(b.open, b.close))} height={Math.max(1, Math.abs(y(b.open) - y(b.close)))} />
              </g>;
            })}
            <circle cx={x(lowIndex)} cy={y(bars[lowIndex].close)} r="4" className="ph-mark low" />
            <text x={x(lowIndex)} y={Math.min(bottom - 4, y(bars[lowIndex].close) + 16)} className="ph-label buy" textAnchor={anchor(lowIndex)}>mín {brl(bars[lowIndex].close)} ({day(bars[lowIndex].date)})</text>
            <circle cx={x(highIndex)} cy={y(bars[highIndex].close)} r="4" className="ph-mark high" />
            <text x={x(highIndex)} y={Math.max(top + 12, y(bars[highIndex].close) - 8)} className="ph-label sell" textAnchor={anchor(highIndex)}>máx {brl(bars[highIndex].close)} ({day(bars[highIndex].date)})</text>
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={bottom} className="ph-cursor" />}
          </svg>
          {shown && <div className="ph-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
            <b>{shown.date.split("-").reverse().join("/")}</b>
            <span>Abertura {brl(shown.open)} · Fechamento <b>{brl(shown.close)}</b></span>
            <span>Máxima {brl(shown.high)} · Mínima {brl(shown.low)}</span>
            {prev !== null && <span className={shown.close >= prev ? "up" : "down"}>{shown.close >= prev ? "▲ subiu" : "▼ caiu"} {pct(shown.close / prev - 1)} ({brl(Math.abs(shown.close - prev))}) no dia</span>}
          </div>}
        </div>
        <ul className="price-history-swings" aria-label="Principais altas e quedas">
          {legs.length ? legs.slice(0, 6).map((l) => <li key={`${l.from.date}-${l.to.date}`} className={l.change >= 0 ? "up" : "down"}>
            <b>{l.change >= 0 ? "▲ Subiu" : "▼ Caiu"} {pct(l.change)}</b>
            <span>{brl(l.from.price)} ({day(l.from.date)}) → {brl(l.to.price)} ({day(l.to.date)})</span>
          </li>) : <li className="muted">Sem altas ou quedas de mais de 8% no período.</li>}
        </ul>
      </div>
    </div>
  );
}
