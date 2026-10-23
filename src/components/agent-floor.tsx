"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatBrl } from "@/core/format";
import { CandleChart, type ChartMarker } from "./candle-chart";
import { FleetAutopilot } from "./controls-panel";
import { Gestora, NewsTv, readingOf, useCdi, useNews, type NewsItem } from "./news-tv";
import { AgentCard, OfficeLegend, Scoreboard, useNow, type OfficeAgent } from "./office-map";

// three.js is loaded only in the browser, on the office screens.
const Office3D = dynamic(() => import("./office-3d").then((m) => m.Office3D), {
  ssr: false, loading: () => <div className="office3d office3d-loading" role="status">Montando o escritório 3D…</div>,
});
import { placeAgent } from "@/core/office";
import { ContributionPanel } from "./contribution-panel";
import { LivePanel } from "./live-panel";
import { b3Session } from "@/core/b3-calendar";
import type { HistoricalBar } from "@/providers/types";

type Row = Record<string, unknown>;
type Floor = { paper: Record<string, Row[]> | null; decisions: Row[]; error: string; loading: boolean };
const text = (v: unknown) => (v == null ? "—" : String(v));
const ago = (v: unknown) => {
  if (!v) return "sem registro";
  const minutes = Math.round((Date.now() - Date.parse(String(v))) / 60000);
  return minutes < 1 ? "agora" : minutes < 60 ? `há ${minutes} min` : minutes < 1440 ? `há ${Math.round(minutes / 60)} h` : `há ${Math.round(minutes / 1440)} d`;
};

function useFloor(connected: boolean, revision: number): Floor {
  const [state, setState] = useState<Floor>({ paper: null, decisions: [], error: "", loading: true });
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const read = (path: string) => fetch(`/api/atlas/${path}`, { signal: controller.signal }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Serviço indisponível.");
      return body;
    });
    Promise.all([read("paper"), read("decisions")])
      .then(([paper, decisions]) => !controller.signal.aborted && setState({ paper, decisions, error: "", loading: false }))
      .catch((e) => !controller.signal.aborted && setState({ paper: null, decisions: [], loading: false,
        error: e instanceof Error ? e.message : "Serviço indisponível." }));
    return () => controller.abort();
  }, [connected, revision]);
  return connected ? state : { paper: null, decisions: [], error: "", loading: false };
}

/**
 * The office. `mode`: "full" (office page with controls), "summary" (home page) or "tv"
 * (full-screen broadcast). Refreshes every 30 s so the agents walk between rooms live.
 */
export function AgentFloor({ connected, revision, tv = false, mode }: { connected: boolean; revision: number; tv?: boolean; mode?: "full" | "summary" | "tv" }) {
  const view = mode ?? (tv ? "tv" : "full");
  const now = useNow(30000);
  const [local, setLocal] = useState(0);
  const [selected, setSelected] = useState("");
  const floor = useFloor(connected, revision + local + Math.floor(now / 30000));
  const news = useNews(connected);
  const account = floor.paper?.paper_accounts?.[0];
  const cdiPct = useCdi(account?.created_at ? String(account.created_at).slice(0, 10) : null);
  if (!connected) return null;
  if (floor.loading) return <div className="loading-state" role="status">Abrindo o escritório…</div>;
  if (floor.error) return <div className="notice error-text" role="alert">{floor.error}</div>;
  const paper = floor.paper ?? {};
  const agents = paper.agents ?? [], assets = paper.assets ?? [], vitals = paper.paper_agent_vitals ?? [];
  if (!agents.length) return (
    <section className="panel empty-floor">
      <h2>O escritório está vazio.</h2>
      <p>Cadastre um ativo em Mercado e contrate o primeiro agente. Cada agente ganha uma mesa aqui.</p>
      <Link className="text-link" href="/app/agents">Contratar agente <ArrowRight size={14} /></Link>
    </section>
  );
  const vitalOf = (id: unknown) => vitals.find((v) => v.agent_id === id);
  const pnlOf = (v: Row | undefined) => v ? Number(v.realized_pnl) + Number(v.unrealized_pnl) : null;
  const alive = agents.filter((a) => !["DEAD", "FIRED"].includes(text(a.status)));
  const totalPnl = vitals.reduce((sum, v) => sum + (pnlOf(v) ?? 0), 0);
  const session = b3Session(new Date(now));
  const maxLossPct = Number(account?.agent_max_loss_pct ?? 20);
  const office: OfficeAgent[] = agents.map((agent) => {
    const asset = assets.find((a) => a.id === agent.asset_id);
    const ticker = text(asset?.ticker);
    const paperPosition = (paper.paper_positions ?? []).find((p) => p.agent_id === agent.id);
    const holding = Number(paperPosition?.quantity ?? 0);
    const order = (paper.paper_orders ?? []).find((o) => o.agent_id === agent.id && o.status === "OPEN");
    const headline = recentHeadline(news.items, ticker);
    const fresh = headline !== null && now - Date.parse(headline.item.published_at) < 3600000;
    const place = placeAgent({ id: text(agent.id), status: text(agent.status), enabled: agent.enabled !== false, autopilot: agent.autopilot !== false,
      holding, openOrder: order ? { side: order.side === "SELL" ? "SELL" : "BUY" } : null,
      lastAnalysisAt: agent.last_analysis_at ? String(agent.last_analysis_at) : null, freshNews: fresh, marketOpen: session.status === "OPEN", now });
    const budget = Number(agent.budget);
    const vital = vitalOf(agent.id);
    return { id: text(agent.id), name: text(agent.name), ticker, company: text(asset?.company_name ?? ticker), ...place,
      pnl: pnlOf(vital), life: vital ? Number(vital.life_pct) : null, budget, holding,
      paidTotal: holding > 0 ? holding * Number(paperPosition?.average_cost ?? 0) : 0,
      maxLoss: (budget * maxLossPct) / 100, nextAnalysisAt: agent.next_analysis_at ? String(agent.next_analysis_at) : null,
      headline: headline ? { title: headline.item.title, url: headline.item.url, direction: headline.tag.direction } : null };
  });
  const items = news.items ?? [];
  const top = items.find((i) => readingOf(i).tags.length) ?? items[0] ?? null;
  const chosen = office.find((a) => a.id === selected) ?? null;
  const band = items.slice(0, 14);
  return (
    <>
      <div className={`office ${view === "tv" ? "office-tv-mode" : ""}`}>
        <Scoreboard initial={account ? Number(account.initial_cash) : null} pnl={totalPnl} cdiPct={cdiPct}
          marketOpen={session.status === "OPEN"}
          marketNote={session.status === "OPEN" ? "As IAs podem comprar e vender (10h05 às 16h50)." : `${session.reason} As IAs só operam das 10h05 às 16h50 em dias úteis.`}
          alive={alive.length} total={agents.length} />
        <OfficeLegend />
        <div className="office-stage three">
          <Office3D agents={office} tvHeadline={top ? { title: top.title, source: top.source } : null} selected={selected || null} onSelect={setSelected}
            tvLines={[["Equipe (simulação)", `${totalPnl >= 0 ? "+" : "−"}${formatBrl(Math.abs(totalPnl).toFixed(2))}`, totalPnl >= 0 ? "#3dffa8" : "#ff5d7d"],
              ["CDI no período", cdiPct === null || !account ? "—" : `+${formatBrl(((Number(account.initial_cash) * cdiPct) / 100).toFixed(2))}`, "#ffc65c"],
              ["Bolsa", session.status === "OPEN" ? "Aberta" : "Fechada", session.status === "OPEN" ? "#3dffa8" : "#a9c0d6"]]} />
          {view !== "tv" && <AgentCard agent={chosen} agents={office} now={now} onSelect={setSelected} />}
        </div>
        {band.length > 0 && <div className="news-band office-band" aria-label="Últimas manchetes"><div className="news-band-track">
          {[...band, ...band].map((item, index) => <span key={`${item.url}-${index}`} aria-hidden={index >= band.length}>
            <strong>{item.source}</strong> {item.title}</span>)}
        </div></div>}
      </div>
      {view !== "tv" && <LivePanel connected={connected} />}
      {view !== "tv" && <ContributionPanel connected={connected} onApplied={() => setLocal((n) => n + 1)} />}
      {view === "full" && <NewsTv band={false} items={news.items} error={news.error} team={alive.map((a) => ({ name: text(a.name), ticker: text(assets.find((x) => x.id === a.asset_id)?.ticker) }))} />}
      {view === "full" && <details className="panel office-advanced">
        <summary>Controles, ranking e IA gestora</summary>
        <FleetAutopilot agents={agents} onChange={() => setLocal((n) => n + 1)} />
        <section className="ranking-panel">
          <div className="section-heading"><h2>Ranking da equipe</h2><span className="muted">Simulação</span></div>
          <div className="table-scroll"><table>
            <thead><tr><th>#</th><th>Agente</th><th>Resultado virtual</th><th>Vendas fechadas</th><th>Acerto</th><th>Vida</th></tr></thead>
            <tbody>{[...agents]
              .map((agent) => {
                const sells = (paper.paper_fills ?? []).filter((f) => f.agent_id === agent.id && f.side === "SELL");
                const wins = sells.filter((f) => Number(f.realized_pnl) > 0).length;
                const vital = vitalOf(agent.id);
                return { agent, pnl: pnlOf(vital), life: vital ? Number(vital.life_pct) : null, sells: sells.length, wins,
                  dead: ["DEAD", "FIRED"].includes(text(agent.status)) };
              })
              .sort((a, b) => Number(a.dead) - Number(b.dead) || (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity))
              .map((row, index) => (
                <tr key={text(row.agent.id)} className={row.dead ? "muted" : ""}>
                  <td>{index + 1}</td>
                  <td>{text(row.agent.name)} · {text(assets.find((a) => a.id === row.agent.asset_id)?.ticker)}{row.dead ? " · eliminado" : ""}</td>
                  <td className={row.pnl == null ? "" : row.pnl > 0 ? "up" : row.pnl < 0 ? "down" : ""}>{row.pnl == null ? "—" : formatBrl(row.pnl.toFixed(2))}</td>
                  <td>{row.sells}</td>
                  <td>{row.sells ? `${Math.round((row.wins / row.sells) * 100)}%` : "—"}</td>
                  <td>{row.life == null ? "—" : `${row.life.toFixed(0)}%`}</td>
                </tr>
              ))}</tbody>
          </table></div>
          <p className="muted">Acerto = vendas virtuais com lucro ÷ vendas fechadas. Poucas operações não provam nada: use o ranking depois de semanas.</p>
        </section>
        <Gestora agents={agents.map((agent) => ({ id: text(agent.id), name: text(agent.name), ticker: text(assets.find((a) => a.id === agent.asset_id)?.ticker),
          budget: Number(agent.budget), pnl: pnlOf(vitalOf(agent.id)), dead: ["DEAD", "FIRED"].includes(text(agent.status)),
          sells: (paper.paper_fills ?? []).filter((f) => f.agent_id === agent.id && f.side === "SELL").length }))}
          maxLossPct={maxLossPct} onApplied={() => setLocal((n) => n + 1)} />
      </details>}
    </>
  );
}

/** Latest headline about this stock from the last 3 hours (market-wide news excluded). */
function recentHeadline(items: NewsItem[] | null, ticker: string) {
  for (const item of items ?? []) {
    if (Date.now() - Date.parse(item.published_at) > 3 * 3600000) continue;
    const tag = readingOf(item).tags.find((t) => t.ticker === ticker);
    if (tag) return { item, tag };
  }
  return null;
}

/** Daily candles of the agent's asset (delayed brapi history, cached server-side). */
export function AgentMarket({ ticker }: { ticker: string | null }) {
  const [state, setState] = useState<{ ticker: string; bars: HistoricalBar[]; error: string } | null>(null);
  const news = useNews(ticker !== null, ticker ?? undefined);
  // Only news about this stock is marked; market-wide headlines would cover every candle.
  const markers: ChartMarker[] = (news.items ?? []).flatMap((item) => {
    const tag = readingOf(item).tags.find((t) => t.ticker === ticker);
    return tag ? [{ date: new Date(item.published_at).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }), direction: tag.direction, title: item.title }] : [];
  });
  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/atlas/history?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Histórico indisponível.");
        if (!controller.signal.aborted) setState({ ticker, bars: body.bars, error: "" });
      })
      .catch((e) => !controller.signal.aborted && setState({ ticker, bars: [], error: e instanceof Error ? e.message : "Histórico indisponível." }));
    return () => controller.abort();
  }, [ticker]);
  if (!ticker) return null;
  if (!state || state.ticker !== ticker) return <div className="loading-state" role="status">Consultando histórico de {ticker}…</div>;
  if (state.error) return <div className="notice error-text" role="alert">{state.error}</div>;
  return <section className="panel">{state.bars.length ? <CandleChart ticker={ticker} bars={state.bars} markers={markers} /> : <p className="muted">Sem candles para {ticker}.</p>}</section>;
}

type ContextView = { action: "ALLOW" | "REDUCE" | "BLOCK_BUY" | "EXIT"; riskScore: number;
  company?: { name: string; cvmCode: string | null };
  commodity?: { name: string; date: string; value: string; change1d: number | null; change5d: number | null; source: string } | null;
  reasons: { code: string; text: string; source: string | null }[]; unavailable: string[]; assessedAt: string };
const CONTEXT_LABELS: Record<ContextView["action"], [string, string]> = {
  ALLOW: ["Clima normal", ""], REDUCE: ["Cautela: compras pela metade", "warning"],
  BLOCK_BUY: ["Compras bloqueadas", "warning"], EXIT: ["Sair da posição", "danger"],
};
const SOURCE_LABELS: Record<string, string> = { CVM_FACTS: "fatos relevantes (CVM)", COMPANY_NEWS: "notícias da empresa",
  MARKET_NEWS: "notícias do mercado", DOLLAR: "dólar (Banco Central)", BRENT: "petróleo Brent (FRED)" };
const signed = (x: number | null) => (x === null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}%`);

function contextOf(decision: Row | undefined): ContextView | null {
  const value = (decision?.inputs as { context?: ContextView } | undefined)?.context;
  return value && CONTEXT_LABELS[value.action] ? value : null;
}

export function AgentContextPanel({ decision }: { decision: Row | undefined }) {
  const context = contextOf(decision);
  return <section className="panel">
    <div className="section-heading"><h2>Contexto de mercado</h2><span className="muted">Regras gratuitas · CVM, GDELT, Banco Central</span></div>
    {!context ? <p className="muted">A próxima análise registrará o contexto deste agente.</p> : <>
      <p><span className={`status-label ${CONTEXT_LABELS[context.action][1]}`}>{CONTEXT_LABELS[context.action][0]}</span> Risco de contexto: {context.riskScore}/100 · avaliado {ago(context.assessedAt)}</p>
      {context.reasons.length ? <ul className="context-reasons">{context.reasons.map((r) => <li key={r.code + r.text}>{r.text}{r.source && <> · <a href={r.source} target="_blank" rel="noopener noreferrer">fonte</a></>}</li>)}</ul>
        : <p className="muted">Nenhum fato relevante recente, manchete negativa forte, estresse de mercado ou choque do dólar.</p>}
      {context.commodity && <p>{context.commodity.name}: <strong>US$ {context.commodity.value}</strong> em {context.commodity.date} ·
        no dia {signed(context.commodity.change1d)} · em 5 pregões {signed(context.commodity.change5d)} · <a href={context.commodity.source} target="_blank" rel="noopener noreferrer">fonte</a></p>}
      {context.company && <p className="muted">{context.company.cvmCode
        ? `Empresa reconhecida na CVM: ${context.company.name} (código ${Number(context.company.cvmCode)}).`
        : `Empresa "${context.company.name}" não identificada na CVM: fatos relevantes não são lidos. Cadastre o ativo com o nome oficial completo (ex.: "Banco Bradesco").`}</p>}
      {context.unavailable.length > 0 && <p className="muted">Fontes indisponíveis nesta análise: {context.unavailable.map((u) => SOURCE_LABELS[u] ?? u).join(", ")}. Sem dado, nada é presumido.</p>}
      <p className="muted">O contexto só freia: bloqueia compras, reduz o tamanho ou pede saída. Ele nunca inicia uma compra.</p>
    </>}
  </section>;
}


type Levels = { available: false; reason: string; bars: number } | { available: true; bars: number; from: string; to: string; lastClose: string; eventsVerified: boolean;
  plan: { floor: string; ceiling: string; low52w: string | null; high52w: string | null; trendAverage: string | null; trendUp: boolean } | null };

/** Price references from the long official history (52-week range, recent floor/ceiling, trend). */
export function AgentLevels({ ticker }: { ticker: string | null }) {
  const [state, setState] = useState<{ ticker: string; levels: Levels | null; error: string } | null>(null);
  useEffect(() => {
    if (!ticker) return;
    const controller = new AbortController();
    fetch(`/api/atlas/levels?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Indisponível."); if (!controller.signal.aborted) setState({ ticker, levels: body, error: "" }); })
      .catch((e) => !controller.signal.aborted && setState({ ticker, levels: null, error: e instanceof Error ? e.message : "Indisponível." }));
    return () => controller.abort();
  }, [ticker]);
  if (!ticker) return null;
  if (!state || state.ticker !== ticker) return <div className="loading-state" role="status">Calculando níveis de {ticker}…</div>;
  if (state.error || !state.levels) return <div className="notice error-text">{state.error}</div>;
  const levels = state.levels;
  if (!levels.available || !levels.plan) return <section className="panel"><h2>Níveis de preço</h2><p className="muted">{levels.available ? "Histórico insuficiente." : levels.reason}</p></section>;
  const plan = levels.plan, brl = (v: string | null) => (v ? formatBrl(v) : "—");
  return (
    <section className="panel">
      <div className="section-heading"><h2>Níveis de preço de {ticker}</h2><span className="muted">{levels.bars} pregões oficiais · {levels.from} a {levels.to}</span></div>
      <div className="metrics-row compact-metrics levels-row">
        <div className="metric"><span>Último fechamento</span><strong>{brl(levels.lastClose)}</strong><small>{levels.to}</small></div>
        <div className="metric"><span>Mínima de 52 semanas</span><strong>{brl(plan.low52w)}</strong><small>Menor preço do último ano</small></div>
        <div className="metric"><span>Máxima de 52 semanas</span><strong>{brl(plan.high52w)}</strong><small>Maior preço do último ano</small></div>
        <div className="metric"><span>Média de 100 dias</span><strong>{brl(plan.trendAverage)}</strong><small className={plan.trendUp ? "up" : "down"}>{plan.trendUp ? "Tendência de alta" : "Tendência de baixa"}</small></div>
      </div>
      <p>Faixa recente (20 pregões): piso <strong>{brl(plan.floor)}</strong> · teto <strong>{brl(plan.ceiling)}</strong>.</p>
      <p className="muted">Preços ajustados por desdobramentos e grupamentos oficiais{levels.eventsVerified ? "" : " (eventos da B3 indisponíveis agora)"}. Referência para você acompanhar; a regra que decide as compras está descrita no relatório de backtest.</p>
    </section>
  );
}
