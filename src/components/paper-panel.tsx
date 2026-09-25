"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBrl } from "@/core/format";

type Row = Record<string, unknown>;
type PaperState = Record<
  "paper_accounts" | "paper_positions" | "paper_proposals" | "paper_orders" |
  "paper_fills" | "paper_ledger_entries" | "paper_events" | "agents" | "assets",
  Row[]
>;
const label = (value: unknown) => value == null ? "—" : String(value);
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

export function PaperPanel({ connected }: { connected: boolean }) {
  const [state, setState] = useState<PaperState | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestKey = useRef<{ payload: string; key: string } | null>(null);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    fetch("/api/atlas/paper", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível carregar a carteira virtual.");
        if (!controller.signal.aborted) { setState(result); setError(""); setLoading(false); }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Falha de conexão."); setLoading(false); }
      });
    return () => controller.abort();
  }, [connected, revision]);

  async function action(payload: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/atlas/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operação virtual recusada.");
      setMessage(payload.action === "settle"
        ? Number(result.filled) > 0 ? `${result.filled} ordem(ns) preenchida(s) virtualmente.` : "Nenhuma ordem preenchida. É preciso uma cotação posterior à abertura e dentro do preço limite."
        : payload.action === "review" ? result.status === "OPEN" ? "Risco aprovado; ordem virtual aberta." : `Proposta ${result.status === "REJECTED" ? "recusada" : "já analisada"}: ${Array.isArray(result.risk?.reasons) ? result.risk.reasons.join(", ") : "consulte o histórico"}.`
        : payload.action === "propose" ? "Proposta virtual criada. Revise e aprove antes de abrir a ordem."
        : "Alteração virtual registrada.");
      if (payload.action === "propose") requestKey.current = null;
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha de conexão.");
    } finally { setBusy(false); }
  }

  if (!connected) return <div className="notice">Configure o Supabase para usar o Paper Trading.</div>;
  if (loading && !state) return <div className="loading-state" role="status">Consultando simulação…</div>;
  const account = state?.paper_accounts[0];
  const agents = state?.agents ?? [];
  const assets = state?.assets ?? [];
  const proposals = state?.paper_proposals ?? [];
  const orders = state?.paper_orders ?? [];
  const positions = state?.paper_positions.filter((row) => Number(row.quantity) > 0) ?? [];
  const assetName = (id: unknown) => label(assets.find((row) => row.id === id)?.ticker);
  const agentName = (id: unknown) => label(agents.find((row) => row.id === id)?.name);
  return <>
    <div className="notice" role="status"><strong>SIMULAÇÃO — SEM DINHEIRO REAL.</strong> Os preços vêm de fonte de mercado atrasada. Caixa, ordens, preenchimentos e posições abaixo são virtuais. A conta real e o executor MT5 continuam separados e bloqueados.</div>
    {error && <div className="notice error-text" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {!account ? <section className="panel form-panel">
      <h2>1. Criar carteira virtual</h2>
      <p>Escolha apenas números de teste. O valor inicial não é depósito e não pode ser sacado.</p>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void action({ action: "open", initialCash: form.get("initialCash"), maxOrder: form.get("maxOrder"), maxExposure: form.get("maxExposure"), maxDailyLoss: form.get("maxDailyLoss") });
      }}>
        <label>Caixa virtual inicial (R$)<input name="initialCash" inputMode="decimal" defaultValue="10000.00" required /></label>
        <label>Máximo por ordem (R$)<input name="maxOrder" inputMode="decimal" defaultValue="1000.00" required /></label>
        <label>Máximo investido (R$)<input name="maxExposure" inputMode="decimal" defaultValue="5000.00" required /></label>
        <label>Perda diária máxima (R$)<input name="maxDailyLoss" inputMode="decimal" defaultValue="500.00" required /></label>
        <div className="form-actions"><button disabled={busy}>Criar simulação</button></div>
      </form>
      <p className="muted">Premissas fixas da simulação: taxa hipotética de 0,03% e slippage adverso de 0,05%. Não representam custos comprovados da sua corretora.</p>
    </section> : <>
      <div className="metrics-row">
        <div className="metric"><span>Caixa virtual</span><strong>{formatBrl(account.cash)}</strong><small>Início: {formatBrl(account.initial_cash)}</small></div>
        <div className="metric"><span>Reservado em ordens</span><strong>{formatBrl(account.reserved_cash)}</strong><small>Ainda não foi gasto</small></div>
        <div className="metric"><span>Posições virtuais</span><strong>{positions.length}</strong><small>Somente ações simuladas</small></div>
        <div className="metric"><span>Estado</span><strong>{account.paused ? "Pausado" : "Ativo"}</strong><small>Execução real bloqueada</small></div>
      </div>
      <section className="panel">
        <h2>2. Analisar e propor ordem virtual</h2>
        <p>Escolha o agente e a direção. O ATLAS consulta cotação e histórico reais, calcula SMA3/SMA8 e registra a justificativa. A escolha da direção é sua; o sinal não promete ganho.</p>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          const fields = { agentId: form.get("agentId"), side: form.get("side"), quantity: Number(form.get("quantity")), limitPrice: form.get("limitPrice") };
          const serialized = JSON.stringify(fields);
          if (!requestKey.current || requestKey.current.payload !== serialized) requestKey.current = { payload: serialized, key: crypto.randomUUID() };
          void action({ action: "propose", ...fields, idempotencyKey: requestKey.current.key });
        }}>
          <label>Agente ativo<select name="agentId" required><option value="">Selecione</option>{agents.filter((row) => row.enabled === true).map((row) => <option key={label(row.id)} value={label(row.id)}>{label(row.name)} · {assetName(row.asset_id)}</option>)}</select></label>
          <label>Direção<select name="side"><option value="BUY">Comprar virtualmente</option><option value="SELL">Vender posição virtual</option></select></label>
          <label>Quantidade de ações<input name="quantity" type="number" min="1" step="1" required /></label>
          <label>Preço limite (R$)<input name="limitPrice" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" required /></label>
          <div className="form-actions"><button disabled={busy || Boolean(account.paused) || !agents.some((row) => row.enabled === true)}>Gerar proposta</button></div>
        </form>
        <p className="muted">Uma ordem limite só preenche virtualmente quando chegar outra cotação com horário posterior à abertura, dentro do limite após slippage. Nenhuma ordem vai à B3.</p>
      </section>
      <section className="panel"><h2>3. Revisar propostas</h2>
        {proposals.length ? <div className="table-scroll"><table><thead><tr><th>Agente / ativo</th><th>Proposta</th><th>Referência</th><th>Fonte e horário</th><th>Análise / risco</th><th>Ação</th></tr></thead><tbody>{proposals.map((row) => <tr key={label(row.id)}>
          <td>{agentName(row.agent_id)} / {assetName(row.asset_id)}</td><td>{label(row.side)} {label(row.quantity)} a {formatBrl(row.limit_price)}</td><td>{formatBrl(row.reference_price)} (atrasada)</td>
          <td><a href={label(row.quote_source)} target="_blank" rel="noreferrer">brapi</a><br />{date(row.quote_timestamp)}</td><td>{label(row.reasoning_summary)}<br /><strong>{label(row.status)}</strong>{row.risk_result ? ` · ${JSON.stringify(row.risk_result)}` : ""}</td>
          <td>{row.status === "PENDING" && <><button disabled={busy || Boolean(account.paused)} onClick={() => void action({ action: "review", proposalId: row.id, approve: true })}>Aprovar</button> <button className="secondary" disabled={busy} onClick={() => void action({ action: "review", proposalId: row.id, approve: false })}>Recusar</button></>}</td>
        </tr>)}</tbody></table></div> : <p className="muted">Nenhuma proposta virtual ainda.</p>}
      </section>
      <section className="panel"><h2>4. Ordens e preenchimentos simulados</h2>
        {orders.length ? <div className="table-scroll"><table><thead><tr><th>Agente / ativo</th><th>Ordem limite virtual</th><th>Estado</th><th>Aberta em</th><th>Ação</th></tr></thead><tbody>{orders.map((row) => <tr key={label(row.id)}><td>{agentName(row.agent_id)} / {assetName(row.asset_id)}</td><td>{label(row.side)} {label(row.quantity)} a {formatBrl(row.limit_price)}</td><td>{label(row.status)}</td><td>{date(row.placed_at)}</td><td>{row.status === "OPEN" && <><button disabled={busy || Boolean(account.paused)} onClick={() => void action({ action: "settle", assetId: row.asset_id })}>Verificar nova cotação</button> <button className="secondary" disabled={busy} onClick={() => void action({ action: "cancel", orderId: row.id })}>Cancelar</button></>}</td></tr>)}</tbody></table></div> : <p className="muted">Nenhuma ordem virtual aberta.</p>}
        {Boolean(state?.paper_fills.length) && <div className="table-scroll"><table><thead><tr><th>Preenchimento SIMULADO</th><th>Preço</th><th>Taxa hipotética</th><th>Fonte e horário</th></tr></thead><tbody>{state?.paper_fills.map((row) => <tr key={label(row.id)}><td>{label(row.side)} {label(row.quantity)} {assetName(row.asset_id)}</td><td>{formatBrl(row.fill_price)}</td><td>{formatBrl(row.fee)}</td><td>{date(row.quote_timestamp)} · <a href={label(row.quote_source)} target="_blank" rel="noreferrer">origem</a></td></tr>)}</tbody></table></div>}
      </section>
      <section className="panel"><h2>5. Livro e posições virtuais</h2>
        {positions.length ? <div className="table-scroll"><table><thead><tr><th>Agente / ativo</th><th>Quantidade</th><th>Custo médio</th><th>P&L realizado virtual</th></tr></thead><tbody>{positions.map((row) => <tr key={`${label(row.agent_id)}:${label(row.asset_id)}`}><td>{agentName(row.agent_id)} / {assetName(row.asset_id)}</td><td>{label(row.quantity)}</td><td>{formatBrl(row.average_cost)}</td><td>{formatBrl(row.realized_pnl)}</td></tr>)}</tbody></table></div> : <p className="muted">Nenhuma posição virtual. O valor de mercado atual não é inferido de uma cotação antiga.</p>}
        <p className="muted">{state?.paper_ledger_entries.length ?? 0} lançamentos no livro virtual balanceado; {state?.paper_events.length ?? 0} eventos de auditoria. Exibição limitada aos últimos 200 registros por tipo.</p>
        <div className="table-scroll"><table><thead><tr><th>Evento</th><th>Detalhes</th><th>Horário</th></tr></thead><tbody>{state?.paper_events.map((row) => <tr key={label(row.id)}><td>{label(row.event)}</td><td>{JSON.stringify(row.details)}</td><td>{date(row.created_at)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel"><h2>Controle da simulação</h2><p>Pausar cancela todas as ordens virtuais abertas e libera suas reservas. As posições e a auditoria permanecem.</p><button className="secondary" disabled={busy} onClick={() => void action({ action: "pause", paused: !account.paused })}>{account.paused ? "Retomar simulação" : "Pausar simulação"}</button></section>
    </>}
  </>;
}
