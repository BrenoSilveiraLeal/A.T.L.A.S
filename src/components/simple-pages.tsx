"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Tv, Wallet as WalletIcon } from "lucide-react";
import { formatBrl } from "@/core/format";
import { AgentFloor } from "./agent-floor";
import { LivePanel } from "./live-panel";
import { ContributionPanel } from "./contribution-panel";
import { CostsPanel } from "./costs-panel";

/**
 * The owner's three screens (24/10/2026: "o controle das compras e vendas, o histórico e o que a
 * IA está fazendo"). Everything else stays reachable by address only.
 */
type Row = Record<string, unknown>;
type Paper = Record<string, Row[]>;
const brl = (v: number) => formatBrl(v.toFixed(2));
const when = (v: unknown) => new Date(String(v)).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function Heading({ title, note, children }: { title: string; note: string; children?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{note}</p></div>{children && <div className="heading-actions">{children}</div>}</div>;
}

function Offline({ connected }: { connected: boolean }) {
  return connected ? null : <div className="notice">Sem conexão com o banco de dados: configure o Supabase em <Link href="/app/settings">Configuração</Link>.</div>;
}

function usePaper(connected: boolean, revision = 0) {
  const [state, setState] = useState<{ paper: Paper | null; error: string }>({ paper: null, error: "" });
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    fetch("/api/atlas/paper", { signal: controller.signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      if (!controller.signal.aborted) setState({ paper: body, error: "" });
    }).catch((e) => !controller.signal.aborted && setState({ paper: null, error: e instanceof Error ? e.message : "Indisponível." }));
    return () => controller.abort();
  }, [connected, revision]);
  return state;
}

type Genial = { deposited: number; spent: number; received: number; fees: number; free: number };
type Bridge = { available: boolean; reason?: string; balance?: { balance: string; equity: string; observedAt: string } | null };

/**
 * Money at Genial for the AIs, refreshed every 15 s. The MT5 Swing account does not report the
 * cash balance, so ATLAS counts it (deposits − purchases + sales − fees); when the bridge does
 * report a balance it is shown too. "Depositei mais" raises the deposited total.
 */
export function GenialBalance({ connected, compact = false }: { connected: boolean; compact?: boolean }) {
  const [genial, setGenial] = useState<Genial | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string; ticker: string }[]>([]);
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const load = useCallback((signal?: AbortSignal) => {
    fetch("/api/atlas/live", { signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      setGenial(body.genial); setTeam(body.agents ?? []); setError("");
    }).catch((e) => { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Indisponível."); });
    fetch("/api/atlas/broker-live", { signal }).then((r) => r.json()).then((b: Bridge) => setBridge(b)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => setTick((n) => n + 1), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [connected, load]);
  useEffect(() => { if (tick) load(); }, [tick, load]);
  if (!connected) return null;
  const reported = bridge?.available && bridge.balance && Number(bridge.balance.balance) > 0 ? Number(bridge.balance.balance) : null;
  async function deposit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(String(form.get("amount") ?? "").replace(",", "."));
    const agentId = String(form.get("agent") ?? "");
    if (!genial || !(amount > 0)) return;
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/atlas/live", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deposit", amount: amount.toFixed(2), ...(agentId ? { agentId } : {}) }) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Recusado.");
      const who = team.find((a) => a.id === agentId);
      setMessage(`Anotado: +${brl(amount)} ${who ? `para ${who.name} (${who.ticker})` : "dividido igualmente entre as IAs"}.`); load();
      (event.target as HTMLFormElement).reset();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Falha de conexão."); }
    finally { setBusy(false); }
  }
  return (
    <section className={`panel genial-balance ${compact ? "compact" : ""}`} aria-live="polite">
      <div className="section-heading"><h2><WalletIcon size={18} /> Dinheiro na Genial</h2>
        <span className="muted"><span className="pulse on" aria-hidden="true" /> atualiza a cada 15 s</span></div>
      {error ? <p className="notice error-text" role="alert">{error}</p> : !genial ? <p className="muted" role="status">Somando…</p> : <>
        <div className="genial-main">
          <div><span>Livre para as IAs gastarem</span><strong className={genial.free > 0 ? "up" : ""}>{brl(genial.free)}</strong></div>
          {!compact && <>
            <div><span>Você depositou</span><strong>{brl(genial.deposited)}</strong></div>
            <div><span>Gasto em compras</span><strong>{brl(genial.spent)}</strong></div>
            <div><span>Recebido de vendas</span><strong>{brl(genial.received)}</strong></div>
            <div><span>Taxas pagas</span><strong className="down">{brl(genial.fees)}</strong></div>
          </>}
        </div>
        {reported !== null && <p className="muted">Saldo informado pelo MetaTrader agora: <b>{brl(reported)}</b>.</p>}
        {!compact && <>
          <form className="genial-deposit" onSubmit={(e) => void deposit(e)}>
            <label>Depositei mais na Genial (R$)
              <input name="amount" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" placeholder="200" required />
            </label>
            <label>Para quem
              <select name="agent" defaultValue="">
                <option value="">Dividir igualmente entre as IAs</option>
                {team.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.ticker})</option>)}
              </select>
            </label>
            <button disabled={busy}>{busy ? "Anotando…" : "Adicionar"}</button>
          </form>
          {message && <p className="muted" role="status">{message}</p>}
          <p className="muted">A Genial não mostra o saldo pelo MetaTrader Swing, então o ATLAS conta: o que você depositou, menos cada compra das IAs, mais cada venda, menos as taxas. Sempre que transferir dinheiro para a Genial, anote aqui o valor.{bridge && !bridge.available ? ` Ponte com a Genial: ${bridge.reason}` : ""}</p>
        </>}
      </>}
    </section>
  );
}

export function OfficePage({ connected }: { connected: boolean }) {
  return <>
    <Heading title="Escritório" note="O que cada IA está fazendo agora, ao vivo.">
      <Link className="button secondary" href="/tv"><Tv size={16} /> Modo TV</Link>
    </Heading>
    <Offline connected={connected} />
    <GenialBalance connected={connected} compact />
    <AgentFloor connected={connected} revision={0} mode="full" />
  </>;
}

/** Each agent's shares (simulation) and its open orders, in plain words. */
function Wallet({ connected, revision }: { connected: boolean; revision: number }) {
  const { paper, error } = usePaper(connected, revision);
  if (!connected) return null;
  if (error) return <p className="notice error-text" role="alert">{error}</p>;
  if (!paper) return <p className="muted" role="status">Abrindo a carteira…</p>;
  const account = paper.paper_accounts?.[0];
  const ticker = (id: unknown) => String(paper.assets?.find((a) => a.id === id)?.ticker ?? "");
  const rows = (paper.agents ?? []).map((agent) => {
    const position = paper.paper_positions?.find((p) => p.agent_id === agent.id);
    const vital = paper.paper_agent_vitals?.find((v) => v.agent_id === agent.id);
    const quantity = Number(position?.quantity ?? 0), average = Number(position?.average_cost ?? 0);
    const price = vital?.mark_price != null ? Number(vital.mark_price) : null;
    const order = paper.paper_orders?.find((o) => o.agent_id === agent.id && o.status === "OPEN");
    const budget = Number(agent.budget), invested = quantity * average;
    return { id: String(agent.id), name: String(agent.name), ticker: ticker(agent.asset_id), quantity, average, price, invested,
      value: price !== null ? quantity * price : invested, saved: Math.max(0, budget - invested), order };
  });
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <section className="panel wallet">
      <div className="section-heading"><h2>Carteira das IAs</h2><span className="muted">simulação · espelho do plano real</span></div>
      <div className="live-money">
        <div><span>Em ações</span><strong>{brl(total)}</strong></div>
        <div><span>Dinheiro guardado</span><strong>{account ? brl(Number(account.cash)) : "—"}</strong></div>
        <div><span>Total depositado</span><strong>{account ? brl(Number(account.initial_cash)) : "—"}</strong></div>
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th>IA</th><th>Ações</th><th>Preço médio</th><th>Preço agora</th><th>Ganho</th><th>Juntando</th><th>Pedido aberto</th></tr></thead>
        <tbody>{rows.map((r) => {
          const gain = r.quantity && r.price !== null ? r.value - r.invested : null;
          return <tr key={r.id}>
            <td><b>{r.name}</b> {r.ticker}</td>
            <td>{r.quantity || "—"}</td>
            <td>{r.quantity ? brl(r.average) : "—"}</td>
            <td>{r.price !== null ? brl(r.price) : "—"}</td>
            <td className={gain === null || Math.abs(gain) < 0.005 ? "" : gain > 0 ? "up" : "down"}>{gain === null ? "—" : `${gain >= 0 ? "+" : "−"}${brl(Math.abs(gain))}`}</td>
            <td>{brl(r.saved)}</td>
            <td>{r.order ? `${r.order.side === "BUY" ? "Compra" : "Venda"} de ${r.order.quantity} a ${brl(Number(r.order.limit_price))}` : "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="muted">Juntando = parte do aporte que a IA ainda não usou; ela compra quando tem R$ 40 ou mais. Vende só com +60% sobre o preço médio, nunca no prejuízo.</p>
    </section>
  );
}

export function TradesPage({ connected }: { connected: boolean }) {
  const [revision, setRevision] = useState(0);
  return <>
    <Heading title="Compras e vendas" note="Carteira, pedidos, dinheiro real e o aporte mensal." />
    <Offline connected={connected} />
    <GenialBalance connected={connected} />
    <Wallet connected={connected} revision={revision} />
    <LivePanel connected={connected} />
    <ContributionPanel connected={connected} onApplied={() => setRevision((n) => n + 1)} />
  </>;
}

/** Every buy or sell the agents decided, with the reason in plain words. */
function Decisions({ connected }: { connected: boolean }) {
  const { paper, error } = usePaper(connected);
  if (!connected) return null;
  if (error) return <p className="notice error-text" role="alert">{error}</p>;
  if (!paper) return <p className="muted" role="status">Lendo as decisões…</p>;
  const name = (id: unknown) => String(paper.agents?.find((a) => a.id === id)?.name ?? "IA");
  // Only the current book: a restart closed the old simulation (its rows stay in the database).
  const since = String(paper.paper_book_restarts?.[0]?.started_at ?? "");
  const proposals = [...(paper.paper_proposals ?? [])].filter((p) => String(p.created_at) > since).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100);
  const STATUS: Record<string, string> = { APPROVED: "aprovada", REJECTED: "recusada pelo controle de risco", PENDING: "aguardando", EXPIRED: "expirou" };
  return (
    <section className="panel decisions-log">
      <div className="section-heading"><h2>Decisões das IAs</h2><span className="muted">compras e vendas propostas</span></div>
      {proposals.length ? <ul>{proposals.map((p) => (
        <li key={String(p.id)}>
          <span className="muted">{when(p.created_at)}</span>
          <b className={p.side === "BUY" ? "up" : "down"}>{name(p.agent_id)}: {p.side === "BUY" ? "comprar" : "vender"} {String(p.quantity)} a {brl(Number(p.limit_price))}</b>
          <span>{String(p.reasoning_summary ?? "").replace(/ Regra [^,]+, simulação\.$/, "")}</span>
          <small>{STATUS[String(p.status)] ?? String(p.status).toLowerCase()}</small>
        </li>))}</ul>
        : <p className="muted">Nenhuma compra ou venda ainda. Com R$ 33 por mês, cada IA faz a primeira compra quando juntar R$ 80.</p>}
      {since && <p className="muted">A simulação recomeçou do zero em {when(since)}, igual ao plano real de R$ 200 por mês.</p>}
    </section>
  );
}

export function HistoryPage({ connected }: { connected: boolean }) {
  return <>
    <Heading title="Histórico" note="Tudo o que as IAs decidiram, compraram, venderam e pagaram de taxa." />
    <Offline connected={connected} />
    <Decisions connected={connected} />
    <CostsPanel connected={connected} />
  </>;
}
