"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Skull, Zap } from "lucide-react";
import { formatBrl } from "@/core/format";
import { statusLabel } from "./labels";
import { CandleChart, type ChartMarker } from "./candle-chart";
import { FleetAutopilot } from "./controls-panel";
import { DIRECTION, Gestora, NewsTv, readingOf, Telao, useNews, type NewsItem } from "./news-tv";
import type { HistoricalBar } from "@/providers/types";

type Row = Record<string, unknown>;
type Floor = { paper: Record<string, Row[]> | null; decisions: Row[]; error: string; loading: boolean };
const text = (v: unknown) => (v == null ? "—" : String(v));
const ago = (v: unknown) => {
  if (!v) return "sem registro";
  const minutes = Math.round((Date.now() - Date.parse(String(v))) / 60000);
  return minutes < 1 ? "agora" : minutes < 60 ? `há ${minutes} min` : minutes < 1440 ? `há ${Math.round(minutes / 60)} h` : `há ${Math.round(minutes / 1440)} d`;
};
const WORKING = new Set(["ANALYZING", "WATCHING_MARKET", "READING_NEWS", "NEWS_REVIEW", "PREPARING_ORDER", "ORDER_PENDING", "MONITORING"]);

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
 * Character drawn from the agent's recorded state only. "tv": a recent headline about its
 * stock; "coffee": alive, not working and holding no position (waiting for a signal).
 */
function Character({ avatar, status, trend, mode }: { avatar: string; status: string; trend: number | null; mode: "tv" | "coffee" | null }) {
  const dead = status === "DEAD" || status === "FIRED";
  const line = trend == null ? "M10 30 L46 30" : trend >= 0 ? "M10 36 L20 30 L28 33 L38 22 L46 18" : "M10 18 L20 24 L28 21 L38 32 L46 36";
  return (
    <svg className={`character ${WORKING.has(status) ? "working" : ""} ${dead ? "dead" : ""} ${mode ?? ""}`} viewBox="0 0 96 80" aria-hidden="true">
      <rect x="4" y="8" width="48" height="36" rx="4" className="monitor" />
      <path d={line} className={`monitor-line ${trend != null && trend < 0 ? "down" : ""}`} />
      <rect x="24" y="44" width="8" height="8" className="desk-detail" />
      <rect x="0" y="52" width="96" height="5" rx="2" className="desk" />
      <circle cx="74" cy="22" r="10" className="head" />
      <path d="M58 52 Q58 34 74 34 Q90 34 90 52 Z" className="body" />
      {!dead && avatar === "analyst" && <g className="accessory"><circle cx="70" cy="22" r="3" /><circle cx="78" cy="22" r="3" /><path d="M73 22 h2" /></g>}
      {!dead && avatar === "researcher" && <rect x="80" y="40" width="9" height="11" rx="1" className="accessory-fill" />}
      {!dead && avatar === "strategist" && <path d="M74 38 l3 3 -3 3 -3 -3 Z" className="accessory-fill" />}
      {dead && <path d="M69 18 l4 4 m0 -4 l-4 4 M76 18 l4 4 m0 -4 l-4 4" className="accessory" />}
      {!dead && mode === "tv" && <g className="tv-bubble"><rect x="60" y="0" width="28" height="9" rx="2" /><path d="M72 9 l2 3 2 -3" /><text x="74" y="7">!</text></g>}
      {!dead && mode === "coffee" && <g className="coffee"><rect x="86" y="44" width="7" height="8" rx="1" /><path d="M93 46 q3 1 0 4" /><path className="steam" d="M88 41 q-2 -3 0 -6 M91 41 q-2 -3 0 -6" /></g>}
    </svg>
  );
}

/** `tv`: full-screen broadcast view (no controls), used by /tv for streaming. */
export function AgentFloor({ connected, revision, tv = false }: { connected: boolean; revision: number; tv?: boolean }) {
  const [local, setLocal] = useState(0);
  const floor = useFloor(connected, revision + local);
  const news = useNews(connected);
  if (!connected) return null;
  if (floor.loading) return <div className="loading-state" role="status">Abrindo o escritório…</div>;
  if (floor.error) return <div className="notice error-text" role="alert">{floor.error}</div>;
  const paper = floor.paper ?? {};
  const agents = paper.agents ?? [], assets = paper.assets ?? [], vitals = paper.paper_agent_vitals ?? [];
  const account = paper.paper_accounts?.[0];
  if (!agents.length) return (
    <section className="panel empty-floor">
      <h2>O escritório está vazio.</h2>
      <p>Cadastre um ativo em Mercado e contrate o primeiro agente. Cada agente ganha uma estação aqui.</p>
      <Link className="text-link" href="/app/agents">Contratar agente <ArrowRight size={14} /></Link>
    </section>
  );
  const vitalOf = (id: unknown) => vitals.find((v) => v.agent_id === id);
  const pnlOf = (v: Row | undefined) => v ? Number(v.realized_pnl) + Number(v.unrealized_pnl) : null;
  const alive = agents.filter((a) => !["DEAD", "FIRED"].includes(text(a.status)));
  const totalPnl = vitals.reduce((sum, v) => sum + (pnlOf(v) ?? 0), 0);
  return (
    <>
      <div className="company-strip">
        <div><span>Capital virtual</span><strong>{account ? formatBrl(account.cash) : "—"}</strong><small>{account ? `Início ${formatBrl(account.initial_cash)}` : "Crie a carteira em Simulação"}</small></div>
        <div><span>Resultado virtual dos agentes</span><strong className={totalPnl > 0 ? "up" : totalPnl < 0 ? "down" : ""}>{vitals.length ? formatBrl(totalPnl.toFixed(2)) : "—"}</strong><small>Realizado + posição marcada na última cotação</small></div>
        <div><span>Equipe</span><strong>{alive.length}<em> / {agents.length}</em></strong><small>{agents.length - alive.length ? `${agents.length - alive.length} eliminado(s)` : "Nenhum eliminado"}</small></div>
        <div><span>Piloto automático</span><strong className={account?.autopilot ? "up" : ""}>{account?.autopilot ? "Ligado" : "Desligado"}</strong>
          <small>{account ? `Morte ao perder ${text(account.agent_max_loss_pct)}% do orçamento` : "Simulação não criada"}</small></div>
      </div>
      <Telao account={account} totalPnl={totalPnl} />
      <NewsTv items={news.items} error={news.error} team={alive.map((a) => ({ name: text(a.name), ticker: text(assets.find((x) => x.id === a.asset_id)?.ticker) }))} />
      {!tv && <FleetAutopilot agents={agents} onChange={() => setLocal((n) => n + 1)} />}
      {!tv && <section className="panel ranking-panel">
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
            // Living agents first, then by virtual result; unmeasured agents last.
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
      </section>}
      {!tv && <Gestora agents={agents.map((agent) => ({ id: text(agent.id), name: text(agent.name), ticker: text(assets.find((a) => a.id === agent.asset_id)?.ticker),
        budget: Number(agent.budget), pnl: pnlOf(vitalOf(agent.id)), dead: ["DEAD", "FIRED"].includes(text(agent.status)),
        sells: (paper.paper_fills ?? []).filter((f) => f.agent_id === agent.id && f.side === "SELL").length }))}
        maxLossPct={Number(account?.agent_max_loss_pct ?? 20)} onApplied={() => setLocal((n) => n + 1)} />}
      <div className={`floor-grid ${tv ? "tv-floor" : ""}`}>
        {agents.map((agent) => {
          const status = text(agent.status), vital = vitalOf(agent.id), pnl = pnlOf(vital);
          const life = vital ? Number(vital.life_pct) : null;
          const dead = status === "DEAD" || status === "FIRED";
          const decision = floor.decisions.find((d) => d.agent_id === agent.id);
          const ticker = text(assets.find((a) => a.id === agent.asset_id)?.ticker);
          const headline = recentHeadline(news.items, ticker);
          const holding = (paper.paper_positions ?? []).some((p) => p.agent_id === agent.id && Number(p.quantity) > 0);
          const mode = dead ? null : headline ? "tv" : !WORKING.has(status) && !holding ? "coffee" : null;
          return (
            <Link key={text(agent.id)} href={`/app/agents/${text(agent.id)}`} className={`floor-station ${dead ? "is-dead" : ""}`}>
              <div className="station-top">
                <span className="ticker-chip">{ticker}</span>
                <span className={`status-label ${dead ? "danger" : WORKING.has(status) ? "success" : status === "PAUSED" ? "warning" : ""}`} title={status}>
                  {dead && <Skull size={11} />} {statusLabel(status)}
                </span>
              </div>
              <Character avatar={text(agent.avatar)} status={status} trend={pnl} mode={mode} />
              <h3>{text(agent.name)}</h3>
              <div className="life" aria-label={life == null ? "Vida ainda não medida" : `Vida ${life.toFixed(0)}%`}>
                <div className="life-label"><span>Vida</span><span>{life == null ? "sem medição" : `${life.toFixed(0)}%`}</span></div>
                <div className="life-track"><div className={`life-fill ${life != null && life < 35 ? "low" : life != null && life < 70 ? "mid" : ""}`} style={{ width: `${life ?? 0}%` }} /></div>
              </div>
              <dl className="station-facts">
                <div><dt>Orçamento</dt><dd>{formatBrl(agent.budget)}</dd></div>
                <div><dt>Resultado virtual</dt><dd className={pnl == null ? "" : pnl > 0 ? "up" : pnl < 0 ? "down" : ""}>{pnl == null ? "—" : formatBrl(pnl.toFixed(2))}</dd></div>
              </dl>
              {agent.autopilot === false && !dead && <p className="station-context"><span className="status-label warning">Piloto desligado</span> Só você decide por esta IA.</p>}
              {headline ? <p className="station-context" title={headline.item.title}>
                <span className={`status-label ${DIRECTION[headline.tag.direction][1]}`}>Viu na TV: {DIRECTION[headline.tag.direction][0]}</span> {headline.item.title}
              </p> : mode === "coffee" && <p className="station-context">Tomando café: sem posição, esperando um sinal da regra.</p>}
              <ContextChip decision={decision} />
              <p className="station-decision">
                {decision ? <><Zap size={12} /> <strong title={text(decision.decision)}>{statusLabel(text(decision.decision))}</strong> · {ago(decision.created_at)}</> : "Ainda sem análise registrada"}
              </p>
            </Link>
          );
        })}
      </div>
      {!tv && <p className="muted floor-note">Vida e resultado são da <strong>simulação</strong>, medidos a cada análise com cotação atrasada da brapi. Um agente eliminado não pode ser reativado; suas posições virtuais ficam registradas.</p>}
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

/** Latest rule-based context recorded with the agent's analysis. */
function ContextChip({ decision }: { decision: Row | undefined }) {
  const context = contextOf(decision);
  if (!context) return null;
  const [label, tone] = CONTEXT_LABELS[context.action];
  return <p className="station-context" title={context.reasons.map((r) => r.text).join(" · ") || "Sem eventos relevantes"}>
    <span className={`status-label ${tone}`}>{label}</span> {context.reasons[0]?.text ?? "Sem eventos relevantes nas fontes."}
  </p>;
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
