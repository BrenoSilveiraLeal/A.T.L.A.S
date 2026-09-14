"use client";
import { useState } from "react";
import type { HistoricalBar } from "@/providers/types";

export function CandleChart({
  ticker,
  bars,
}: {
  ticker: string;
  bars: HistoricalBar[];
}) {
  const [range, setRange] = useState(60);
  const data = bars.slice(-range);
  if (!data.length)
    return <p>Histórico indisponível. Nenhum candle foi criado.</p>;
  const width = 720,
    height = 300,
    left = 58,
    right = 12,
    top = 16,
    floor = 215;
  const low = Math.min(...data.map((bar) => Number(bar.low))),
    high = Math.max(...data.map((bar) => Number(bar.high)));
  const span = high - low || Math.max(high * 0.01, 1);
  const y = (price: string | number) =>
    top + ((high - Number(price)) / span) * (floor - top);
  const step = (width - left - right) / data.length;
  const volume = Math.max(...data.map((bar) => bar.volume), 1);
  return (
    <figure className="candle-chart">
      <div className="section-heading">
        <h2>{ticker} · Histórico diário</h2>
        <label className="chart-range">
          Período
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value))}
          >
            <option value={20}>20 pregões</option>
            <option value={60}>60 pregões</option>
            <option value={100}>100 pregões</option>
          </select>
        </label>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Candles diários reais de ${ticker}, de ${data[0].timestamp.slice(0, 10)} a ${data[data.length - 1].timestamp.slice(0, 10)}. Preços brutos, sem ajuste de eventos corporativos.`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={width - right}
              y1={top + t * (floor - top)}
              y2={top + t * (floor - top)}
              stroke="var(--line)"
            />
            <text
              x={left - 8}
              y={top + t * (floor - top) + 4}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="10"
            >
              {(high - t * span).toFixed(2)}
            </text>
          </g>
        ))}
        {data.map((bar, i) => {
          const x = left + i * step + step / 2;
          const color =
            Number(bar.close) >= Number(bar.open)
              ? "var(--green)"
              : "var(--red)";
          return (
            <g key={bar.timestamp}>
              <title>
                {bar.timestamp.slice(0, 10)} · Abertura {bar.open} · Máxima{" "}
                {bar.high} · Mínima {bar.low} · Fechamento {bar.close} · Volume{" "}
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
                y={270 - (bar.volume / volume) * 35}
                width={Math.max(1, step * 0.56)}
                height={Math.max(0, (bar.volume / volume) * 35)}
                fill={color}
                opacity=".45"
              />
            </g>
          );
        })}
        <text x={left} y={height - 8} fill="var(--muted)" fontSize="10">
          {data[0].timestamp.slice(0, 10)}
        </text>
        <text
          x={width - right}
          y={height - 8}
          fill="var(--muted)"
          fontSize="10"
          textAnchor="end"
        >
          {data[data.length - 1].timestamp.slice(0, 10)}
        </text>
      </svg>
      <figcaption>
        EOD · OHLCV bruto da brapi. Candles do dia corrente são excluídos. Não é
        um feed de execução.
      </figcaption>
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
