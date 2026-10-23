"use client";
import { useEffect, useState } from "react";
import { PiggyBank } from "lucide-react";
import { formatBrl } from "@/core/format";

type Row = { agentId: string; name: string; ticker: string; amount: number; reason: string };
type State = {
  month: string; today: number; amount: number; day: number; configured: boolean;
  applied: { month: string; amount: string; reserve: string; allocation: { agentId: string; amount: string }[] } | null;
  suggestion: { amount: number; rows: Row[]; reserve: number; reserveReason: string;
    skipped: { name: string; ticker: string; reason: string }[]; waiting: { name: string; ticker: string; reason: string }[] } | null;
  history: { month: string; amount: string; reserve: string }[];
};
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`;
const brl = (v: number | string) => formatBrl(Number(v).toFixed(2));

/** Monthly contribution: the owner sets the amount; the manager AI decides where it goes. */
export function ContributionPanel({ connected, onApplied }: { connected: boolean; onApplied?: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<{ amount: string; day: number } | null>(null);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    fetch("/api/atlas/contribution", { signal: controller.signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      if (!controller.signal.aborted) { setState(body); setError(""); }
    }).catch((e) => !controller.signal.aborted && setError(e instanceof Error ? e.message : "Indisponível."));
    return () => controller.abort();
  }, [connected, revision]);
  if (!connected) return null;
  const send = async (body: object) => {
    setBusy(true);
    try {
      const r = await fetch("/api/atlas/contribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Não foi possível salvar.");
      setError(""); setForm(null); setRevision((n) => n + 1); onApplied?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  };
  const values = form ?? { amount: state?.configured ? String(state.amount) : "200", day: state?.day ?? 5 };
  return (
    <section className="contribution" aria-label="Aporte mensal">
      <div className="contribution-head">
        <h2><PiggyBank size={20} /> Aporte mensal</h2>
        <span className="score-kicker">a IA gestora decide onde colocar</span>
      </div>
      {error && <p className="notice error-text" role="alert">{error}</p>}
      {!state && !error ? <p className="muted" role="status">Calculando o plano do mês…</p> : state && <>
        <form className="contribution-form" onSubmit={(e) => { e.preventDefault(); void send({ action: "plan", amount: values.amount, day: values.day }); }}>
          <label>Quanto por mês (R$)
            <input inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={values.amount} onChange={(e) => setForm({ ...values, amount: e.target.value })} required />
          </label>
          <label>Dia do mês
            <select value={values.day} onChange={(e) => setForm({ ...values, day: Number(e.target.value) })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>dia {d}</option>)}
            </select>
          </label>
          <button disabled={busy}>{state.configured ? "Salvar" : "Começar aportes"}</button>
        </form>
        {state.applied ? (
          <div className="contribution-done">
            <strong>Aporte de {monthName(state.applied.month)} feito: {brl(state.applied.amount)}</strong>
            <span>{state.applied.allocation.length} IA(s) receberam orçamento · {brl(state.applied.reserve)} ficou na reserva. O próximo será no dia {state.day} do mês que vem.</span>
          </div>
        ) : state.suggestion && (
          <>
            <p className="contribution-lead">Plano para <b>{monthName(state.month)}</b> ({brl(state.suggestion.amount)}), entra no dia {state.day}{state.today >= state.day ? " (já pode aplicar)" : ""}:</p>
            <ul className="contribution-rows">
              {state.suggestion.rows.map((r) => (
                <li key={r.agentId}><span><b>{r.name}</b> <small>{r.ticker}</small></span><strong>{brl(r.amount)}</strong><em>{r.reason}</em></li>
              ))}
              {state.suggestion.reserve > 0 && <li className="reserve"><span><b>Reserva</b> <small>caixa</small></span><strong>{brl(state.suggestion.reserve)}</strong><em>{state.suggestion.reserveReason}</em></li>}
            </ul>
            {[...state.suggestion.skipped, ...state.suggestion.waiting].length > 0 && <ul className="contribution-out">
              {[...state.suggestion.skipped, ...state.suggestion.waiting].map((x) => <li key={x.ticker}><b>{x.name}</b> ({x.ticker}): {x.reason}</li>)}
            </ul>}
            <button type="button" className="secondary" disabled={busy} onClick={() => void send({ action: "apply" })}>Aplicar o aporte deste mês agora (simulação)</button>
          </>
        )}
        {!state.configured && <p className="muted">Defina o valor (por exemplo R$ 200) e o dia. Todo mês a IA gestora escolhe até 2 IAs (cerca de R$ 100 cada, para a corretagem de R$ 0,99 pesar perto de 1%): as que vão bem e cujas ações estão subindo. Ações em queda ou com notícia ruim não recebem nada.</p>}
        <p className="muted contribution-note">Na simulação o dinheiro entra sozinho no dia escolhido (com o ATLAS ligado). Na conta real, quem transfere é você: faça o PIX para a Genial pelo app. O ATLAS nunca movimenta seu dinheiro. Corretagem Genial: R$ 0,99 por ordem fracionada (1 a 99 ações) e R$ 2,99 por lote de 100, já descontada na simulação.</p>
        {state.history.length > 0 && <p className="muted">Histórico: {state.history.map((h) => `${monthName(h.month)} ${brl(h.amount)}`).join(" · ")}</p>}
      </>}
    </section>
  );
}
