"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";
import { formatBrl } from "@/core/format";
import { suggestAllocation, type AllocationAgent } from "@/core/allocation";
import type { NewsDirection, NewsTag } from "@/core/news";

export interface NewsItem { url: string; title: string; source: string; published_at: string; tags: NewsTag[]; ai?: NewsTag[] | null; ai_model?: string | null }

/** The AI reading wins once it exists (even "no impact"); keywords until then. */
export function readingOf(item: NewsItem): { tags: NewsTag[]; by: string } {
  return item.ai ? { tags: item.ai, by: `IA ${item.ai_model ?? ""}`.trim() } : { tags: item.tags, by: "palavras-chave" };
}
type Row = Record<string, unknown>;

export const DIRECTION: Record<NewsDirection, [string, string]> = {
  UP: ["pode subir", "success"], DOWN: ["pode cair", "danger"], WATCH: ["atenção", "warning"],
};
const hour = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Polls the office TV every 2 minutes while the floor is open. */
export function useNews(connected: boolean, ticker?: string) {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connected) return;
    let controller = new AbortController();
    const read = () => {
      controller.abort();
      controller = new AbortController();
      const signal = controller.signal;
      fetch(`/api/atlas/news-tv${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`, { signal })
        .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "TV fora do ar."); if (!signal.aborted) { setItems(body.items); setError(""); } })
        .catch((e) => !signal.aborted && setError(e instanceof Error ? e.message : "TV fora do ar."));
    };
    read();
    const timer = setInterval(read, 120000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [connected, ticker]);
  return { items, error };
}

/** "Who in the office reacts": agent names per tag ("*" = every living agent). */
function reactions(tags: NewsTag[], team: { name: string; ticker: string }[]) {
  return tags.flatMap((tag) => tag.ticker === "*"
    ? [{ key: `*${tag.why}`, label: `Todos · ${tag.why}`, direction: tag.direction }]
    : team.filter((a) => a.ticker === tag.ticker).map((a) => ({ key: a.name + tag.ticker, label: `${a.name} (${a.ticker}) · ${tag.why}`, direction: tag.direction })));
}

export function NewsTv({ items, error, team, band: showBand = true }: { items: NewsItem[] | null; error: string; team: { name: string; ticker: string }[]; band?: boolean }) {
  const tagged = (items ?? []).filter((i) => reactions(readingOf(i).tags, team).length).slice(0, 8);
  const band = (items ?? []).slice(0, 14);
  return (
    <section className="panel news-tv" aria-label="TV de notícias do escritório">
      <div className="section-heading">
        <h2><Tv size={16} /> TV do escritório</h2>
        <span className="muted"><span className="live-dot" aria-hidden="true" /> Agência Brasil · Banco Central · InfoMoney · GDELT · CVM</span>
      </div>
      {error && <p className="notice error-text" role="alert">{error}</p>}
      {items === null && !error ? <p className="muted" role="status">Ligando a TV…</p> : band.length === 0 ? <p className="muted">Nenhuma manchete nas últimas 48 horas ainda. A TV atualiza a cada 5 minutos.</p> : <>
        {showBand && <div className="news-band"><div className="news-band-track">
          {[...band, ...band].map((item, index) => <span key={`${item.url}-${index}`} aria-hidden={index >= band.length}>
            <strong>{item.source}</strong> {item.title}</span>)}
        </div></div>}
        {tagged.length ? <ul className="news-list">{tagged.map((item) => (
          <li key={item.url}>
            <div className="news-meta"><span>{hour(item.published_at)}</span><span>{item.source}</span><span>lido por {readingOf(item).by}</span></div>
            <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
            <div className="news-reactions">{reactions(readingOf(item).tags, team).map((r) =>
              <span key={r.key} className={`status-label ${DIRECTION[r.direction][1]}`}>{r.label}: {DIRECTION[r.direction][0]}</span>)}</div>
          </li>))}</ul>
          : <p className="muted">Nenhuma manchete recente mexe com as ações da equipe.</p>}
      </>}
      <p className="muted">Leitura grátis: palavras-chave na hora e, com o Ollama ligado, uma IA no seu PC relendo as manchetes mais importantes. Mostra o que pode fazer a ação subir ou cair; as compras seguem a regra testada e a notícia só freia.</p>
    </section>
  );
}

/** Accumulated CDI (%) since `from`, or null while unknown. */
export function useCdi(from: string | null) {
  const [cdi, setCdi] = useState<{ from: string; pct: number | null } | null>(null);
  useEffect(() => {
    if (!from) return;
    const controller = new AbortController();
    fetch(`/api/atlas/benchmark?from=${from}`, { signal: controller.signal }).then((r) => r.json())
      .then((b) => !controller.signal.aborted && setCdi({ from, pct: b.available ? b.pct : null }))
      .catch(() => !controller.signal.aborted && setCdi({ from, pct: null }));
    return () => controller.abort();
  }, [from]);
  return cdi && cdi.from === from ? cdi.pct : null;
}

/** Big screen: virtual equity against the CDI over the same period. */
export function Telao({ account, totalPnl }: { account: Row | undefined; totalPnl: number }) {
  const from = account?.created_at ? String(account.created_at).slice(0, 10) : null;
  const [cdi, setCdi] = useState<{ from: string; pct: number | null } | null>(null);
  useEffect(() => {
    if (!from) return;
    const controller = new AbortController();
    fetch(`/api/atlas/benchmark?from=${from}`, { signal: controller.signal }).then((r) => r.json())
      .then((b) => !controller.signal.aborted && setCdi({ from, pct: b.available ? b.pct : null }))
      .catch(() => !controller.signal.aborted && setCdi({ from, pct: null }));
    return () => controller.abort();
  }, [from]);
  if (!account || !from) return null;
  const initial = Number(account.initial_cash), equity = initial + totalPnl, ours = (totalPnl / initial) * 100;
  const theirs = cdi?.from === from ? cdi.pct : null;
  const scale = Math.max(Math.abs(ours), Math.abs(theirs ?? 0), 0.5);
  const bar = (pct: number) => ({ width: `${Math.min(100, (Math.abs(pct) / scale) * 100)}%` });
  return (
    <section className="panel telao" aria-label="Telão: equipe contra o CDI">
      <div className="section-heading"><h2>Telão</h2><span className="muted">Desde {from.split("-").reverse().join("/")} · simulação</span></div>
      <div className="telao-rows">
        <div><span>Equipe ATLAS</span><div className="telao-track"><div className={`telao-fill ${ours < 0 ? "down" : ""}`} style={bar(ours)} /></div>
          <strong className={ours > 0 ? "up" : ours < 0 ? "down" : ""}>{ours >= 0 ? "+" : ""}{ours.toFixed(2)}%</strong></div>
        <div><span>CDI</span><div className="telao-track"><div className="telao-fill cdi" style={bar(theirs ?? 0)} /></div>
          <strong>{theirs === null ? "—" : `+${theirs.toFixed(2)}%`}</strong></div>
      </div>
      <p className="muted">Patrimônio virtual {formatBrl(equity.toFixed(2))} de {formatBrl(initial.toFixed(2))}. {theirs === null ? "CDI indisponível agora." : ours > theirs ? "A equipe está ganhando do CDI." : "O CDI está ganhando da equipe: dinheiro parado renderia mais."}</p>
    </section>
  );
}

/** "IA gestora": suggested budgets by simulated result; never applied automatically. */
export function Gestora({ agents, maxLossPct, onApplied }: { agents: AllocationAgent[]; maxLossPct: number; onApplied: () => void }) {
  const [state, setState] = useState<{ busy: boolean; message: string }>({ busy: false, message: "" });
  if (agents.length < 2) return null;
  const plan = suggestAllocation(agents, 3, maxLossPct);
  const changes = plan.rows.filter((r) => r.suggested !== r.current);
  async function apply() {
    if (!window.confirm(`Aplicar os orçamentos sugeridos em ${changes.length} agente(s) da simulação?`)) return;
    setState({ busy: true, message: "" });
    try {
      const response = await fetch("/api/atlas/controls", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "budgets", budgets: changes.map((r) => ({ agentId: r.id, budget: r.suggested.toFixed(2) })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível aplicar.");
      setState({ busy: false, message: "Orçamentos aplicados. Valem a partir da próxima análise de cada agente." });
      onApplied();
    } catch (e) { setState({ busy: false, message: e instanceof Error ? e.message : "Não foi possível aplicar." }); }
  }
  return (
    <section className="panel gestora" aria-label="IA gestora">
      <div className="section-heading"><h2>IA gestora</h2><span className="muted">Simulação · você decide</span></div>
      <p className="muted">Ela redistribui o orçamento total da equipe (corte nunca deixa uma IA com menos de 25% de vida) ({formatBrl(plan.pool.toFixed(2))}): mais para quem dá resultado, menos para quem perde. {plan.measured ? "" : "Ninguém tem 3 vendas fechadas ainda, então todos ficam iguais."}</p>
      <div className="table-scroll"><table>
        <thead><tr><th>Agente</th><th>Orçamento hoje</th><th>Sugestão</th><th>Motivo</th></tr></thead>
        <tbody>{plan.rows.map((r) => <tr key={r.id}><td>{r.name} · {r.ticker}</td><td>{formatBrl(r.current.toFixed(2))}</td>
          <td className={r.suggested > r.current ? "up" : r.suggested < r.current ? "down" : ""}>{formatBrl(r.suggested.toFixed(2))}</td><td>{r.reason}</td></tr>)}</tbody>
      </table></div>
      {plan.vacancies.length > 0 && <p>Vaga aberta: {plan.vacancies.join(", ")} está sem IA viva. A gestora sugere <Link className="text-link" href="/app/agents">contratar uma nova em Agentes</Link>.</p>}
      <button type="button" className="button" disabled={!changes.length || state.busy} onClick={apply}>
        {state.busy ? "Aplicando…" : changes.length ? `Aplicar sugestão (${changes.length})` : "Nada a mudar"}
      </button>
      {state.message && <p className="muted" role="status">{state.message}</p>}
    </section>
  );
}

/** News this agent "watched": its own stock plus market-wide headlines, with its reading. */
export function AgentNews({ ticker, name, connected }: { ticker: string | null; name: string; connected: boolean }) {
  const news = useNews(connected && ticker !== null, ticker ?? undefined);
  if (!ticker) return null;
  const items = (news.items ?? []).slice(0, 12);
  return (
    <section className="panel">
      <div className="section-heading"><h2>O que {name} viu na TV</h2><span className="muted">{ticker} e notícias gerais · até 30 dias</span></div>
      {news.error && <p className="notice error-text" role="alert">{news.error}</p>}
      {news.items === null && !news.error ? <p className="muted" role="status">Procurando notícias…</p> : items.length === 0 ? <p className="muted">Nenhuma notícia sobre {ticker} ou o mercado registrada ainda.</p> :
        <ul className="news-list">{items.map((item) => {
          const reading = readingOf(item);
          const tag = reading.tags.find((t) => t.ticker === ticker) ?? reading.tags.find((t) => t.ticker === "*");
          if (!tag) return null;
          return <li key={item.url}>
            <div className="news-meta"><span>{hour(item.published_at)}</span><span>{item.source}</span><span>{tag.ticker === "*" ? "mercado" : ticker} · {tag.why}</span><span>lido por {reading.by}</span></div>
            <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
            <div className="news-reactions"><span className={`status-label ${DIRECTION[tag.direction][1]}`}>{DIRECTION[tag.direction][0]}</span></div>
          </li>;
        })}</ul>}
      <p className="muted">Compare com o gráfico abaixo: as datas mostram se a ação subiu ou caiu depois da notícia.</p>
    </section>
  );
}
