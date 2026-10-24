"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Landmark, ShieldAlert } from "lucide-react";
import { formatBrl } from "@/core/format";

type Agent = { id: string; name: string; status: string; ticker: string; realBudget: number };
type Live = {
  switches: { panel: boolean; computer: boolean; bridge: boolean | null; killSwitch: boolean; reason: string | null };
  settings: { maxOrder: number; dailyOrders: number };
  ceiling: number; reserved: number; assigned: number; agents: Agent[];
  positions: { agent_id: string; ticker: string; quantity: number; cost: string; realized_pnl: string }[];
  orders: { id: string; agent_id: string; symbol: string; side: string; quantity: number; filled_quantity: number; limit_price: string; status: string; reason: string; error: string | null; created_at: string }[];
};
const STATUS: Record<string, string> = { PENDING: "preparando", DISPATCHED: "enviada", OPEN: "aberta", PARTIALLY_FILLED: "executada em parte",
  FILLED: "executada", CANCELLED: "cancelada", REJECTED: "recusada", EXPIRED: "expirada", UNKNOWN: "conferindo com a Genial" };
const brl = (v: number | string) => formatBrl(Number(v).toFixed(2));
const when = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Real money: per-agent budgets inside the ceiling, the three switches, positions and orders. */
export function LivePanel({ connected }: { connected: boolean }) {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const read = () => fetch("/api/atlas/live", { signal: controller.signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      if (!controller.signal.aborted) { setLive(body); setError(""); }
    }).catch((e) => !controller.signal.aborted && setError(e instanceof Error ? e.message : "Indisponível."));
    read();
    const timer = setInterval(read, 30000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [connected, revision]);
  if (!connected) return null;
  const send = async (body: object) => {
    setBusy(true);
    try {
      const r = await fetch("/api/atlas/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Não foi possível salvar.");
      setError(""); setConfirm(""); setBudgets({}); setRevision((n) => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  };
  const s = live?.switches;
  const on = !!s && s.panel && s.computer && s.bridge === true && !s.killSwitch;
  const free = live ? live.ceiling - live.reserved - live.assigned : 0;
  const nameOf = (id: string) => live?.agents.find((a) => a.id === id)?.name ?? "IA";
  return (
    <section className="live-panel" aria-label="Dinheiro real na Genial">
      <div className="contribution-head">
        <h2><Landmark size={20} /> Dinheiro real na Genial</h2>
        <span className={`status-label ${on ? "success" : "warning"}`}>{on ? "LIGADO: as IAs podem comprar e vender" : "Desligado"}</span>
      </div>
      {error && <p className="notice error-text" role="alert">{error}</p>}
      {!live ? !error && <p className="muted" role="status">Lendo o dinheiro real…</p> : <>
        <ul className="live-switches">
          <li className={s!.panel ? "on" : ""}>Chave no painel (você)</li>
          <li className={s!.computer ? "on" : ""}>Chave deste computador</li>
          <li className={s!.bridge ? "on" : ""}>Envio de ordens na ponte do MetaTrader{s!.bridge === null ? " (não encontrada)" : ""}</li>
          <li className={!s!.killSwitch ? "on" : "off"}>{s!.killSwitch ? `Parada geral ativa: ${s!.reason ?? ""}` : "Sem parada geral"}</li>
        </ul>
        <div className="live-money">
          <div><span>Teto (o que você depositou)</span><strong>{brl(live.ceiling)}</strong></div>
          <div><span>Já entregue às IAs</span><strong>{brl(live.assigned)}</strong></div>
          <div><span>Livre para distribuir</span><strong>{brl(Math.max(0, free))}</strong></div>
        </div>
        {live.ceiling <= 0 && <p className="muted">Primeiro deposite na Genial e defina o teto em &quot;Dinheiro do ATLAS na Genial&quot;, na tela <Link href="/app/treasury">Tesouraria</Link>, com o mesmo valor que você depositou.</p>}
        <div className="live-agents">
          {live.agents.filter((a) => !["DEAD", "FIRED"].includes(a.status)).map((a) => (
            <form key={a.id} className="live-agent" onSubmit={(e) => { e.preventDefault(); void send({ action: "budget", agentId: a.id, amount: budgets[a.id] ?? String(a.realBudget) }); }}>
              <label>{a.name} <small>{a.ticker}</small>
                <input inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={budgets[a.id] ?? String(a.realBudget)}
                  onChange={(e) => setBudgets({ ...budgets, [a.id]: e.target.value })} aria-label={`Dinheiro real de ${a.name}`} />
              </label>
              <button className="secondary" disabled={busy}>Salvar</button>
            </form>
          ))}
        </div>
        {!s!.panel ? (
          <form className="live-switch" onSubmit={(e) => { e.preventDefault(); void send({ action: "settings", enabled: true, maxOrder: String(live.settings.maxOrder), dailyOrders: live.settings.dailyOrders, confirm }); }}>
            <p><ShieldAlert size={16} /> Ao ligar, as IAs com dinheiro real passam a comprar e vender sozinhas na sua conta Genial, seguindo a mesma regra da simulação, até R$ {live.settings.maxOrder} por ordem e {live.settings.dailyOrders} ordens por dia. Pode haver perda. Para confirmar, digite <b>LIGAR DINHEIRO REAL</b>:</p>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="LIGAR DINHEIRO REAL" aria-label="Confirmação" />
            <button disabled={busy || confirm !== "LIGAR DINHEIRO REAL"}>Ligar dinheiro real</button>
          </form>
        ) : (
          <button type="button" className="danger" disabled={busy} onClick={() => void send({ action: "settings", enabled: false, maxOrder: String(live.settings.maxOrder), dailyOrders: live.settings.dailyOrders })}>Desligar dinheiro real</button>
        )}
        {s!.panel && (!s!.computer || s!.bridge !== true) && <p className="muted">Sua chave está ligada, mas falta ligar {!s!.computer ? "a chave deste computador" : "o envio de ordens na ponte"}: peça ao Claude.</p>}
        {(live.positions ?? []).some((p) => p.quantity > 0) && <div className="table-scroll"><table>
          <thead><tr><th>IA</th><th>Ação</th><th>Quantidade</th><th>Custo (com taxas)</th><th>Resultado já realizado</th></tr></thead>
          <tbody>{live.positions.filter((p) => p.quantity > 0 || Number(p.realized_pnl) !== 0).map((p) => <tr key={p.agent_id + p.ticker}>
            <td>{nameOf(p.agent_id)}</td><td>{p.ticker}</td><td>{p.quantity}</td><td>{brl(p.cost)}</td>
            <td className={Number(p.realized_pnl) > 0 ? "up" : Number(p.realized_pnl) < 0 ? "down" : ""}>{brl(p.realized_pnl)}</td></tr>)}</tbody>
        </table></div>}
        {(live.orders ?? []).length > 0 ? <div className="table-scroll"><table>
          <thead><tr><th>Quando</th><th>IA</th><th>Ordem</th><th>Situação</th><th>Motivo</th></tr></thead>
          <tbody>{live.orders.map((o) => <tr key={o.id}>
            <td>{when(o.created_at)}</td><td>{nameOf(o.agent_id)}</td>
            <td>{o.side === "BUY" ? "Compra" : "Venda"} {o.filled_quantity}/{o.quantity} {o.symbol} até {brl(o.limit_price)}</td>
            <td>{STATUS[o.status] ?? o.status}{o.error ? ` (${o.error})` : ""}</td><td>{o.reason}</td></tr>)}</tbody>
        </table></div> : <p className="muted">Nenhuma ordem real ainda. Quando a regra mandar comprar na simulação e houver dinheiro real para a IA, a ordem aparece aqui.</p>}
        <p className="muted">O saldo da Genial não aparece no MetaTrader: o ATLAS controla quanto cada IA pode gastar. Corretagem: R$ 0,99 por ordem fracionada e R$ 2,99 por lote de 100, mais ~0,03% da B3. Ordens executam na hora (IOC) ou são canceladas. O computador com o MetaTrader precisa estar ligado durante o pregão (10h às 17h).</p>
      </>}
    </section>
  );
}
