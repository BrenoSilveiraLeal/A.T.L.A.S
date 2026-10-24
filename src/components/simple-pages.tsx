"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Tv } from "lucide-react";
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

export function OfficePage({ connected }: { connected: boolean }) {
  return <>
    <Heading title="Escritório" note="O que cada IA está fazendo agora, ao vivo.">
      <Link className="button secondary" href="/tv"><Tv size={16} /> Modo TV</Link>
    </Heading>
    <Offline connected={connected} />
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
      <p className="muted">Juntando = parte do aporte que a IA ainda não usou; ela compra quando chega a R$ 80. Vende só com +60% sobre o preço médio, nunca no prejuízo.</p>
    </section>
  );
}

export function TradesPage({ connected }: { connected: boolean }) {
  const [revision, setRevision] = useState(0);
  return <>
    <Heading title="Compras e vendas" note="Carteira, pedidos, dinheiro real e o aporte mensal." />
    <Offline connected={connected} />
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
