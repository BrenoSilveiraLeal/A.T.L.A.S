"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CircleDot, Coffee, Monitor, Users } from "lucide-react";
import { formatBrl } from "@/core/format";
import { minimumSellPrice } from "@/core/live";
import type { OfficeZone } from "@/core/office";
import type { NewsDirection } from "@/core/news";
import type { Opinion, Verdict } from "@/core/committee";
import { HEALTH_LABELS, type HealthLevel } from "@/core/company-health";

export interface OfficeAgent {
  id: string; name: string; ticker: string; company: string; zone: OfficeZone; activity: string;
  pnl: number | null; life: number | null; budget: number; holding: number; maxLoss: number;
  /** What the real position cost at Genial, fees included (0 without position). */
  paidTotal: number;
  headline: { title: string; url: string; direction: NewsDirection } | null; nextAnalysisAt: string | null;
  /** Daily candles of the stock (oldest first) and the latest price seen by the agent. */
  chart?: AgentChart;
  /** Company health from the annual statements and the meeting-room committee. */
  health?: { level: HealthLevel; reason: string } | null;
  debate?: { opinions: Opinion[]; verdict: Verdict; summary: string };
  /** Real history (trades at Genial, orders, decisions), newest first. */
  events?: { at: string; text: string; tone: "up" | "down" | "info" }[];
}
export interface AgentChart { bars: { open: number; high: number; low: number; close: number }[]; last: number | null }

const W = 1600, H = 850;
const at = (x: number, y: number) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });
// Desk agents stand behind the desk front (drawn on top), so they look seated.
const DESKS: [number, number][] = [[190, 255], [450, 255], [710, 255], [190, 460], [450, 460], [710, 460]];
const SLOTS: Record<OfficeZone, [number, number][]> = {
  DESK: [...DESKS.map(([x, y]): [number, number] => [x, y - 4]), [320, 355], [580, 355]],
  MEETING: [[1060, 420], [1400, 420], [1150, 490], [1310, 490], [1230, 470], [1000, 470], [1460, 470]],
  COFFEE: [[225, 800], [405, 800], [565, 800], [315, 805], [485, 805]],
  POOL: [[730, 790], [1110, 790], [850, 825], [990, 825]],
  OUT: [[225, 800], [405, 800], [565, 800], [315, 805], [485, 805]],
};
const hue = (id: string) => [...id].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5) % 360;
const money = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${formatBrl(Math.abs(v).toFixed(2))}`);
const tone = (v: number | null) => (v === null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "gain" : "loss");
const inMinutes = (iso: string | null, now: number) => {
  if (!iso) return "—";
  const m = Math.round((Date.parse(iso) - now) / 60000);
  return m <= 0 ? "a qualquer momento" : m < 60 ? `em ${m} min` : `em ${Math.round(m / 60)} h`;
};

/** Ticks every 30 s so positions, countdowns and the market clock stay live. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export function Scoreboard({ initial, pnl, cdiPct, marketOpen, marketNote, alive, total }: {
  initial: number | null; pnl: number; cdiPct: number | null; marketOpen: boolean; marketNote: string; alive: number; total: number;
}) {
  const state = tone(pnl);
  const cdiMoney = initial !== null && cdiPct !== null ? (initial * cdiPct) / 100 : null;
  const ahead = cdiMoney === null ? null : pnl > cdiMoney;
  return (
    <section className="score" aria-label="Placar da equipe">
      <div className={`score-main ${state}`}>
        <span className="score-kicker">Resultado real na Genial</span>
        <strong className="score-verdict">{state === "gain" ? "Ganhando dinheiro" : state === "loss" ? "Perdendo dinheiro" : "Empatada"}</strong>
        <span className="score-value">{money(pnl)}</span>
        <small>{initial !== null ? `Você depositou ${formatBrl(initial.toFixed(2))} · agora vale ${formatBrl((initial + pnl).toFixed(2))}` : "Crie a carteira virtual em Simulação."}</small>
      </div>
      <div className="score-side">
        <span className="score-kicker">E se o dinheiro ficasse parado no CDI?</span>
        <strong className={cdiMoney === null ? "" : "gain"}>{cdiMoney === null ? "—" : money(cdiMoney)}</strong>
        {ahead !== null && <span className={`score-chip ${ahead ? "gain" : "loss"}`}>{ahead ? "As IAs estão vencendo o CDI" : "O CDI está na frente das IAs"}</span>}
      </div>
      <div className="score-side">
        <span className="score-kicker">Agora</span>
        <strong className={marketOpen ? "gain" : ""}><span className={`pulse ${marketOpen ? "on" : ""}`} aria-hidden="true" />{marketOpen ? "Bolsa aberta" : "Bolsa fechada"}</strong>
        <small>{marketNote}</small>
        <small>{alive} de {total} IAs trabalhando{total - alive ? ` · ${total - alive} eliminada(s)` : ""}</small>
      </div>
    </section>
  );
}

export function OfficeLegend() {
  return (
    <ul className="office-legend" aria-label="O que cada lugar significa">
      <li><Monitor size={15} /> <b>Computador</b> = trabalhando</li>
      <li><Users size={15} /> <b>Reunião</b> = debatendo com os especialistas</li>
      <li><Coffee size={15} /> <b>Copa</b> e <CircleDot size={15} /> <b>Sala de TV</b> = descansando</li>
      <li>Camisa <span className="dot risk" /> Risco · <span className="dot balance" /> Balanço · <span className="dot strategy" /> Estratégia</li>
      <li><span className="dot gain" /> verde sobe · <span className="dot loss" /> vermelho cai</li>
    </ul>
  );
}

function Robot({ id, zone }: { id: string; zone: OfficeZone }) {
  const h = hue(id);
  return (
    <svg viewBox="0 0 64 76" className="robot" aria-hidden="true" style={{ ["--h" as string]: h }}>
      <line x1="32" y1="5" x2="32" y2="13" className="robot-antenna" />
      <circle cx="32" cy="5" r="3.2" className="robot-light" />
      <rect x="13" y="13" width="38" height="27" rx="11" className="robot-head" />
      <rect x="18" y="20" width="28" height="11" rx="5.5" className="robot-visor" />
      <circle cx="26" cy="25.5" r="2.3" className="robot-eye" /><circle cx="38" cy="25.5" r="2.3" className="robot-eye" />
      <rect x="18" y="42" width="28" height="24" rx="9" className="robot-body" />
      <rect x="25" y="49" width="14" height="5" rx="2.5" className="robot-chest" />
      <rect x="8" y="44" width="8" height="18" rx="4" className="robot-arm arm-left" />
      <rect x="48" y="44" width="8" height="18" rx="4" className="robot-arm arm-right" />
      {zone === "COFFEE" && <g className="prop-coffee"><rect x="52" y="50" width="9" height="10" rx="2" /><path d="M61 52 q4 2 0 6" /><path className="steam" d="M54 46 q-2 -4 0 -8 M58 46 q-2 -4 0 -8" /></g>}
      {zone === "POOL" && <line x1="2" y1="70" x2="58" y2="40" className="prop-cue" />}
      {zone === "MEETING" && <g className="prop-talk"><rect x="40" y="0" width="22" height="12" rx="5" /><circle cx="46" cy="6" r="1.4" /><circle cx="51" cy="6" r="1.4" /><circle cx="56" cy="6" r="1.4" /></g>}
    </svg>
  );
}

function Room({ x, y, w, h, title, note, icon }: { x: number; y: number; w: number; h: number; title: string; note: string; icon: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="22" className="room" />
      <text x={x + 24} y={y + 40} className="room-title">{icon} {title} <tspan className="room-note">· {note}</tspan></text>
    </g>
  );
}

export function OfficeMap({ agents, tvHeadline, selected, onSelect }: {
  agents: OfficeAgent[]; tvHeadline: { title: string; source: string } | null; selected: string | null; onSelect: (id: string) => void;
}) {
  const used: Partial<Record<OfficeZone, number>> = {};
  const placed = agents.map((agent) => {
    const index = used[agent.zone] ?? 0;
    used[agent.zone] = index + 1;
    const slots = SLOTS[agent.zone];
    const [x, y] = slots[index % slots.length];
    // Wrap extra agents with a small offset instead of stacking them.
    const wrap = Math.floor(index / slots.length);
    return { agent, x: x + wrap * 34, y: y + wrap * 18 };
  });
  return (
    <div className="office-map">
      <svg className="office-floor" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" className="grid-line" /></pattern>
          <radialGradient id="glow" cx="50%" cy="0%" r="90%"><stop offset="0%" stopColor="rgba(94,231,255,0.16)" /><stop offset="100%" stopColor="rgba(94,231,255,0)" /></radialGradient>
        </defs>
        <rect width={W} height={H} rx="28" className="floor" />
        <rect width={W} height={H} rx="28" fill="url(#grid)" />
        <rect width={W} height={H} rx="28" fill="url(#glow)" />
        <Room x={30} y={30} w={840} h={490} icon="▣" title="COMPUTADORES" note="trabalhando" />
        <Room x={900} y={30} w={670} h={470} icon="◎" title="REUNIÃO" note="analisando" />
        <Room x={30} y={550} w={590} h={280} icon="☕" title="CAFÉ" note="descansando" />
        <Room x={650} y={550} w={540} h={280} icon="●" title="SINUCA" note="descansando" />
        <ellipse cx="1230" cy="370" rx="150" ry="62" className="table" />
        <ellipse cx="1230" cy="370" rx="118" ry="42" className="table-glow" />
        <rect x="70" y="620" width="70" height="110" rx="10" className="machine" />
        <rect x="84" y="640" width="42" height="26" rx="4" className="machine-screen" />
        <rect x="180" y="735" width="420" height="16" rx="8" className="counter" />
        <rect x="800" y="660" width="240" height="120" rx="22" className="pool-rail" />
        <rect x="816" y="674" width="208" height="92" rx="14" className="pool-felt" />
        {[[818, 676], [920, 672], [1022, 676], [818, 764], [920, 768], [1022, 764]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="7" className="pocket" />)}
        <circle cx="900" cy="715" r="6" className="ball" /><circle cx="955" cy="725" r="6" className="ball b2" /><circle cx="870" cy="735" r="6" className="ball b3" />
      </svg>
      <div className="office-tv" style={{ ...at(990, 85), width: `${(480 / W) * 100}%`, height: `${(150 / H) * 100}%` }}>
        <span className="office-tv-live"><span className="pulse on" aria-hidden="true" /> TV · notícias</span>
        <p>{tvHeadline ? <><b>{tvHeadline.source}:</b> {tvHeadline.title}</> : "Sem manchete nova agora."}</p>
      </div>
      {placed.map(({ agent, x, y }) => (
        <button key={agent.id} type="button" className={`office-agent zone-${agent.zone.toLowerCase()} ${tone(agent.pnl)} ${selected === agent.id ? "selected" : ""}`}
          style={at(x, y)} onClick={() => onSelect(agent.id)} aria-pressed={selected === agent.id}
          aria-label={`${agent.name}, ${agent.company}. ${agent.activity} Resultado ${money(agent.pnl)}.`}>
          <span className={`agent-money ${tone(agent.pnl)}`}>{money(agent.pnl)}</span>
          <Robot id={agent.id} zone={agent.zone} />
          <span className="agent-tag">{agent.name} · {agent.ticker}</span>
        </button>
      ))}
      <svg className="office-front" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {DESKS.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <rect x={x - 82} y={y - 2} width="164" height="40" rx="10" className="desk" />
            <rect x={x - 76} y={y - 46} width="44" height="30" rx="4" className="screen" />
            <path d={`M${x - 72} ${y - 24} l8 -6 l8 4 l8 -10 l10 4`} className="screen-line" />
            <rect x={x + 32} y={y - 46} width="44" height="30" rx="4" className="screen" />
            <path d={`M${x + 36} ${y - 30} h12 m4 0 h14 M${x + 36} ${y - 24} h20`} className="screen-line" />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Plain-language card for the selected agent. */
export function AgentCard({ agent, now, onSelect }: { agent: OfficeAgent | null; now: number; onSelect: (id: string) => void }) {
  // The team list lives below the office; the card only opens for a chosen agent.
  if (!agent) return null;
  const state = tone(agent.pnl);
  return (
    <aside className="agent-card" aria-live="polite">
      <span className="score-kicker">{agent.ticker} · {agent.company}</span>
      <h3>{agent.name}</h3>
      <p className="agent-activity">{agent.activity}</p>
      <div className={`agent-result ${state}`}>
        <span>{agent.zone === "OUT" ? "Resultado final" : state === "gain" ? "Está ganhando" : state === "loss" ? "Está perdendo" : "Ainda sem ganho ou perda"}</span>
        <strong>{money(agent.pnl)}</strong>
      </div>
      {agent.health && <p className={`health-chip ${agent.health.level.toLowerCase()}`} title={agent.health.reason}>
        <b>{HEALTH_LABELS[agent.health.level]}</b> {agent.health.reason}</p>}
      {agent.debate && <div className="committee">
        <span className="score-kicker">Reunião com os especialistas</span>
        <ul>{agent.debate.opinions.map((o) => <li key={o.role} className={`vote ${o.vote.toLowerCase()}`}><b>{o.role}</b> {o.text}</li>)}</ul>
        <strong>{agent.debate.summary}</strong>
      </div>}
      <dl className="agent-facts">
        <div><dt>Ações na Genial</dt><dd>{agent.holding}{agent.holding > 0 ? ` a ${formatBrl((agent.paidTotal / agent.holding).toFixed(2))}` : ""}</dd></div>
        <div><dt>Dinheiro dela</dt><dd>{formatBrl(Math.max(0, agent.budget - agent.paidTotal).toFixed(2))}</dd></div>
        <div><dt>Próxima análise</dt><dd>{inMinutes(agent.nextAnalysisAt, now)}</dd></div>
      </dl>
      <div className="agent-history">
        <span className="score-kicker">Histórico real</span>
        {agent.events?.length ? <ul>{agent.events.map((e, i) => <li key={`${e.at}-${i}`} className={e.tone}>
          <small>{new Date(e.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</small> {e.text}</li>)}</ul>
          : <p className="muted">Ainda nada: nenhuma compra, venda ou ordem com dinheiro real.</p>}
      </div>
      {agent.zone !== "OUT" && <AgentPlan agent={agent} />}
      {agent.headline && <p className="agent-news">
        <span className={`status-label ${agent.headline.direction === "UP" ? "success" : agent.headline.direction === "DOWN" ? "danger" : "warning"}`}>
          {agent.headline.direction === "UP" ? "Notícia boa" : agent.headline.direction === "DOWN" ? "Notícia ruim" : "Notícia para ficar de olho"}</span>{" "}
        <a href={agent.headline.url} target="_blank" rel="noopener noreferrer">{agent.headline.title}</a>
      </p>}
      <div className="agent-card-actions">
        <Link className="text-link" href={`/app/agents/${agent.id}`}>Ficha completa <ArrowRight size={14} /></Link>
        <button type="button" className="secondary" onClick={() => onSelect("")}>Ver equipe</button>
      </div>
    </aside>
  );
}

/**
 * The agent's plan in plain words (owner's rule): every share of the monthly contribution buys
 * more shares once it reaches R$ 40; it sells everything only after +60% over the average price
 * and an 8% turn from the top, never below what it paid.
 */
function AgentPlan({ agent }: { agent: OfficeAgent }) {
  if (agent.holding > 0) {
    const average = agent.paidTotal / agent.holding;
    const target = Math.max(average * 1.6, Number(minimumSellPrice(agent.paidTotal, agent.holding)));
    return (
      <div className="agent-plan">
        <span className="score-kicker">Plano: comprar na baixa, vender na alta</span>
        <p>Tem <b>{agent.holding} ações</b> a <b>{formatBrl(average.toFixed(2))}</b> em média. Cada depósito novo compra mais: quando a ação cai, o mesmo dinheiro compra mais ações e o preço médio baixa.
          <b> Vende tudo</b> só depois de passar de <b>{formatBrl(target.toFixed(2))}</b> (+60%) e começar a cair 8% do topo. Nunca vende no prejuízo.</p>
      </div>
    );
  }
  return (
    <div className="agent-plan">
      <span className="score-kicker">Plano: comprar na baixa, vender na alta</span>
      <p>{agent.budget > 0 ? <>Tem <b>{formatBrl(agent.budget.toFixed(2))}</b> de dinheiro real e <b>compra assim que o preço de 1 ação couber</b> (corretagem R$ 0,99).</> : <>Ainda sem dinheiro: recebe quando você registrar um depósito para ela.</>} Depois segura nas quedas e vende só com +60% de lucro. Notícia ruim adia a compra.</p>
    </div>
  );
}
