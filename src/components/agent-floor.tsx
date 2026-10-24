"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { formatBrl } from "@/core/format";
import { CandleChart, type ChartMarker } from "./candle-chart";
import { readingOf, useCdi, useNews, type NewsItem } from "./news-tv";
import { AgentCard, OfficeLegend, Scoreboard, useNow, type AgentChart, type OfficeAgent } from "./office-map";

// three.js is loaded only in the browser, on the office screens.
const Office3D = dynamic(() => import("./office-3d").then((m) => m.Office3D), {
  ssr: false, loading: () => <div className="office3d office3d-loading" role="status">Montando o escritório 3D…</div>,
});
import { placeAgent } from "@/core/office";
import { committee } from "@/core/committee";
import { STEADY_RULE } from "@/core/autopilot";
import { HEALTH_LABELS, type CompanyHealth } from "@/core/company-health";
import type { ContextAction } from "@/core/context";
import { b3Session } from "@/core/b3-calendar";
import type { HistoricalBar } from "@/providers/types";

type Row = Record<string, unknown>;
type Live = { genial: { deposited: number; free: number }; agents: { id: string; realBudget: number }[]; positions: Row[]; orders: Row[]; fills: Row[] };
type Floor = { paper: Record<string, Row[]> | null; decisions: Row[]; health: Record<string, CompanyHealth> | null; live: Live | null; error: string; loading: boolean };
const text = (v: unknown) => (v == null ? "—" : String(v));
const ago = (v: unknown) => {
  if (!v) return "sem registro";
  const minutes = Math.round((Date.now() - Date.parse(String(v))) / 60000);
  return minutes < 1 ? "agora" : minutes < 60 ? `há ${minutes} min` : minutes < 1440 ? `há ${Math.round(minutes / 60)} h` : `há ${Math.round(minutes / 1440)} d`;
};

function useFloor(connected: boolean, revision: number): Floor {
  const [state, setState] = useState<Floor>({ paper: null, decisions: [], health: null, live: null, error: "", loading: true });
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const read = (path: string) => fetch(`/api/atlas/${path}`, { signal: controller.signal }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Serviço indisponível.");
      return body;
    });
    Promise.all([read("paper"), read("decisions"), read("company-health").catch(() => null), read("live").catch(() => null)])
      .then(([paper, decisions, health, live]) => !controller.signal.aborted && setState({ paper, decisions, health, live, error: "", loading: false }))
      .catch((e) => !controller.signal.aborted && setState({ paper: null, decisions: [], health: null, live: null, loading: false,
        error: e instanceof Error ? e.message : "Serviço indisponível." }));
    return () => controller.abort();
  }, [connected, revision]);
  return connected ? state : { paper: null, decisions: [], health: null, live: null, error: "", loading: false };
}

/** Daily candles of every team stock for the desk monitors (cached server-side; refreshed every 10 min). */
function useCharts(tickers: string[]) {
  const [charts, setCharts] = useState<Record<string, AgentChart["bars"]>>({});
  const key = [...tickers].sort().join(",");
  const tick = Math.floor(useNow(600000) / 600000);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    Promise.all(key.split(",").map((ticker) => fetch(`/api/atlas/history?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { bars?: HistoricalBar[] } | null) => [ticker, (b?.bars ?? []).slice(-60).map((x) => ({
        open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close) }))] as const)
      .catch(() => [ticker, []] as const)))
      .then((rows) => { if (!controller.signal.aborted) setCharts(Object.fromEntries(rows)); });
    return () => controller.abort();
  }, [key, tick]);
  return charts;
}

/**
 * The office. `mode`: "full" (office page: scoreboard, 3D office and what each AI is doing),
 * "summary" (without the team list) or "tv" (full-screen broadcast). Refreshes every 30 s.
 */
export function AgentFloor({ connected, revision, tv = false, mode }: { connected: boolean; revision: number; tv?: boolean; mode?: "full" | "summary" | "tv" }) {
  const view = mode ?? (tv ? "tv" : "full");
  const now = useNow(30000);
  const [selected, setSelected] = useState("");
  const floor = useFloor(connected, revision + Math.floor(now / 30000));
  const news = useNews(connected);
  const paper = floor.paper ?? {};
  const assets = paper.assets ?? [];
  const charts = useCharts(assets.map((a) => text(a.ticker)));
  const account = paper.paper_accounts?.[0];
  const cdiPct = useCdi(account?.created_at ? String(account.created_at).slice(0, 10) : null);
  if (!connected) return null;
  if (floor.loading) return <div className="loading-state" role="status">Abrindo o escritório…</div>;
  if (floor.error) return <div className="notice error-text" role="alert">{floor.error}</div>;
  const agents = paper.agents ?? [], vitals = paper.paper_agent_vitals ?? [];
  if (!agents.length) return (
    <section className="panel empty-floor">
      <h2>O escritório está vazio.</h2>
      <p>Nenhuma IA contratada. Peça ao Claude Code para criar uma IA para uma ação.</p>
    </section>
  );
  const vitalOf = (id: unknown) => vitals.find((v) => v.agent_id === id);
  const alive = agents.filter((a) => !["DEAD", "FIRED"].includes(text(a.status)));
  const session = b3Session(new Date(now));
  const maxLossPct = Number(account?.agent_max_loss_pct ?? 40);
  const office: OfficeAgent[] = alive.map((agent) => {
    const asset = assets.find((a) => a.id === agent.asset_id);
    const ticker = text(asset?.ticker);
    // Real money only: shares, cost and orders come from the Genial account (live_*).
    const position = (floor.live?.positions ?? []).find((p) => p.agent_id === agent.id && p.ticker === ticker);
    const holding = Number(position?.quantity ?? 0), cost = Number(position?.cost ?? 0), realized = Number(position?.realized_pnl ?? 0);
    const averageCost = holding > 0 ? cost / holding : null;
    const order = (floor.live?.orders ?? []).find((o) => o.agent_id === agent.id && ACTIVE_ORDER.includes(String(o.status)));
    const headline = recentHeadline(news.items, ticker);
    const fresh = headline !== null && now - Date.parse(headline.item.published_at) < 3600000;
    const place = placeAgent({ id: text(agent.id), status: text(agent.status), enabled: agent.enabled !== false, autopilot: agent.autopilot !== false,
      holding, openOrder: order ? { side: order.side === "SELL" ? "SELL" : "BUY" } : null,
      lastAnalysisAt: agent.last_analysis_at ? String(agent.last_analysis_at) : null, freshNews: fresh, marketOpen: session.status === "OPEN", now });
    const budget = floor.live?.agents.find((a) => a.id === agent.id)?.realBudget ?? 0;
    const vital = vitalOf(agent.id);
    const bars = charts[ticker] ?? [];
    const last = vital?.mark_price != null ? Number(vital.mark_price) : null;
    const h = floor.health?.[ticker];
    const health = h ? { level: h.level, reason: h.reasons[0] ?? "" } : null;
    const decision = floor.decisions.find((d) => d.agent_id === agent.id);
    const ctx = (decision?.inputs as { context?: { action: ContextAction; reasons?: { text: string }[] } } | undefined)?.context;
    const debate = committee({
      context: ctx ? { action: ctx.action, summary: ctx.reasons?.[0]?.text ?? "" } : null, health,
      holding, averageCost, price: last ?? bars.at(-1)?.close ?? null,
      budgetRoom: budget - cost + realized, rule: STEADY_RULE,
    });
    return { id: text(agent.id), name: text(agent.name), ticker, company: text(asset?.company_name ?? ticker), ...place,
      pnl: holding > 0 || realized ? realized + holding * (last ?? bars.at(-1)?.close ?? averageCost ?? 0) - cost : null,
      life: vital ? Number(vital.life_pct) : null, budget, holding, paidTotal: cost,
      events: agentEvents(text(agent.id), floor.live, paper.paper_proposals ?? [], String(paper.paper_book_restarts?.[0]?.started_at ?? "")),
      maxLoss: (budget * maxLossPct) / 100, nextAnalysisAt: agent.next_analysis_at ? String(agent.next_analysis_at) : null,
      headline: headline ? { title: headline.item.title, url: headline.item.url, direction: headline.tag.direction } : null,
      chart: { bars, last }, health, debate };
  });
  const items = news.items ?? [];
  const top = items.find((i) => readingOf(i).tags.length) ?? items[0] ?? null;
  const totalPnl = office.reduce((sum, a) => sum + (a.pnl ?? 0), 0);
  const chosen = office.find((a) => a.id === selected) ?? null;
  const band = items.slice(0, 14);
  return (
    <>
      <div className={`office ${view === "tv" ? "office-tv-mode" : ""}`}>
        <Scoreboard initial={floor.live ? floor.live.genial.deposited : null} pnl={totalPnl} cdiPct={cdiPct}
          marketOpen={session.status === "OPEN"}
          marketNote={session.status === "OPEN" ? "As IAs podem comprar e vender (10h05 às 16h50)." : `${session.reason} As IAs só operam das 10h05 às 16h50 em dias úteis.`}
          alive={alive.length} total={alive.length} />
        <OfficeLegend />
        <div className="office-stage three">
          <Office3D agents={office} tvHeadline={top ? { title: top.title, source: top.source } : null} selected={selected || null} onSelect={setSelected}
            tvLines={[["Resultado real", `${totalPnl >= 0 ? "+" : "−"}${formatBrl(Math.abs(totalPnl).toFixed(2))}`, totalPnl >= 0 ? "#3dffa8" : "#ff5d7d"],
              ["CDI no período", cdiPct === null || !account ? "—" : `+${formatBrl(((Number(account.initial_cash) * cdiPct) / 100).toFixed(2))}`, "#ffc65c"],
              ["Bolsa", session.status === "OPEN" ? "Aberta" : "Fechada", session.status === "OPEN" ? "#3dffa8" : "#a9c0d6"]]} />
          {view !== "tv" && <AgentCard agent={chosen} now={now} onSelect={setSelected} />}
        </div>
        {band.length > 0 && <div className="news-band office-band" aria-label="Últimas manchetes"><div className="news-band-track">
          {[...band, ...band].map((item, index) => <span key={`${item.url}-${index}`} aria-hidden={index >= band.length}>
            <strong>{item.source}</strong> {item.title}</span>)}
        </div></div>}
      </div>
      {view === "full" && <TeamStatus agents={office} onSelect={setSelected} />}
    </>
  );
}

/** What each AI is doing, in plain words: one row per agent. */
function TeamStatus({ agents, onSelect }: { agents: OfficeAgent[]; onSelect: (id: string) => void }) {
  return (
    <section className="panel team-status">
      <div className="section-heading"><h2>O que cada IA está fazendo</h2><span className="muted">atualiza a cada 30 s</span></div>
      <ul>{agents.map((a) => {
        const price = a.chart?.last ?? a.chart?.bars.at(-1)?.close ?? null;
        return (
          <li key={a.id}>
            <button type="button" onClick={() => { onSelect(a.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              <span className="team-who"><b>{a.name}</b> {a.ticker}{price !== null && <small>{formatBrl(price.toFixed(2))}</small>}</span>
              <span className="team-doing">{a.activity}</span>
              {a.debate && <span className={`team-verdict ${a.debate.verdict.toLowerCase()}`}>{a.debate.summary}</span>}
              <span className="team-facts">
                <span>{a.holding > 0 ? `${a.holding} ações a ${formatBrl((a.paidTotal / a.holding).toFixed(2))}` : "sem ações ainda"}</span>
                {a.health && <span className={`health-chip ${a.health.level.toLowerCase()}`}>{HEALTH_LABELS[a.health.level]}</span>}
                <span className={a.pnl === null || Math.abs(a.pnl) < 0.005 ? "" : a.pnl > 0 ? "up" : "down"}>
                  {a.pnl === null ? "—" : `${a.pnl >= 0 ? "+" : "−"}${formatBrl(Math.abs(a.pnl).toFixed(2))}`}</span>
              </span>
            </button>
          </li>
        );
      })}</ul>
      <p className="muted">Toque numa IA para ver a reunião dela com os especialistas (Risco, Balanço e Estratégia), o plano e a última notícia.</p>
    </section>
  );
}

const ACTIVE_ORDER = ["PENDING", "DISPATCHED", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"];
const ORDER_STATUS: Record<string, string> = { PENDING: "preparando", DISPATCHED: "enviada à Genial", OPEN: "aberta na Genial",
  PARTIALLY_FILLED: "executada em parte", FILLED: "executada", CANCELLED: "cancelada", REJECTED: "recusada", EXPIRED: "expirou", UNKNOWN: "sem confirmação da Genial" };
const brl = (v: number) => formatBrl(v.toFixed(2));

/** The agent's real history, newest first: executed trades, orders sent to Genial and decisions. */
function agentEvents(agentId: string, live: Live | null, proposals: Row[], since: string) {
  const events: { at: string; text: string; tone: "up" | "down" | "info" }[] = [];
  for (const f of live?.fills ?? []) if (f.agent_id === agentId)
    events.push({ at: String(f.executed_at), tone: f.side === "BUY" ? "up" : "down",
      text: `${f.side === "BUY" ? "Comprou" : "Vendeu"} ${f.quantity} ${f.ticker} a ${brl(Number(f.price))} (taxa ${brl(Number(f.fee))})` });
  for (const o of live?.orders ?? []) if (o.agent_id === agentId && o.status !== "FILLED")
    events.push({ at: String(o.created_at), tone: "info",
      text: `Ordem de ${o.side === "BUY" ? "compra" : "venda"} de ${o.quantity} ${o.ticker} a ${brl(Number(o.limit_price))}: ${ORDER_STATUS[String(o.status)] ?? String(o.status)}${o.error ? ` (${o.error})` : ""}` });
  for (const p of proposals) if (p.agent_id === agentId && String(p.created_at) > since)
    events.push({ at: String(p.created_at), tone: "info",
      text: `Decidiu ${p.side === "BUY" ? "comprar" : "vender"}: ${String(p.reasoning_summary ?? "").replace(/^[A-Z0-9]+: /, "").replace(/ Regra [^,]+, simulação\.$/, "")}` });
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
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
