"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Hand, Wallet } from "lucide-react";
import { formatBrl } from "@/core/format";

type Row = Record<string, unknown>;
const text = (v: unknown) => (v == null ? "—" : String(v));
const date = (v: unknown) => (v ? new Date(String(v)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

async function post(path: string, body: object) {
  const response = await fetch(`/api/atlas/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Operação recusada.");
  return data;
}

function useJson<T>(path: string, enabled: boolean): [T | null, string, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/atlas/${path}`, { signal: controller.signal }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      if (!controller.signal.aborted) { setData(body); setError(""); }
    }).catch((e) => !controller.signal.aborted && setError(e instanceof Error ? e.message : "Indisponível."));
    return () => controller.abort();
  }, [path, enabled, revision]);
  return [data, error, useCallback(() => setRevision((r) => r + 1), [])];
}

const WITHDRAWAL: Record<string, [string, string]> = {
  PREPARING: ["Preparando: dinheiro separado, aguardando caixa livre", "warning"],
  READY: ["Pronto: faça a transferência no app da Genial", "success"],
  DONE: ["Concluído", ""], CANCELLED: ["Cancelado", ""],
};

/** Real-money ceiling and withdrawal preparation. ATLAS never moves money itself. */
export function CapitalPanel({ connected }: { connected: boolean }) {
  type Controls = { ceiling: string; reserved: string; availableToAgents: string; withdrawals: Row[] };
  const [controls, error, refresh] = useJson<Controls>("controls", connected);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(body: object, done: string) {
    setBusy(true); setMessage("");
    try { await post("controls", body); setMessage(done); refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Falha."); }
    finally { setBusy(false); }
  }
  if (!connected) return null;
  return (
    <section className="panel capital-panel">
      <div className="section-heading"><h2><Wallet size={16} /> Dinheiro do ATLAS na Genial</h2><span className="muted">O dinheiro fica sempre na sua conta Genial</span></div>
      {error && <div className="notice error-text" role="alert">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}
      <div className="capital-steps">
        <div><strong>Colocar dinheiro</strong><p>Faça o PIX para a sua conta pelo app da Genial. Depois aumente o teto abaixo para as IAs poderem usar esse valor.</p></div>
        <div><strong>Tirar dinheiro</strong><p>Peça o saque aqui: o valor sai do alcance das IAs na hora. Quando ficar &quot;Pronto&quot;, transfira pelo app da Genial para o seu banco.</p></div>
      </div>
      {controls && <>
        <div className="metrics-row compact-metrics">
          <div className="metric"><span>Teto que as IAs podem usar</span><strong>{formatBrl(controls.ceiling)}</strong><small>Definido por você</small></div>
          <div className="metric"><span>Separado para saque</span><strong>{formatBrl(controls.reserved)}</strong><small>Fora do alcance das IAs</small></div>
          <div className="metric"><span>Disponível para as IAs</span><strong>{formatBrl(controls.availableToAgents)}</strong><small>Teto menos saques</small></div>
        </div>
        <div className="two-columns">
          <form className="form-panel" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
            void act({ action: "capital", ceiling: String(f.get("ceiling")).replace(",", ".") }, "Teto atualizado."); }}>
            <label>Novo teto (R$)<input name="ceiling" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" defaultValue={controls.ceiling} required /></label>
            <button disabled={busy}>Salvar teto</button>
            <p className="muted">Ordens reais continuam bloqueadas até a liberação final. O teto já vale para quando forem ligadas.</p>
          </form>
          <form className="form-panel" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
            void act({ action: "withdraw", amount: String(f.get("amount")).replace(",", "."), note: String(f.get("note") ?? "") }, "Saque pedido: valor separado das IAs."); e.currentTarget.reset(); }}>
            <label>Valor para sacar (R$)<input name="amount" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" required /></label>
            <label>Observação (opcional)<input name="note" maxLength={200} /></label>
            <button disabled={busy} className="secondary">Preparar saque</button>
          </form>
        </div>
        {controls.withdrawals.length > 0 && <div className="table-scroll"><table><thead><tr><th>Pedido</th><th>Valor</th><th>Estado</th><th>Ação</th></tr></thead><tbody>
          {controls.withdrawals.map((w) => {
            const [label, tone] = WITHDRAWAL[text(w.status)] ?? [text(w.status), ""];
            return <tr key={text(w.id)}><td>{date(w.created_at)}</td><td>{formatBrl(w.amount)}</td><td><span className={`status-label ${tone}`}>{label}</span></td>
              <td>{w.status === "PREPARING" && <button className="secondary" disabled={busy} onClick={() => void act({ action: "withdrawal-status", id: w.id, status: "READY" }, "Marcado como pronto.")}>Já há caixa livre</button>}
                {w.status === "READY" && <button disabled={busy} onClick={() => void act({ action: "withdrawal-status", id: w.id, status: "DONE" }, "Saque concluído.")}>Já transferi</button>}
                {(w.status === "PREPARING" || w.status === "READY") && <> <button className="secondary" disabled={busy} onClick={() => void act({ action: "withdrawal-status", id: w.id, status: "CANCELLED" }, "Saque cancelado; o valor volta para as IAs.")}>Cancelar</button></>}</td></tr>;
          })}</tbody></table></div>}
      </>}
    </section>
  );
}

/** Fleet switches on the trading floor: all agents at once, or one by one. */
export function FleetAutopilot({ agents, onChange }: { agents: Row[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(body: object) {
    setBusy(true); setMessage("");
    try { await post("controls", body); onChange(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Falha."); }
    finally { setBusy(false); }
  }
  const alive = agents.filter((a) => !["DEAD", "FIRED"].includes(text(a.status)));
  return (
    <section className="panel fleet-panel">
      <div className="section-heading"><h2><Bot size={16} /> Pilotos automáticos</h2>
        <span><button disabled={busy} onClick={() => void act({ action: "all-autopilot", enabled: true })}>Ligar todos</button>{" "}
          <button className="secondary" disabled={busy} onClick={() => void act({ action: "all-autopilot", enabled: false })}>Desligar todos</button></span></div>
      {message && <p className="error-text">{message}</p>}
      <div className="fleet-switches">
        {alive.map((a) => <label key={text(a.id)} className="switch-row">
          <input type="checkbox" checked={a.autopilot !== false} disabled={busy}
            onChange={(e) => void act({ action: "agent-autopilot", agentId: a.id, enabled: e.target.checked })} />
          <span>{text(a.name)}</span></label>)}
      </div>
      <p className="muted">Com o piloto desligado, a IA continua analisando e mostrando o clima, mas só você compra ou vende por ela. O piloto também precisa estar ligado na Simulação.</p>
    </section>
  );
}

/** Per-agent controls: autopilot switch, manual buy/sell and cancelling open orders (simulation). */
export function AgentControls({ agent, connected }: { agent: Row; connected: boolean }) {
  type Paper = { paper_orders: Row[]; paper_positions: Row[] };
  const [paper, error, refresh] = useJson<Paper>("paper", connected);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [autopilot, setAutopilot] = useState(agent.autopilot !== false);
  const key = useRef<string | null>(null);
  async function act(path: string, body: object, done: string) {
    setBusy(true); setMessage("");
    try { const result = await post(path, body); setMessage(result?.risk?.approved === false ? `Recusada pelo risco: ${(result.risk.reasons ?? []).join(", ")}` : done); refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Falha."); }
    finally { setBusy(false); key.current = null; }
  }
  const manual = (side: "BUY" | "SELL", quantity?: number) => {
    key.current ??= crypto.randomUUID();
    void act("paper", { action: "manual", agentId: agent.id, side, ...(quantity ? { quantity } : {}), idempotencyKey: key.current },
      side === "BUY" ? "Compra enviada (simulação). Ela executa na próxima cotação dentro do limite." : "Venda enviada (simulação).");
  };
  const open = (paper?.paper_orders ?? []).filter((o) => o.agent_id === agent.id && o.status === "OPEN");
  const held = (paper?.paper_positions ?? []).find((p) => p.agent_id === agent.id);
  const dead = ["DEAD", "FIRED"].includes(text(agent.status));
  return (
    <section className="panel">
      <div className="section-heading"><h2><Hand size={16} /> Controles de {text(agent.name)}</h2><span className="muted">Simulação · ordens reais ainda bloqueadas</span></div>
      {error && <div className="notice error-text">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}
      {dead ? <p className="muted">Agente eliminado: os controles estão desativados.</p> : <>
        <label className="switch-row"><input type="checkbox" checked={autopilot} disabled={busy}
          onChange={(e) => { const enabled = e.target.checked; setAutopilot(enabled);
            void act("controls", { action: "agent-autopilot", agentId: agent.id, enabled }, enabled ? "Piloto automático ligado." : "Piloto desligado: só você decide por esta IA."); }} />
          <span>Piloto automático desta IA</span></label>
        <form className="manual-order" onSubmit={(e) => { e.preventDefault(); manual("BUY", Number(new FormData(e.currentTarget).get("quantity"))); }}>
          <label>Quantidade<input name="quantity" type="number" min="1" step="1" required /></label>
          <button disabled={busy}>Comprar agora</button>
          <button type="button" className="secondary" disabled={busy || !Number(held?.quantity)} onClick={() => manual("SELL")}>Vender tudo ({text(held?.quantity ?? 0)})</button>
        </form>
        <p className="muted">O preço limite é a última cotação mais 0,25% na compra (menos 0,25% na venda). Os limites de risco continuam valendo.</p>
        {open.length > 0 && <div className="table-scroll"><table><thead><tr><th>Ordem aberta</th><th>Limite</th><th></th></tr></thead><tbody>
          {open.map((o) => <tr key={text(o.id)}><td>{o.side === "BUY" ? "Compra" : "Venda"} de {text(o.quantity)}</td><td>{formatBrl(o.limit_price)}</td>
            <td><button className="secondary" disabled={busy} onClick={() => void act("paper", { action: "cancel", orderId: o.id }, "Ordem cancelada.")}>Cancelar</button></td></tr>)}
        </tbody></table></div>}
      </>}
    </section>
  );
}

type LiveForReadiness = { available: boolean; account?: { mode: string }; health?: { healthy: boolean; reason: string | null }; balance?: { balance: string } | null };

/** Live checklist of what still blocks real-money trading, computed from real state. */
export function RealMoneyChecklist({ connected }: { connected: boolean }) {
  const [live] = useJson<LiveForReadiness>("broker-live", connected);
  const [controls] = useJson<{ ceiling: string }>("controls", connected);
  if (!connected) return null;
  const items: [string, boolean | null, string][] = [
    ["Ponte com a Genial conectada", live ? Boolean(live.available && live.health?.healthy && !live.health.reason) : null, "MetaTrader aberto e ponte rodando neste computador."],
    ["Conta real em reais", live?.available ? live.account?.mode === "REAL" : null, "Conferido pela ponte."],
    ["Saldo na conta do MetaTrader", live?.available && live.balance ? Number(live.balance.balance) > 0 : null, "Hoje o MetaTrader mostra R$ 0,00: deposite pelo app da Genial e, se preciso, aloque limite para a plataforma (pergunta 5)."],
    ["Teto de dinheiro definido", controls ? Number(controls.ceiling) > 0 : null, "Defina na Carteira quanto as IAs podem usar."],
    ["Plataforma SwingTrade confirmada", false, "Confirme no app da Genial (Plataformas e Produtos) e me avise."],
    ["Respostas da Genial (lote, preenchimento, limite, custos, liquidação)", false, "Cole as respostas no chat com o Claude."],
    ["Regra das IAs aprovada no backtest", false, "Nenhuma regra testada superou o CDI e o comprar e segurar ainda (docs/BACKTEST_STRATEGIES.md)."],
    ["Primeira ordem real de validação autorizada por você", false, "Pequena, com ação, quantidade e preço escolhidos por você."],
  ];
  return (
    <section className="panel">
      <div className="section-heading"><h2>O que falta para usar dinheiro real</h2><span className="status-label warning">Ordens reais bloqueadas</span></div>
      <div className="readiness-list">
        {items.map(([name, ok, detail]) => (
          <div className="readiness-item" key={name}>
            <span className={ok ? "gate-icon ready" : "gate-icon"}>{ok ? "✓" : ok === null ? "…" : "○"}</span>
            <div><strong>{name}</strong><small>{detail}</small></div>
          </div>
        ))}
      </div>
    </section>
  );
}
