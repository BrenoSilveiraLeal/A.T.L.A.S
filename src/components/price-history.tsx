"use client";
import { useEffect, useState } from "react";
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

function ObservedQuotes({ ticker, points, source }: { ticker: string; points: readonly { price: number; at: string }[]; source: string }) {
  if (!points.length) return null;
  const first = points[0], last = points[points.length - 1];
  const min = Math.min(...points.map((point) => point.price)), max = Math.max(...points.map((point) => point.price));
  const padding = Math.max((max - min) * 0.15, max * 0.001, 0.01);
  const start = Date.parse(first.at), end = Date.parse(last.at);
  const x = (at: string) => start === end ? 320 : 64 + (Date.parse(at) - start) / (end - start) * 560;
  const y = (price: number) => 100 - (price - min + padding) / (max - min + 2 * padding) * 80;
  const time = (at: string) => new Date(at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return <div className="observed-quotes">
    <div><b>Cotação intradiária observada · {ticker}</b><span>{source === "MT5" ? "MT5 · consulta a cada 5 s" : "Fonte com atraso"}</span></div>
    <svg viewBox="0 0 640 135" role="img" aria-label={`Cotações observadas de ${ticker}, de ${time(first.at)} a ${time(last.at)}; última ${brl(last.price)}.`}>
      <text x="3" y="30" className="ph-axis">{brl(max)}</text>
      <text x="3" y="100" className="ph-axis">{brl(min)}</text>
      <path d={points.map((point, i) => `${i ? "L" : "M"}${x(point.at)} ${y(point.price)}`).join(" ")} className="ph-observed-line" />
      <circle cx={x(last.at)} cy={y(last.price)} r="4" className="ph-current-dot" />
      <text x="64" y="125" className="ph-axis">{time(first.at)}</text><text x="624" y="125" textAnchor="end" className="ph-axis">{time(last.at)}</text>
    </svg>
    <small>{new Date(last.at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {points.length === 1 ? "Aguardando a próxima cotação do feed." : `${points.length} amostras reais recebidas pelo aplicativo.`} A linha registra o período observado; o histórico completo do dia depende da fonte.</small>
  </div>;
}

export function PriceHistory({ ticker, bars, levels, liveQuote = null, now }: {
  ticker: string; bars: readonly Bar[]; levels: { low: number; high: number; buyBelow: number; sellAbove: number };
  liveQuote?: { price: number; at: string; source: string; points?: { price: number; at: string }[] } | null;
  now: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (bars.length < 2) return null;
  // A taller mobile viewBox keeps six months of candles legible in a narrow card.
  const W = compact ? 520 : 640, H = compact ? 300 : 230, left = 56, right = 10, top = 12, bottom = compact ? 258 : 196;
  const lastDate = bars.at(-1)!.date;
  const quoteTime = liveQuote ? Date.parse(liveQuote.at) : NaN;
  const quoteDate = Number.isFinite(quoteTime) ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(quoteTime)) : "";
  const current = liveQuote && Number.isFinite(quoteTime) && Number.isFinite(liveQuote.price) && liveQuote.price > 0 && quoteDate >= lastDate
    ? liveQuote : null;
  const currentIndex = current ? bars.length : -1;
  const slots = bars.length + (current ? 1 : 0);
  const lo = Math.min(...bars.map((b) => b.low), levels.buyBelow, ...(current ? [current.price] : []));
  const hi = Math.max(...bars.map((b) => b.high), ...(SELLS_NEAR_HIGH ? [levels.sellAbove] : []), ...(current ? [current.price] : []));
  const y = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const step = (W - left - right) / slots;
  const x = (i: number) => left + step * (i + 0.5);
  const closePath = bars.map((b, i) => `${i ? "L" : "M"}${x(i)} ${y(b.close)}`).join(" ");
  const currentX = current ? x(currentIndex) : null;
  const quoteAge = current ? now - quoteTime : Infinity;
  const currentLabel = current ? `${current.source === "MT5" && quoteAge >= 0 && quoteAge <= 30000 ? "AO VIVO" : "ÚLTIMA COTAÇÃO"} · ${new Date(quoteTime).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "";
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
      {liveQuote && <ObservedQuotes ticker={ticker} points={liveQuote.points ?? []} source={liveQuote.source} />}
      <span className="score-kicker">{ticker} · últimos 6 meses (fechamento){current ? ` · ${currentLabel}` : ` · último pregão ${lastDate.split("-").reverse().join("/")}`}</span>
      <div className="price-history-body">
        <div className="price-history-chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico de ${ticker} nos últimos 6 meses: mínima ${brl(levels.low)}, máxima ${brl(levels.high)}.${current ? ` Última cotação ${brl(current.price)} em ${currentLabel}.` : ` Último pregão exibido em ${lastDate}.`}`}
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((v) => <g key={v}><line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className="ph-grid" />
              <text x={left - 6} y={y(v) + 4} className="ph-axis" textAnchor="end">{v.toFixed(2).replace(".", ",")}</text></g>)}
            {monthStarts.map((i) => <text key={i} x={x(i)} y={H - 14} className="ph-axis" textAnchor="middle">{MONTHS[Number(bars[i].date.slice(5, 7)) - 1]}</text>)}
            <line x1={left} x2={W - right} y1={y(levels.buyBelow)} y2={y(levels.buyBelow)} className="ph-buy" />
            <text x={W - right} y={y(levels.buyBelow) - 4} className="ph-label buy" textAnchor="end">compra até {brl(levels.buyBelow)}</text>
            {SELLS_NEAR_HIGH && <line x1={left} x2={W - right} y1={y(levels.sellAbove)} y2={y(levels.sellAbove)} className="ph-sell" />}
            {SELLS_NEAR_HIGH && <text x={W - right} y={y(levels.sellAbove) + 12} className="ph-label sell" textAnchor="end">vende a partir de {brl(levels.sellAbove)}</text>}
            <path d={closePath} className="ph-close-line" />
            {current && currentX !== null && <>
              {currentIndex === bars.length && <path d={`M${x(bars.length - 1)} ${y(bars.at(-1)!.close)} L${currentX} ${y(current.price)}`} className="ph-live-link" />}
              <line x1={left} x2={W - right} y1={y(current.price)} y2={y(current.price)} className="ph-current-line" />
              <circle cx={currentX} cy={y(current.price)} r="4.5" className="ph-current-dot"><title>{currentLabel}: {brl(current.price)}</title></circle>
              <text x={W - right} y={Math.min(bottom - 5, Math.max(top + 11, y(current.price) - 7))} className="ph-label current" textAnchor="end">{brl(current.price)}</text>
            </>}
            {bars.map((b, i) => {
              const up = b.close >= b.open;
              return <g key={b.date} className={up ? "ph-up" : "ph-down"}>
                <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} />
                <rect x={x(i) - step * 0.33} width={Math.max(1, step * 0.66)} y={y(Math.max(b.open, b.close))} height={Math.max(1, Math.abs(y(b.open) - y(b.close)))} />
              </g>;
            })}
            <circle cx={x(lowIndex)} cy={y(bars[lowIndex].close)} r="4" className="ph-mark low" />
            <text x={x(lowIndex)} y={Math.min(bottom - 4, y(bars[lowIndex].close) + 16)} className="ph-label buy extreme" textAnchor={anchor(lowIndex)}>mín {brl(bars[lowIndex].close)} ({day(bars[lowIndex].date)})</text>
            <circle cx={x(highIndex)} cy={y(bars[highIndex].close)} r="4" className="ph-mark high" />
            <text x={x(highIndex)} y={Math.max(top + 12, y(bars[highIndex].close) - 8)} className="ph-label sell extreme" textAnchor={anchor(highIndex)}>máx {brl(bars[highIndex].close)} ({day(bars[highIndex].date)})</text>
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
