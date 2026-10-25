"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Tv, Wallet as WalletIcon } from "lucide-react";
import { formatBrl } from "@/core/format";
import { AgentFloor } from "./agent-floor";
import { LivePanel } from "./live-panel";
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
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const load = useCallback((signal?: AbortSignal) => {
    fetch("/api/atlas/live", { signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      setGenial(body.genial); setError("");
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
    if (!genial || !(amount > 0)) return;
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/atlas/live", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deposit", amount: amount.toFixed(2) }) });
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Recusado.");
      setMessage(`Anotado: +${brl(amount)} no caixa do Chefe. Ele libera para a IA que chegar no momento certo de comprar.`); load();
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

type LiveView = {
  agents: { id: string; name: string; ticker: string; realBudget: number }[];
  positions: Row[]; orders: Row[]; fills: Row[];
};
const ORDER_STATUS: Record<string, string> = { PENDING: "preparando", DISPATCHED: "enviada", OPEN: "aberta na Genial", PARTIALLY_FILLED: "executada em parte",
  FILLED: "executada", CANCELLED: "cancelada", REJECTED: "recusada", EXPIRED: "expirou", UNKNOWN: "sem confirmação da Genial" };
const ACTIVE = ["PENDING", "DISPATCHED", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"];

function useLive(connected: boolean) {
  const [state, setState] = useState<{ live: LiveView | null; error: string }>({ live: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setTick((n) => n + 1), 20000);
    return () => clearInterval(timer);
  }, [connected]);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    fetch("/api/atlas/live", { signal: controller.signal }).then(async (r) => {
      const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível.");
      if (!controller.signal.aborted) setState({ live: body, error: "" });
    }).catch((e) => !controller.signal.aborted && setState({ live: null, error: e instanceof Error ? e.message : "Indisponível." }));
    return () => controller.abort();
  }, [connected, tick]);
  return state;
}

/** Each agent's real shares at Genial, its money and any order in progress. */
function RealWallet({ connected }: { connected: boolean }) {
  const { live, error } = useLive(connected);
  const { paper } = usePaper(connected);
  if (!connected) return null;
  if (error) return <p className="notice error-text" role="alert">{error}</p>;
  if (!live) return <p className="muted" role="status">Abrindo a carteira…</p>;
  const priceOf = (agentId: string) => {
    const vital = paper?.paper_agent_vitals?.find((v) => v.agent_id === agentId);
    return vital?.mark_price != null ? Number(vital.mark_price) : null;
  };
  const rows = live.agents.map((a) => {
    const position = live.positions.find((p) => p.agent_id === a.id && p.ticker === a.ticker);
    const quantity = Number(position?.quantity ?? 0), cost = Number(position?.cost ?? 0), realized = Number(position?.realized_pnl ?? 0);
    const price = priceOf(a.id);
    const order = live.orders.find((o) => o.agent_id === a.id && ACTIVE.includes(String(o.status)));
    return { ...a, quantity, cost, price, value: price !== null ? quantity * price : cost, free: Math.max(0, a.realBudget - cost + realized), order };
  });
  return (
    <section className="panel wallet">
      <div className="section-heading"><h2>Ações de cada IA na Genial</h2><span className="muted">dinheiro real · atualiza a cada 20 s</span></div>
      <div className="table-scroll"><table>
        <thead><tr><th>IA</th><th>Ações</th><th>Preço médio</th><th>Preço agora</th><th>Ganho</th><th>Em ações</th><th>Ordem em andamento</th></tr></thead>
        <tbody>{rows.map((r) => {
          const gain = r.quantity && r.price !== null ? r.value - r.cost : null;
          return <tr key={r.id}>
            <td><b>{r.name}</b> {r.ticker}</td>
            <td>{r.quantity || "—"}</td>
            <td>{r.quantity ? brl(r.cost / r.quantity) : "—"}</td>
            <td>{r.price !== null ? brl(r.price) : "—"}</td>
            <td className={gain === null || Math.abs(gain) < 0.005 ? "" : gain > 0 ? "up" : "down"}>{gain === null ? "—" : `${gain >= 0 ? "+" : "−"}${brl(Math.abs(gain))}`}</td>
            <td>{r.quantity ? brl(r.cost) : "—"}</td>
            <td>{r.order ? `${r.order.side === "BUY" ? "Compra" : "Venda"} de ${r.order.quantity} a ${brl(Number(r.order.limit_price))} (${ORDER_STATUS[String(r.order.status)] ?? r.order.status})` : "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="muted">O dinheiro fica no caixa do Chefe. Ele libera para uma IA quando o preço da ação dela chega perto da menor dos últimos 6 meses; ela vende perto da maior, nunca abaixo do que pagou, e o dinheiro volta para o caixa.</p>
    </section>
  );
}

export function TradesPage({ connected }: { connected: boolean }) {
  return <>
    <Heading title="Carteira" note="O dinheiro real na Genial, os depósitos e as ações de cada IA." />
    <Offline connected={connected} />
    <GenialBalance connected={connected} />
    <RealWallet connected={connected} />
  </>;
}

/** What the agents decided, with the reason in plain words (orders follow these decisions). */
function Decisions({ connected }: { connected: boolean }) {
  const { paper, error } = usePaper(connected);
  if (!connected) return null;
  if (error) return <p className="notice error-text" role="alert">{error}</p>;
  if (!paper) return <p className="muted" role="status">Lendo as decisões…</p>;
  const name = (id: unknown) => String(paper.agents?.find((a) => a.id === id)?.name ?? "IA");
  // Only decisions made since the agents started working with real money.
  const since = String(paper.paper_book_restarts?.[0]?.started_at ?? "");
  const proposals = [...(paper.paper_proposals ?? [])].filter((p) => String(p.created_at) > since).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100);
  const STATUS: Record<string, string> = { APPROVED: "aprovada pelo controle de risco", REJECTED: "recusada pelo controle de risco", PENDING: "aguardando", EXPIRED: "expirou" };
  return (
    <section className="panel decisions-log">
      <div className="section-heading"><h2>Decisões das IAs</h2><span className="muted">o que decidiram e por quê</span></div>
      {proposals.length ? <ul>{proposals.map((p) => (
        <li key={String(p.id)}>
          <span className="muted">{when(p.created_at)}</span>
          <b className={p.side === "BUY" ? "up" : "down"}>{name(p.agent_id)}: {p.side === "BUY" ? "comprar" : "vender"} {String(p.quantity)} a {brl(Number(p.limit_price))}</b>
          <span>{String(p.reasoning_summary ?? "").replace(/ Regra [^,]+, simulação\.$/, "").replace(/ virtual/g, "")}</span>
          <small>{STATUS[String(p.status)] ?? String(p.status).toLowerCase()}</small>
        </li>))}</ul>
        : <p className="muted">Nenhuma decisão de compra ou venda ainda. As IAs só operam com a bolsa aberta (10h05 às 16h50).</p>}
    </section>
  );
}

/** Orders actually sent to Genial and what happened to them. */
function RealOrders({ connected }: { connected: boolean }) {
  const { live, error } = useLive(connected);
  if (!connected) return null;
  if (error) return <p className="notice error-text" role="alert">{error}</p>;
  if (!live) return null;
  const name = (id: unknown) => live.agents.find((a) => a.id === id)?.name ?? "IA";
  return (
    <section className="panel decisions-log">
      <div className="section-heading"><h2>Ordens na Genial</h2><span className="muted">dinheiro real</span></div>
      {live.orders.length ? <ul>{live.orders.map((o) => (
        <li key={String(o.id)}>
          <span className="muted">{when(o.created_at)}</span>
          <b className={o.side === "BUY" ? "up" : "down"}>{name(o.agent_id)}: {o.side === "BUY" ? "compra" : "venda"} de {String(o.quantity)} {String(o.ticker)} a {brl(Number(o.limit_price))}</b>
          <small>{ORDER_STATUS[String(o.status)] ?? String(o.status)}{Number(o.filled_quantity) ? ` · ${o.filled_quantity} executada(s)` : ""}{o.error ? ` · ${o.error}` : ""}</small>
        </li>))}</ul>
        : <p className="muted">Nenhuma ordem enviada à Genial ainda.</p>}
    </section>
  );
}

export function HistoryPage({ connected }: { connected: boolean }) {
  return <>
    <Heading title="Histórico" note="O que as IAs decidiram, as ordens enviadas à Genial e as taxas pagas." />
    <Offline connected={connected} />
    <Decisions connected={connected} />
    <RealOrders connected={connected} />
    <CostsPanel connected={connected} realOnly />
  </>;
}

/** Bridge to Genial: connected, allowed to send orders, MetaTrader open. */
function BridgeStatus({ connected }: { connected: boolean }) {
  const [state, setState] = useState<{ available: boolean; reason?: string; executionEnabled?: boolean; health?: { healthy: boolean } } | null>(null);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    fetch("/api/atlas/broker-live", { signal: controller.signal }).then((r) => r.json()).then((b) => !controller.signal.aborted && setState(b)).catch(() => undefined);
    return () => controller.abort();
  }, [connected]);
  if (!connected || !state) return null;
  return (
    <section className="panel">
      <div className="section-heading"><h2>Ponte com a Genial</h2><span className="muted">MetaTrader neste computador</span></div>
      {state.available
        ? <p><span className="status-label success">Conectada</span> {state.executionEnabled ? "Pode enviar ordens." : "Só leitura: não envia ordens."} {state.health?.healthy ? "" : "Com problema: confira o MetaTrader."}</p>
        : <p><span className="status-label warning">Fora do ar</span> {state.reason}</p>}
      <p className="muted">As ordens reais só saem deste computador, com o MetaTrader aberto, durante o pregão.</p>
    </section>
  );
}

export function ControlsPage({ connected }: { connected: boolean }) {
  return <>
    <Heading title="Ajustes" note="Ligar ou desligar o dinheiro real, limites e o dinheiro de cada IA." />
    <Offline connected={connected} />
    <LivePanel connected={connected} />
    <BridgeStatus connected={connected} />
    <section className="panel">
      <div className="section-heading"><h2>Páginas técnicas</h2></div>
      <p className="muted">Para conferências mais detalhadas: <Link href="/app/settings">Configuração</Link> · <Link href="/app/treasury">Tesouraria</Link> · <Link href="/app/risk">Risco e limites</Link> · <Link href="/app/health">Saúde do sistema</Link> · <Link href="/app/audit">Auditoria</Link> · <Link href="/app/news">Notícias</Link></p>
    </section>
  </>;
}
