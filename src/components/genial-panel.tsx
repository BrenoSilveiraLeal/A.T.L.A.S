"use client";
import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { formatBrl } from "@/core/format";
import { statusLabel } from "./labels";

type Quote = { symbol: string; bid?: string | null; ask?: string | null; last?: string | null; quotedAt?: string; error: string | null };
type Live =
  | { available: false; reason: string }
  | { available: true; provider: string; executionEnabled: boolean; observedAt: string;
      account: { accountId: string; mode: string; currency: string };
      health: { healthy: boolean; reason: string | null };
      balance: { balance: string; equity: string; marginFree: string } | null;
      positions: { symbol: string; quantity: number; averagePrice: string }[];
      orders: { brokerOrderId: string; symbol: string; side: string; quantity: number; filledQuantity: number; status: string }[];
      quotes: Quote[] };
const time = (v?: string) => (v ? new Date(v).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const QUOTE_ERRORS: Record<string, string> = { UNAPPROVED_INSTRUMENT: "não aprovada na ponte", NO_LIVE_TICK_YET: "sem negócio ainda" };

/** Read-only view of the Genial account through the local MetaTrader bridge. */
export function GenialPanel({ connected }: { connected: boolean }) {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    const load = () => fetch("/api/atlas/broker-live").then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      if (!stopped) { setLive(body); setError(""); }
    }).catch((e) => !stopped && setError(e instanceof Error ? e.message : "Indisponível."));
    void load();
    const timer = setInterval(load, 30_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [connected]);
  if (!connected) return null;
  return (
    <section className="panel genial-panel">
      <div className="section-heading">
        <h2><Radio size={16} /> Conta Genial ao vivo</h2>
        <span className="muted">Somente leitura · atualiza a cada 30 s</span>
      </div>
      {error ? <div className="notice error-text" role="alert">{error}</div>
        : !live ? <div className="loading-state" role="status">Conectando ao MetaTrader…</div>
        : !live.available ? <div className="notice">{live.reason}</div>
        : <>
          <p>
            <span className={`status-label ${live.health.healthy && !live.health.reason ? "success" : "warning"}`}>
              {live.health.healthy && !live.health.reason ? "Conectada" : live.health.reason ?? "Com problema"}
            </span>{" "}
            Conta {live.account.mode === "REAL" ? "real" : live.account.mode} {live.account.accountId} · {live.provider} ·
            ordens pelo ATLAS <strong>bloqueadas</strong> · lido às {time(live.observedAt)}
          </p>
          {live.balance && <div className="metrics-row compact-metrics">
            <div className="metric"><span>Saldo na Genial (MetaTrader)</span><strong>{formatBrl(live.balance.balance)}</strong><small>Informado pelo terminal</small></div>
            <div className="metric"><span>Patrimônio (saldo + ações)</span><strong>{formatBrl(live.balance.equity)}</strong><small>Informado pelo terminal</small></div>
            <div className="metric"><span>Livre para operar</span><strong>{formatBrl(live.balance.marginFree)}</strong><small>Pode não ser o saldo sacável (D+2)</small></div>
          </div>}
          <div className="two-columns">
            <div>
              <h3>Posições na corretora</h3>
              {live.positions.length ? <div className="table-scroll"><table><thead><tr><th>Ação</th><th>Quantidade</th><th>Preço médio</th></tr></thead>
                <tbody>{live.positions.map((p) => <tr key={p.symbol}><td>{p.symbol}</td><td>{p.quantity}</td><td>{formatBrl(p.averagePrice)}</td></tr>)}</tbody></table></div>
                : <p className="muted">Nenhuma posição aberta.</p>}
              <h3>Ordens abertas</h3>
              {live.orders.length ? <div className="table-scroll"><table><thead><tr><th>Ação</th><th>Lado</th><th>Qtd.</th><th>Executada</th><th>Estado</th></tr></thead>
                <tbody>{live.orders.map((o) => <tr key={o.brokerOrderId}><td>{o.symbol}</td><td>{statusLabel(o.side)}</td><td>{o.quantity}</td><td>{o.filledQuantity}</td><td>{statusLabel(o.status)}</td></tr>)}</tbody></table></div>
                : <p className="muted">Nenhuma ordem aberta.</p>}
            </div>
            <div>
              <h3>Cotações em tempo real (MetaTrader)</h3>
              <div className="table-scroll"><table><thead><tr><th>Ação</th><th>Último</th><th>Compra</th><th>Venda</th><th>Horário</th></tr></thead>
                <tbody>{live.quotes.map((q) => q.error
                  ? <tr key={q.symbol}><td>{q.symbol}</td><td colSpan={4} className="muted">{QUOTE_ERRORS[q.error] ?? q.error}</td></tr>
                  : <tr key={q.symbol}><td>{q.symbol}</td><td>{formatBrl(q.last)}</td><td>{formatBrl(q.bid)}</td><td>{formatBrl(q.ask)}</td><td>{time(q.quotedAt)}</td></tr>)}</tbody></table></div>
              <p className="muted">Compra e venda ficam vazias com a bolsa fechada.</p>
            </div>
          </div>
        </>}
    </section>
  );
}
