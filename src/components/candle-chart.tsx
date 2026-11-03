"use client";
import { useEffect, useState } from "react";
import type { HistoricalBar } from "@/providers/types";
import { formatInstrumentPrice } from "@/components/daytrade/format";

/** A news day on the chart: ▲ above the candle (pode subir) or ▼ below (pode cair). */
export interface ChartMarker { date: string; direction: "UP" | "DOWN" | "WATCH"; title: string }

interface MinuteIndicators { vwap: number | null; ema9: number | null; ema21: number | null }

function minuteIndicators(bars: HistoricalBar[]): Map<string, MinuteIndicators> {
  const result = new Map<string, MinuteIndicators>();
  const dayOf = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
  const minuteOf = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  let day = "", volume = 0, turnover = 0, completeVwap = false, previousAt = NaN;
  let count = 0, ema9 = 0, ema21 = 0;
  for (const bar of bars) {
    const currentDay = dayOf(bar.timestamp), at = Date.parse(bar.timestamp), close = Number(bar.close);
    if (currentDay !== day) {
      day = currentDay; volume = 0; turnover = 0; count = 0; ema9 = close; ema21 = close;
      completeVwap = minuteOf(bar.timestamp) === "09:00"; previousAt = NaN;
    }
    if (!Number.isFinite(at) || !Number.isFinite(close) || close <= 0) {
      completeVwap = false; previousAt = NaN;
      result.set(bar.timestamp, { vwap: null, ema9: null, ema21: null });
      continue;
    }
    if (Number.isFinite(previousAt) && at - previousAt !== 60_000) {
      completeVwap = false;
      count = 0; ema9 = close; ema21 = close;
    }
    const quantity = Number(bar.volume), tradeTurnover = bar.turnover;
    if (!Number.isFinite(quantity) || quantity <= 0 || tradeTurnover == null || !Number.isFinite(Number(tradeTurnover)) || Number(tradeTurnover) <= 0) {
      completeVwap = false;
    } else if (completeVwap) {
      volume += quantity;
      turnover += Number(tradeTurnover);
    }
    count++;
    if (count > 1) {
      ema9 += (2 / 10) * (close - ema9);
      ema21 += (2 / 22) * (close - ema21);
    }
    previousAt = at;
    result.set(bar.timestamp, {
      vwap: completeVwap && volume > 0 ? turnover / volume : null,
      ema9: count >= 9 ? ema9 : null,
      ema21: count >= 21 ? ema21 : null,
    });
  }
  return result;
}

function indicatorPath(points: Array<{ x: number; value: number | null }>, y: (price: number) => number): string {
  let path = "", drawing = false;
  for (const point of points) {
    if (point.value === null || !Number.isFinite(point.value)) { drawing = false; continue; }
    path += `${drawing ? "L" : "M"}${point.x} ${y(point.value)} `;
    drawing = true;
  }
  return path.trim();
}

export function CandleChart({
  ticker,
  bars,
  markers = [],
  timeframe = "daily",
}: {
  ticker: string;
  bars: HistoricalBar[];
  markers?: ChartMarker[];
  timeframe?: "daily" | "minute";
}) {
  const [range, setRange] = useState(timeframe === "minute" ? 30 : 20);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => {
      setCompact(media.matches);
      if (media.matches) setRange((current) => Math.min(current, 20));
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const data = bars.slice(-range);
  if (!data.length)
    return <p>Histórico indisponível. Nenhum candle foi criado.</p>;
  const width = compact ? 390 : 720,
    height = compact ? 286 : 300,
    left = compact ? 68 : 78,
    right = compact ? 14 : 12,
    top = compact ? 18 : 16,
    floor = compact ? 184 : 215,
    volumeBase = compact ? 250 : 270,
    volumeHeight = compact ? 24 : 35;
  const plotWidth = width - left - right;
  const firstVisibleAt = Date.parse(data[0].timestamp), lastVisibleAt = Date.parse(data.at(-1)!.timestamp);
  const elapsedMinutes = Number.isFinite(firstVisibleAt) && Number.isFinite(lastVisibleAt)
    ? Math.max(0, (lastVisibleAt - firstVisibleAt) / 60_000) : 0;
  // Minute candles keep temporal spacing, so missing feed intervals remain visible.
  // Overnight periods are removed by the API's one-session chart window.
  const step = timeframe === "minute"
    ? plotWidth / Math.max(1, range - 1, elapsedMinutes)
    : plotWidth / data.length;
  const xForBar = (timestamp: string, index: number) => {
    if (timeframe !== "minute" || !Number.isFinite(firstVisibleAt)) return left + index * step + step / 2;
    const at = Date.parse(timestamp);
    return Number.isFinite(at) ? left + ((at - firstVisibleAt) / 60_000) * step + step / 2 : left + index * step + step / 2;
  };
  const indicators = timeframe === "minute" ? minuteIndicators(bars) : new Map<string, MinuteIndicators>();
  const visibleIndicators = data.map((bar, index) => ({
    x: xForBar(bar.timestamp, index),
    ...(indicators.get(bar.timestamp) ?? { vwap: null, ema9: null, ema21: null }),
  }));
  const prices = [
    ...data.flatMap((bar) => [Number(bar.low), Number(bar.high)]),
    ...visibleIndicators.flatMap((item) => [item.vwap, item.ema9, item.ema21].filter((value): value is number => value !== null)),
  ];
  const rawLow = Math.min(...prices), rawHigh = Math.max(...prices);
  // Give the wicks breathing room so candles never touch the top or bottom grid line.
  const padding = (rawHigh - rawLow || Math.max(rawHigh * 0.01, 1)) * (compact ? 0.08 : 0.04);
  const low = rawLow - padding,
    high = rawHigh + padding;
  const span = high - low || Math.max(high * 0.01, 1);
  const y = (price: string | number) =>
    top + ((high - Number(price)) / span) * (floor - top);
  const vwapPath = indicatorPath(visibleIndicators.map((point) => ({ x: point.x, value: point.vwap })), y);
  const ema9Path = indicatorPath(visibleIndicators.map((point) => ({ x: point.x, value: point.ema9 })), y);
  const ema21Path = indicatorPath(visibleIndicators.map((point) => ({ x: point.x, value: point.ema21 })), y);
  const volume = Math.max(...data.map((bar) => bar.volume), 1);
  const axisLabel = (timestamp: string) => timeframe === "minute"
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp))
    : timestamp.slice(0, 10);
  return (
    <figure className="candle-chart">
      <div className="section-heading">
        <h2>{ticker} · {timeframe === "minute" ? "Candles de 1 minuto" : "Histórico diário"}</h2>
        <label className="chart-range">
          Período
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
          >
            {timeframe === "minute" ? <><option value={20}>20 minutos</option><option value={30}>30 minutos</option><option value={60}>60 minutos</option>{!compact && <option value={180}>180 minutos</option>}</> : <><option value={20}>20 pregões</option><option value={60}>60 pregões</option>{!compact && <option value={100}>100 pregões</option>}</>}
          </select>
        </label>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${timeframe === "minute" ? "Candles de um minuto" : "Candles diários"} de ${ticker}, de ${data[0].timestamp} a ${data[data.length - 1].timestamp}.`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={width - right}
              y1={top + t * (floor - top)}
              y2={top + t * (floor - top)}
              stroke="var(--line)"
              strokeOpacity={compact ? 0.72 : 1}
            />
            <text
              x={left - 8}
              y={top + t * (floor - top) + 4}
              textAnchor="end"
              fill="var(--muted)"
              fontSize={compact ? "11" : "10"}
            >
              {formatInstrumentPrice(ticker, high - t * span)}
            </text>
          </g>
        ))}
        {data.map((bar, i) => {
          const x = xForBar(bar.timestamp, i);
          const color =
            Number(bar.close) >= Number(bar.open)
              ? "var(--green)"
              : "var(--red)";
          return (
            <g key={bar.timestamp}>
              <title>
                {bar.timestamp.slice(0, 10)} · Abertura {formatInstrumentPrice(ticker, Number(bar.open))} · Máxima{" "}
                {formatInstrumentPrice(ticker, Number(bar.high))} · Mínima {formatInstrumentPrice(ticker, Number(bar.low))} · Fechamento {formatInstrumentPrice(ticker, Number(bar.close))} · Volume{" "}
                {bar.volume}
              </title>
              <line
                x1={x}
                x2={x}
                y1={y(bar.high)}
                y2={y(bar.low)}
                stroke={color}
              />
              <rect
                x={x - step * 0.28}
                y={Math.min(y(bar.open), y(bar.close))}
                width={Math.max(1, step * 0.56)}
                height={Math.max(1, Math.abs(y(bar.open) - y(bar.close)))}
                fill={color}
              />
              <rect
                x={x - step * 0.28}
                y={volumeBase - (bar.volume / volume) * volumeHeight}
                width={Math.max(1, step * 0.56)}
                height={Math.max(0, (bar.volume / volume) * volumeHeight)}
                fill={color}
                opacity=".45"
              />
            </g>
          );
        })}
        {vwapPath && <path d={vwapPath} className="chart-indicator chart-vwap" vectorEffect="non-scaling-stroke"><title>VWAP ponderada por negócios do pregão</title></path>}
        {ema9Path && <path d={ema9Path} className="chart-indicator chart-ema9" vectorEffect="non-scaling-stroke"><title>EMA 9 calculada sobre candles completos da sessão</title></path>}
        {ema21Path && <path d={ema21Path} className="chart-indicator chart-ema21" vectorEffect="non-scaling-stroke"><title>EMA 21 calculada sobre candles completos da sessão</title></path>}
        {data.map((bar, i) => {
          const day = markers.filter((m) => m.date === bar.timestamp.slice(0, 10));
          if (!day.length) return null;
          const x = xForBar(bar.timestamp, i);
          const up = day.filter((m) => m.direction === "UP").length, down = day.filter((m) => m.direction === "DOWN").length;
          const direction = up > down ? "UP" : down > up ? "DOWN" : "WATCH";
          const yy = direction === "DOWN" ? Math.min(floor + 10, y(bar.low) + 10) : Math.max(top + 2, y(bar.high) - 10);
          const shape = direction === "DOWN" ? `M${x - 5} ${yy - 4} L${x + 5} ${yy - 4} L${x} ${yy + 4} Z` : direction === "UP"
            ? `M${x - 5} ${yy + 4} L${x + 5} ${yy + 4} L${x} ${yy - 4} Z` : `M${x} ${yy - 5} L${x + 5} ${yy} L${x} ${yy + 5} L${x - 5} ${yy} Z`;
          return (
            <path key={`news-${bar.timestamp}`} d={shape} className={`chart-news ${direction.toLowerCase()}`}>
              <title>{`${bar.timestamp.slice(0, 10)} · ${day.length} notícia(s): ${day.map((m) => m.title).join(" | ").slice(0, 600)}`}</title>
            </path>
          );
        })}
        <text x={left} y={height - 8} fill="var(--muted)" fontSize={compact ? "10" : "10"}>
          {axisLabel(data[0].timestamp)}
        </text>
        <text
          x={width - right}
          y={height - 8}
          fill="var(--muted)"
          fontSize={compact ? "10" : "10"}
          textAnchor="end"
        >
          {axisLabel(data[data.length - 1].timestamp)}
        </text>
      </svg>
      {timeframe === "minute" && <div className="chart-legend" aria-label="Indicadores do gráfico">
        {vwapPath && <span className="vwap">VWAP · negócios</span>}
        {ema9Path && <span className="ema9">EMA 9</span>}
        {ema21Path && <span className="ema21">EMA 21</span>}
        {!vwapPath && <span className="indicator-unavailable">VWAP indisponível: sessão incompleta ou sem turnover validado.</span>}
      </div>}
      <figcaption>{timeframe === "minute" ? "OHLCV dos candles fechados, agregado de negócios ProfitDLL. Somente leitura." : "EOD · OHLCV bruto da brapi. Candles do dia corrente são excluídos. Não é um feed de execução."}{markers.length > 0 && " ▲ notícia · ▼ notícia · ◆ atenção (passe o mouse para ler)."}</figcaption>
      <details>
        <summary>Ver dados em tabela</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Abertura</th>
                <th>Máxima</th>
                <th>Mínima</th>
                <th>Fechamento</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {data.map((bar) => (
                <tr key={bar.timestamp}>
                  <td>{bar.timestamp.slice(0, 10)}</td>
                  <td>{bar.open}</td>
                  <td>{bar.high}</td>
                  <td>{bar.low}</td>
                  <td>{bar.close}</td>
                  <td>{bar.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
