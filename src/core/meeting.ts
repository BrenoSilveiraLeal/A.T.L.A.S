import { entryCheck, entryReason, historyAgrees, RANGE_DEFAULTS } from "./range";
import { forecastOpinion, type ConsensusView } from "./forecast";
import { opportunityScore } from "./boss";
import { B3_CALENDAR, saoPauloClock } from "./b3-calendar";

/**
 * End-of-day team meeting (owner, 26/10/2026: "no final do dia todas as IAs se reúnem e debatem
 * sobre as compras, as vendas, o que esperam, o que preveem... para que o ATLAS tome cada vez
 * melhores decisões"). Pure: from real numbers (Genial positions, B3 closes, analysts' consensus)
 * each agent gives its view, the team checks how the buying rule did on the last sessions, and
 * suggestions for the owner come out. The rule is never changed here: money is real, so any change
 * is the owner's decision.
 */
export interface MeetingAgent {
  agentId: string; name: string; ticker: string;
  /** Price now and the closes of the last sessions (oldest first, without today). */
  price: number; closes: readonly number[];
  holding: number; cost: number;
  range: { low: number; high: number; buyBelow: number; sellAbove: number } | null;
  history: { samples: number; upShare: number; average: number } | null;
  consensus: ConsensusView | null;
}
export interface MeetingTeam {
  deposited: number; free: number;
  /** The day's work, for the supervisor: analyses done, real purchases and sales. */
  analyses?: number; buys?: number; sells?: number;
}
export interface Minutes {
  day: string;
  lines: { agentId: string; name: string; ticker: string; text: string }[];
  summary: string[];
  lessons: string[];
  suggestions: string[];
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1).replace(".", ",")}%`;

/** A B3 trading day after the close (from 17:10 São Paulo): the time of the meeting. */
export function meetingDue(at: Date) {
  const clock = saoPauloClock(at);
  const tradingDay = !["Sat", "Sun"].includes(clock.weekday) && !B3_CALENDAR[clock.year]?.closed[clock.date];
  return { due: tradingDay && clock.time >= "17:10", day: clock.date, live: tradingDay && clock.time >= "17:10" && clock.time < "17:40" };
}

function opinion(a: MeetingAgent): string {
  const r = a.range, head = `${a.ticker} fechou em ${brl(a.price)}`;
  const last = a.closes.at(-1);
  const today = last ? ` (${pct(a.price / last - 1)} hoje)` : "";
  if (!r) return `${head}${today}. Ainda sem histórico suficiente para a regra.`;
  const forecast = forecastOpinion(a.price, a.consensus);
  const analysts = forecast.upside !== null ? ` Analistas: alvo ${pct(forecast.upside)}.` : "";
  if (a.holding > 0) {
    const average = a.cost / a.holding, result = a.price / average - 1;
    const sellFrom = Math.max(r.sellAbove, average * (1 + RANGE_DEFAULTS.minGainPct / 100));
    return `${head}${today}. Tenho ${a.holding} na Genial, preço médio ${brl(average)} (${pct(result)}). Vendo a partir de ${brl(sellFrom)}, perto da máxima de 6 meses (${brl(r.high)}).${analysts}`;
  }
  if (a.history && !historyAgrees(a.history))
    return `${head}${today}. Nas ${a.history.samples} vezes em que chegou à mínima, só subiu depois em ${Math.round(a.history.upShare * 100)}%: não vale comprar.${analysts}`;
  if (a.price <= r.buyBelow) {
    const e = entryCheck(a.closes, a.price, r.low);
    return e.ok
      ? `${head}${today}. Está na faixa de compra e na hora certa${e.big ? " (virou para cima depois da queda)" : " (encostado na mínima)"}: se o Chefe liberar, compro amanhã.${analysts}`
      : `${head}${today}. ${capitalize(entryReason(e, a.price))}.${analysts}`;
  }
  return `${head}${today}. Ainda ${pct(a.price / r.buyBelow - 1)} acima da faixa de compra (até ${brl(r.buyBelow)}). Sem pressa.${analysts}`;
}

/**
 * The boss chairs the meeting (owner, 26/10/2026: "o chefe participa para avaliar o desempenho de
 * cada funcionário"): opens with who gets the money first, then evaluates each agent from its
 * real position; the supervisor reports the day's work.
 */
function bossLines(agents: readonly MeetingAgent[]) {
  const ready = agents.filter((a) => a.range && a.holding === 0 && historyAgrees(a.history) && a.price <= a.range.buyBelow)
    .map((a) => ({ a, ok: entryCheck(a.closes, a.price, a.range!.low).ok, score: opportunityScore(a.price, a.range!.low, a.range!.high, false, forecastOpinion(a.price, a.consensus).upside) }))
    .sort((x, y) => Number(y.ok) - Number(x.ok) || x.score - y.score);
  const opening = ready.length
    ? `Prioridade do caixa amanhã: ${ready.slice(0, 3).map((r, i) => `${i + 1}º ${r.a.ticker}${r.ok ? "" : " (se virar)"}`).join(", ")}. O dinheiro vai primeiro para quem estiver na hora certa.`
    : "Nenhuma ação na faixa de compra: o caixa fica guardado até aparecer uma boa oportunidade.";
  const evaluations = agents.map((a) => {
    if (a.holding > 0) {
      const result = a.price / (a.cost / a.holding) - 1;
      return `${a.name}: posição ${pct(result)}. ${result >= 0 ? "Bom trabalho, segure até perto da máxima." : "Sem pânico: só vendemos com lucro."}`;
    }
    if (a.history && !historyAgrees(a.history)) return `${a.name}: a ${a.ticker} quase nunca sobe depois da mínima; estou avaliando trocar essa ação.`;
    if (a.range && a.price <= a.range.buyBelow) return `${a.name}: ${a.ticker} está na faixa; fique atento à virada.`;
    return null;
  }).filter((x): x is string => x !== null);
  return { opening, evaluations };
}

export function meetingMinutes(day: string, agents: readonly MeetingAgent[], team: MeetingTeam): Minutes {
  const boss = bossLines(agents);
  const lines = [
    { agentId: "BOSS", name: "Chefe", ticker: "", text: boss.opening },
    ...agents.map((a) => ({ agentId: a.agentId, name: a.name, ticker: a.ticker, text: opinion(a) })),
    ...(team.analyses !== undefined ? [{ agentId: "SUPERVISOR", name: "Supervisora", ticker: "",
      text: `Hoje: ${team.analyses} análises, ${team.buys ?? 0} compra(s) e ${team.sells ?? 0} venda(s) na Genial. Equipe completa: ${agents.length} IAs.` }] : []),
    ...boss.evaluations.slice(0, 6).map((text) => ({ agentId: "BOSS", name: "Chefe", ticker: "", text })),
  ];
  const held = agents.filter((a) => a.holding > 0);
  const invested = held.reduce((s, a) => s + a.cost, 0), value = held.reduce((s, a) => s + a.holding * a.price, 0);
  const inZone = agents.filter((a) => a.range && a.price <= a.range.buyBelow && a.holding === 0 && historyAgrees(a.history));
  const turned = inZone.filter((a) => entryCheck(a.closes, a.price, a.range!.low).ok);
  const summary = [
    `Caixa na Genial: ${brl(team.free)} livres de ${brl(team.deposited)} depositados.`,
    held.length ? `Ações em carteira: ${held.map((a) => `${a.holding} ${a.ticker}`).join(", ")} · custo ${brl(invested)}, valem ${brl(value)} (${pct(invested ? value / invested - 1 : 0)}).` : "Nenhuma ação em carteira ainda.",
    inZone.length ? `Na faixa de compra: ${inZone.map((a) => a.ticker).join(", ")}${turned.length ? `; na hora certa de comprar: ${turned.map((a) => a.ticker).join(", ")}` : "; nenhuma na hora certa ainda"}.` : "Nenhuma ação na faixa de compra hoje.",
  ];
  // How the rule did: buying at the first touch of the buy zone in the last 10 sessions vs today.
  const touches = agents.flatMap((a) => {
    // Only stocks the rule would buy (history near the low agrees).
    if (!a.range || !historyAgrees(a.history)) return [];
    const recent = a.closes.slice(-10), k = recent.findIndex((c) => c <= a.range!.buyBelow);
    return k >= 0 ? [{ ticker: a.ticker, change: a.price / recent[k] - 1 }] : [];
  });
  const lessons: string[] = [];
  if (touches.length) {
    const average = touches.reduce((s, t) => s + t.change, 0) / touches.length;
    const detail = touches.map((t) => `${t.ticker} ${pct(t.change)}`).join(", ");
    lessons.push(average < -0.01
      ? `Quem comprasse no primeiro toque da faixa de compra estaria hoje com ${pct(average)} em média (${detail}). Esperar a virada evitou essa perda.`
      : average > 0.01
        ? `Comprar no primeiro toque da faixa teria rendido ${pct(average)} em média (${detail}). A regra da virada deixou essa alta passar: vale acompanhar se isso se repete.`
        : `Desde que entraram na faixa de compra, os preços ficaram parecidos (${detail}): esperar a virada não custou nada.`);
  } else lessons.push("Nenhuma ação entrou na faixa de compra nos últimos 10 pregões.");
  const suggestions: string[] = [];
  for (const a of agents) {
    if (a.history && !historyAgrees(a.history))
      suggestions.push(`${a.name} (${a.ticker}) quase não sobe depois da mínima (${Math.round(a.history.upShare * 100)}% das vezes): avaliar trocar por outra ação.`);
    if (forecastOpinion(a.price, a.consensus).vote === "CONTRA") suggestions.push(`Analistas contra ${a.ticker}: o conselho vai vetar compras enquanto isso durar.`);
  }
  if (team.free > 0 && !turned.length) suggestions.push(`${brl(team.free)} parados no caixa: normal enquanto as ações ainda caem; a regra espera a virada para comprar.`);
  return { day, lines, summary, lessons, suggestions };
}
