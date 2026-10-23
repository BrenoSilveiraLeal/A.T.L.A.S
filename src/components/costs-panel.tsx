"use client";
import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { formatBrl } from "@/core/format";

type Costs = {
  totals: { real: number; simulation: number; realTraded: number; simulationTraded: number };
  months: { month: string; real: number; simulation: number; orders: number }[];
  rows: { id: string; source: "REAL" | "SIMULATION"; at: string; agent: string; ticker: string; side: string; quantity: number; value: number; fee: number }[];
};
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const brl = (v: number) => formatBrl(v.toFixed(2));
const pct = (fee: number, value: number) => (value > 0 ? `${((fee / value) * 100).toFixed(2)}%` : "—");

/** History of charges: brokerage + B3 fee of every executed order, real and simulated. */
export function CostsPanel({ connected }: { connected: boolean }) {
  const [costs, setCosts] = useState<Costs | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"REAL" | "SIMULATION">("REAL");
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    fetch("/api/atlas/costs", { signal: controller.signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      if (!controller.signal.aborted) setCosts(body);
    }).catch((e) => !controller.signal.aborted && setError(e instanceof Error ? e.message : "Indisponível."));
    return () => controller.abort();
  }, [connected]);
  if (!connected) return null;
  const rows = (costs?.rows ?? []).filter((r) => r.source === source);
  return (
    <section className="costs-panel" aria-label="Histórico de cobranças">
      <div className="contribution-head">
        <h2><Receipt size={20} /> Histórico de cobranças</h2>
        <div className="segmented" role="tablist">
          {(["REAL", "SIMULATION"] as const).map((s) => <button key={s} type="button" role="tab" aria-selected={source === s}
            className={source === s ? "active" : ""} onClick={() => setSource(s)}>{s === "REAL" ? "Dinheiro real" : "Simulação"}</button>)}
        </div>
      </div>
      {error && <p className="notice error-text" role="alert">{error}</p>}
      {!costs ? !error && <p className="muted" role="status">Somando as cobranças…</p> : <>
        <div className="live-money">
          <div><span>Total pago em taxas</span><strong>{brl(source === "REAL" ? costs.totals.real : costs.totals.simulation)}</strong></div>
          <div><span>Valor negociado</span><strong>{brl(source === "REAL" ? costs.totals.realTraded : costs.totals.simulationTraded)}</strong></div>
          <div><span>Taxas sobre o negociado</span><strong>{source === "REAL" ? pct(costs.totals.real, costs.totals.realTraded) : pct(costs.totals.simulation, costs.totals.simulationTraded)}</strong></div>
        </div>
        {costs.months.length > 0 && <p className="muted">Por mês: {costs.months.map((m) => `${MONTHS[Number(m.month.slice(5)) - 1]}/${m.month.slice(2, 4)} ${brl(source === "REAL" ? m.real : m.simulation)}`).join(" · ")}</p>}
        {rows.length ? <div className="table-scroll"><table>
          <thead><tr><th>Quando</th><th>IA</th><th>Operação</th><th>Valor</th><th>Cobrado</th><th>%</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}>
            <td>{new Date(r.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</td>
            <td>{r.agent}</td><td>{r.side === "BUY" ? "Compra" : "Venda"} {r.quantity} {r.ticker}</td><td>{brl(r.value)}</td>
            <td className="down">{brl(r.fee)}</td><td>{pct(r.fee, r.value)}</td></tr>)}</tbody>
        </table></div> : <p className="muted">{source === "REAL" ? "Nenhuma cobrança real ainda: o dinheiro real ainda não foi ligado." : "Nenhuma operação simulada ainda."}</p>}
        <p className="muted">Cobrado = corretagem da Genial (R$ 0,99 por ordem fracionada, R$ 2,99 por lote de 100) + taxas da B3 (~0,03%). A Genial não mostra esses valores no MetaTrader: confira na nota de corretagem do app.</p>
      </>}
    </section>
  );
}
