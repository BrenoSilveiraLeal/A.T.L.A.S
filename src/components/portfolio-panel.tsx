"use client";

import { useId } from "react";
import Link from "next/link";
import { formatBrl, formatDecimal } from "@/core/format";
import { portfolioChartGeometry, type PortfolioHistory } from "@/lib/portfolio";

const date = (value: string | number) => new Date(value).toLocaleString("pt-BR", {
  timeZone: "America/Sao_Paulo",
});
const day = (value: number) => new Date(value).toLocaleDateString("pt-BR", {
  timeZone: "America/Sao_Paulo",
});
function exact(value: string | null) {
  if (value === null) return "—";
  const places = value.split(".")[1]?.replace(/0+$/, "").length ?? 0;
  return formatDecimal(value, places);
}

export function PortfolioPanel({
  data,
  loading = false,
  error = "",
  onAccountChange,
  showPositions = false,
}: {
  data: PortfolioHistory | null;
  loading?: boolean;
  error?: string;
  onAccountChange?: (accountId: string) => void;
  showPositions?: boolean;
}) {
  const selectId = useId();
  const chart = data ? portfolioChartGeometry(data.snapshots) : null;
  const account = data?.brokerAccounts.find((row) => row.id === data.brokerAccountId);
  return (
    <section className="panel capital-panel" aria-busy={loading}>
      <div className="section-heading">
        <h2>Patrimônio ao longo do tempo</h2>
        <span className="muted">BRL</span>
      </div>
      {loading ? <p role="status">Consultando registros conciliados…</p> : error ? (
        <p role="alert">Não foi possível consultar o histórico patrimonial: {error}</p>
      ) : !data?.brokerAccountId ? (
        <div className="empty-state">
          <h3>O primeiro registro começa com uma conexão real.</h3>
          <div className="empty-copy">
            <p>Conecte uma corretora para registrar patrimônio e posições conciliados. A conta permanece sem histórico até receber esses dados.</p>
            <Link href="/app/settings" className="text-link">Ver requisitos de conexão</Link>
          </div>
        </div>
      ) : (
        <>
          {data.brokerAccounts.length > 1 && onAccountChange ? (
            <label className="chart-range" htmlFor={selectId}>
              Conta da corretora
              <select id={selectId} value={data.brokerAccountId} onChange={(event) => onAccountChange(event.target.value)}>
                {data.brokerAccounts.map((row) => <option key={row.id} value={row.id}>{row.provider} · {row.id.slice(0, 8)}</option>)}
              </select>
            </label>
          ) : <p className="muted">Conta {account?.provider} · {data.brokerAccountId.slice(0, 8)}</p>}
          {chart ? (
            <figure className="candle-chart">
              <svg viewBox="0 0 720 255" role="img" aria-label={`${chart.points.length} registros conciliados de patrimônio da conta ${account?.provider ?? "selecionada"}, de ${day(chart.start)} a ${day(chart.end)}. Cada ponto corresponde a um registro; intervalos sem dados permanecem vazios. Valores exatos disponíveis na tabela.`}>
                {[20, 67.5, 115, 162.5, 210].map((y) => <line key={y} x1={24} x2={696} y1={y} y2={y} stroke="var(--line)" />)}
                {chart.points.map(({ snapshot, x, y }) => (
                  <circle key={snapshot.id} cx={x} cy={y} r={3.5} fill="var(--green)">
                    <title>{date(snapshot.sourceTimestamp)} · Patrimônio BRL {exact(snapshot.equity)}</title>
                  </circle>
                ))}
                <text x={24} y={240} fill="var(--muted)" fontSize={12}>{day(chart.start)}</text>
                <text x={696} y={240} textAnchor="end" fill="var(--muted)" fontSize={12}>{day(chart.end)}</text>
              </svg>
              <figcaption>
                Patrimônio entre {formatBrl(chart.minimum)} e {formatBrl(chart.maximum)}. Cada ponto mostra um registro conciliado na data de origem; períodos sem registros permanecem vazios. Aportes e retiradas podem alterar o patrimônio. Este gráfico não representa rentabilidade.
              </figcaption>
            </figure>
          ) : <p className="muted">Ainda não há registros conciliados com patrimônio informado para esta conta.</p>}
          {data.historyTruncated && <p className="muted">Exibindo os 200 registros de origem mais recentes.</p>}
          {data.snapshots.length > 0 && (
            <details className="candle-chart">
              <summary>Ver registros de patrimônio em tabela ({data.snapshots.length})</summary>
              <div className="table-scroll">
                <table>
                  <caption>Conta {account?.provider} · {data.brokerAccountId.slice(0, 8)}. Valores exatos em BRL; horários de Brasília.</caption>
                  <thead><tr><th scope="col">Origem</th><th scope="col">Patrimônio</th><th scope="col">Caixa</th><th scope="col">Investido</th><th scope="col">P&amp;L realizado</th><th scope="col">P&amp;L não realizado</th></tr></thead>
                  <tbody>{data.snapshots.map((row) => (
                    <tr key={row.id}><th scope="row"><time dateTime={row.sourceTimestamp}>{date(row.sourceTimestamp)}</time></th><td>{exact(row.equity)}</td><td>{exact(row.cash)}</td><td>{exact(row.invested)}</td><td>{exact(row.realizedPnl)}</td><td>{exact(row.unrealizedPnl)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
          {showPositions && (
            <>
              <div className="section-heading"><h2>Posições registradas</h2></div>
              <p className="muted">Cada posição informa sua própria data de reconciliação. Quantidades reservadas fazem parte da posição e não são somadas ao saldo.</p>
              {!data.positions.length ? <p>Nenhuma posição conciliada registrada para esta conta.</p> : (
                <div className="table-scroll">
                  <table>
                    <caption>Posições da mesma conta selecionada. Preço médio e P&amp;L na moeda indicada; horários de Brasília.</caption>
                    <thead><tr><th scope="col">Ativo</th><th scope="col">Agente</th><th scope="col">Quantidade</th><th scope="col">Reservada</th><th scope="col">Preço médio</th><th scope="col">P&amp;L realizado</th><th scope="col">Reconciliação</th></tr></thead>
                    <tbody>{data.positions.map((row) => (
                      <tr key={row.id}><th scope="row">{row.ticker} · {row.exchange}</th><td>{row.agentName ?? "Sem atribuição"}</td><td>{exact(row.quantity)}</td><td>{exact(row.reservedQuantity)}</td><td>{row.averagePrice === null ? "—" : `${row.currency} ${exact(row.averagePrice)}`}</td><td>{row.realizedPnl === null ? "—" : `${row.currency} ${exact(row.realizedPnl)}`}</td><td><time dateTime={row.reconciledAt}>{date(row.reconciledAt)}</time></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {data.positionsTruncated && <p className="muted">Exibindo até 500 posições; a conta possui outros registros.</p>}
            </>
          )}
        </>
      )}
      <p className="panel-note">Valores históricos de uma única conta. A disponibilidade para operar exige nova reconciliação com a corretora.</p>
    </section>
  );
}
