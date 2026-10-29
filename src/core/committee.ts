import type { ContextAction } from "./context";
import type { HealthLevel } from "./company-health";
import { forecastOpinion, type ConsensusView } from "./forecast";
import { entryCheck, entryReason, historyAgrees, RANGE_DEFAULTS, SELLS_NEAR_HIGH } from "./range";
import { minimumSellPrice } from "./live";
import { focusView, valuationView, type FocusTrend, type Valuation } from "./valuation";

/**
 * The council (owner, 27/10/2026: "são 4 analistas... cada analista busca ver um lado diferente...
 * se todos tiverem a mesma decisão e não pensarem por outros lados, podem tomar decisões ruins").
 * Four analysts look at the same stock from opposite sides, with real numbers only:
 * - Otimista: reasons to rise — analysts' target, what followed past visits to the low, healthy books,
 *   a low price for the profit, good dividends, economists expecting lower rates;
 * - Pessimista: what is wrong with the company — its books, a collapse, analysts against, a low that
 *   did not hold before, a loss or a very high price for the profit, heavy debt;
 * - Riscos do mundo: what outside can make it fall — news, dollar, oil, economists expecting higher
 *   rates or inflation (Boletim Focus), and the whole market falling
 *   together (in the 2022 election the team's stocks fell another 24% after the shock,
 *   docs/HISTORIA_CRISES.md);
 * - Realista: the owner's rule (buy near the 6-month low once the fall turned, sell near the high and
 *   never below what was paid with both fees) and the consensus of the other three.
 * Consensus, which the autopilot applies to real orders (owner, 27/10/2026: "o pessimista sempre vai ser
 * pessimista... tem que ser um risco moderado"): only a grave risk vetoes (a collapse, a company in
 * danger, analysts recommending a sale, grave news). Everything else is weighed: each moderate risk
 * the Pessimista or Riscos do mundo finds counts -1, each strong reason the Otimista finds counts +1
 * (at most 2 each side). A score of 0 or more buys the whole amount; -1 half; -2 or less a third,
 * the rest only after a new dip.
 */
export type Vote = "A_FAVOR" | "CONTRA" | "NEUTRO";
export type Role = "Otimista" | "Pessimista" | "Riscos do mundo" | "Realista";
export interface Opinion { role: Role; vote: Vote; text: string }
export type Verdict = "COMPRAR" | "SEGURAR" | "ESPERAR" | "VENDER_NA_ALTA";

export interface AnalystInput {
  /** News, material facts, dollar and oil (core/context), null while unread. */
  context: { action: ContextAction; summary: string } | null;
  health: { level: HealthLevel; reason: string } | null;
  /** Fall from the stored top when the stock collapsed (core/range collapse), else null. */
  collapse?: number | null;
  price: number | null;
  forecast?: ConsensusView | null;
  /** What followed past visits to the 6-month low (null when unknown). */
  history?: { samples: number; upShare: number; average: number } | null;
  /** Team stocks 10%+ below their highest close of the last 20 sessions, of those known. */
  market?: { falling: number; total: number } | null;
  /** Price/earnings, dividends, ROE and debt (Fundamentus), null when unavailable. */
  valuation?: Valuation | null;
  /** Economists' Selic and inflation expectations now and 4 weeks ago (Boletim Focus). */
  macro?: FocusTrend | null;
}
export interface Consensus { veto: string | null; fraction: number; text: string }

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
/** Half the team or more falling 10%+ together: a market-wide shock, not this company's problem. */
export const marketShock = (m: AnalystInput["market"]) => !!m && m.total >= 4 && m.falling * 2 >= m.total;

export function analysts(i: AnalystInput): { optimist: Opinion; pessimist: Opinion; world: Opinion; consensus: Consensus } {
  const forecast = forecastOpinion(i.price, i.forecast ?? null);
  const h = i.history;
  const shock = marketShock(i.market);

  // Otimista: +1 per strong reason to rise.
  const ups: string[] = [];
  if (forecast.upside !== null && forecast.upside >= 0.1) ups.push(`analistas veem ${pct(forecast.upside)} até o preço-alvo`);
  if (h && h.samples >= 3 && historyAgrees(h)) ups.push(`nas ${h.samples} vezes em que chegou perto da mínima, subiu depois em ${Math.round(h.upShare * 100)}%`);
  if (i.health?.level === "SAUDAVEL") ups.push("balanço saudável");
  const numbers = valuationView(i.valuation), outlook = focusView(i.macro);
  ups.push(...numbers.ups);
  if (outlook.up) ups.push(outlook.up);
  const up = Math.min(ups.length, 2);
  // Said, not counted: it comes with every market-wide fall, so it would always cancel that risk.
  if (shock) ups.push("em 6 de 8 crises desde 2002 as ações do time estavam mais altas um ano depois");
  const optimist: Opinion = up >= 2 ? { role: "Otimista", vote: "A_FAVOR", text: `Vejo motivos fortes para subir: ${ups.join("; ")}.` }
    : up === 1 ? { role: "Otimista", vote: "A_FAVOR", text: `Um motivo forte para subir: ${ups.join("; ")}.` }
      : { role: "Otimista", vote: "NEUTRO", text: ups.length ? `Nenhum motivo forte, só que ${ups[0]}.` : "Não encontro motivo forte para subir agora." };

  // Pessimista: a grave problem vetoes; moderate ones count -1 each.
  const grave = i.collapse != null ? `a ação desabou ${Math.round(i.collapse * 100)}% do topo e não voltou`
    : i.health?.level === "PERIGO" ? `empresa em perigo: ${i.health.reason}`
      : forecast.vote === "CONTRA" ? `os analistas recomendam vender: ${forecast.text}` : null;
  const worries: string[] = [];
  if (i.health?.level === "ATENCAO") worries.push(`balanço pede atenção: ${i.health.reason}`);
  if (h && h.samples >= 3 && !historyAgrees(h)) worries.push(`perto da mínima ela subiu depois só em ${Math.round(h.upShare * 100)}% das ${h.samples} vezes`);
  if (forecast.upside !== null && forecast.upside < 0) worries.push(`o preço já passou do alvo dos analistas (${pct(forecast.upside)})`);
  worries.push(...numbers.worries);
  const pessimist: Opinion = grave ? { role: "Pessimista", vote: "CONTRA", text: `Risco grave: ${grave}.` }
    : worries.length ? { role: "Pessimista", vote: "NEUTRO", text: `Risco moderado: ${worries.join("; ")}.` }
      : { role: "Pessimista", vote: "A_FAVOR", text: !i.health || i.health.level === "SEM_DADOS" ? "Procurei problemas e não achei, mas o balanço ainda não foi conferido." : "Procurei problemas na empresa e não achei nada sério." };

  // Riscos do mundo: grave news vetoes; a market-wide fall or a dollar/oil shock counts -1 each.
  const news = i.context && (i.context.action === "EXIT" || i.context.action === "BLOCK_BUY") ? i.context : null;
  const outside: string[] = [];
  if (shock) outside.push(`o mercado inteiro está caindo junto (${i.market!.falling} de ${i.market!.total} ações do time caíram 10% ou mais em 20 pregões; em 2022 caíram mais 24% antes de voltar)`);
  if (i.context?.action === "REDUCE") outside.push(i.context.summary);
  if (outlook.risk) outside.push(outlook.risk);
  const world: Opinion = news ? { role: "Riscos do mundo", vote: "CONTRA", text: `Risco grave: ${news.action === "EXIT" ? "pede para sair" : "segura as compras"}: ${news.summary}` }
    : outside.length ? { role: "Riscos do mundo", vote: "NEUTRO", text: `Risco moderado: ${outside.join("; ")}.` }
      : { role: "Riscos do mundo", vote: i.context ? "A_FAVOR" : "NEUTRO", text: i.context ? "Nenhuma notícia grave, dólar e petróleo sem choque, mercado sem queda geral." : "Ainda sem leitura das notícias, do dólar e do petróleo." };

  const vetoes = [pessimist, world].filter((o) => o.vote === "CONTRA");
  const down = Math.min(worries.length, 2) + Math.min(outside.length, 2);
  const score = up - down;
  const fraction = vetoes.length ? 0 : score >= 0 ? 1 : score === -1 ? 1 / 2 : 1 / 3;
  const tally = `placar ${up ? `+${up}` : "0"} do Otimista, ${down ? `-${down}` : "0"} dos riscos`;
  const consensus: Consensus = vetoes.length
    ? { veto: vetoes.map((v) => `${v.role}: ${v.text}`).join(" "), fraction: 0, text: `não comprar (${vetoes.map((v) => v.role).join(" e ")} ${vetoes.length > 1 ? "veem" : "vê"} risco grave)` }
    : { veto: null, fraction, text: fraction === 1
      ? (down ? `comprar o valor inteiro: os motivos para subir pesam mais que os riscos (${tally})` : "comprar o valor inteiro: ninguém vê risco")
      : `comprar só ${fraction === 0.5 ? "metade" : "um terço"} agora e o resto se cair mais: os riscos pesam mais (${tally})` };
  return { optimist, pessimist, world, consensus };
}

export interface CommitteeInput extends AnalystInput {
  holding: number; averageCost: number | null;
  /** What the boss can release to this agent now (0 when the pot has nothing free). */
  budgetRoom: number;
  /** 6-month levels: lowest/highest close and the buy/sell triggers (null while unknown). */
  range: { low: number; high: number; buyBelow: number; sellAbove: number } | null;
  /** Minimum gain over the average price before selling (fees included), in %. */
  minGainPct: number;
  /** Closes before today (oldest first) to see whether the fall has turned; unknown skips the check. */
  recent?: readonly number[];
}

export function committee(i: CommitteeInput): { opinions: Opinion[]; verdict: Verdict; summary: string } {
  const { optimist, pessimist, world, consensus } = analysts(i);
  const r = i.range, price = i.price;
  // The real order's floor too: both fees paid and 3% net left (core/live minimumSellPrice).
  const floor = i.holding > 0 && i.averageCost
    ? Math.max(i.averageCost * (1 + i.minGainPct / 100), Number(minimumSellPrice(i.averageCost * i.holding, i.holding))) : null;
  const sellNow = SELLS_NEAR_HIGH && r !== null && price !== null && i.holding > 0 && price >= r.sellAbove && floor !== null && price >= floor;
  const zone = r !== null && price !== null && price <= r.buyBelow;
  const badHistory = zone && !historyAgrees(i.history);
  const entry = zone && i.recent?.length ? entryCheck(i.recent, price!, r.low) : null;
  const falling = entry !== null && !entry.ok;
  const average = i.holding > 0 ? i.averageCost : null;
  const rebuyBelow = average && RANGE_DEFAULTS.rebuyBelowAvgPct !== undefined ? average * (1 - RANGE_DEFAULTS.rebuyBelowAvgPct / 100) : null;
  const holdingEnough = zone && rebuyBelow !== null && price! > rebuyBelow;
  const nearLow = zone && !badHistory && !falling && !holdingEnough;
  const canBuy = i.budgetRoom > 0;
  const target = i.forecast?.targetMean ?? null;
  const rule = !r || price === null ? "Ainda calculando a mínima e a máxima de 6 meses."
    : sellNow ? `${brl(price)} chegou perto da máxima de 6 meses (${brl(r.high)}) e paga o que custou com as taxas: hora de vender na alta.`
      : badHistory ? `Perto da mínima, mas nas ${i.history!.samples} vezes anteriores subiu só em ${Math.round(i.history!.upShare * 100)}%: não vale a pena.`
      : zone && falling ? `Perto da mínima de 6 meses (${brl(r.low)}): ${entryReason(entry!, price)}.`
      : holdingEnough ? `Já tem ${i.holding}: compra mais só se cair abaixo de ${brl(rebuyBelow!)} e virar de novo.`
      : nearLow ? (canBuy ? SELLS_NEAR_HIGH ? `${brl(price)} está perto da mínima de 6 meses (${brl(r.low)}) e já virou para cima. Alvo de venda: perto da máxima, a partir de ${brl(r.sellAbove)} (${pct(r.sellAbove / price - 1)}${target ? `; analistas: ${brl(target)}` : ""}). Consenso: ${consensus.text}.` : `${brl(price)} está na faixa de compra (até ${brl(r.buyBelow)}) e já virou para cima: compra para segurar e receber dividendos. Consenso: ${consensus.text}.`
        : `Preço bom (perto da mínima de ${brl(r.low)}), mas o Chefe não tem dinheiro livre para 1 ação.`)
        : i.holding > 0 && !SELLS_NEAR_HIGH ? `Segurando ${i.holding} para receber dividendos (estilo Barsi): só vende em risco grave e nunca com prejuízo. Compra mais enquanto estiver até ${brl(r.buyBelow)}.`
        : i.holding > 0 ? `Segurando até a máxima de 6 meses: vende a partir de ${brl(Math.max(r.sellAbove, floor ?? 0))}${average ? ` (${pct(Math.max(r.sellAbove, floor ?? 0) / average - 1)} sobre o que pagou)` : ""}, quando a alta parar${target ? `; analistas veem ${brl(target)}` : ""}. Os 3% de lucro limpo são só o piso de proteção, não o alvo.`
          : `Caro agora (${brl(price)}). Compra só se cair até ${brl(r.buyBelow)}, perto da mínima de 6 meses (${brl(r.low)}).`;
  const buys = nearLow && canBuy && !consensus.veto;
  const realist: Opinion = { role: "Realista", vote: sellNow ? "NEUTRO" : buys ? "A_FAVOR" : "NEUTRO", text: rule };
  const verdict: Verdict = sellNow ? "VENDER_NA_ALTA" : buys ? "COMPRAR" : i.holding > 0 ? "SEGURAR" : "ESPERAR";
  const summary = verdict === "COMPRAR" ? (consensus.fraction === 1 ? "Decisão: comprar na baixa." : `Decisão: comprar ${consensus.fraction === 0.5 ? "metade" : "um terço"} agora, aos poucos.`)
    : verdict === "VENDER_NA_ALTA" ? "Decisão: vender na alta."
      : nearLow && canBuy && consensus.veto ? `Decisão: ${consensus.text}.`
        : falling ? (entry!.big ? "Decisão: esperar a queda virar para cima." : "Decisão: esperar encostar na mínima.")
        : verdict === "SEGURAR" ? "Decisão: segurar até chegar perto da máxima." : "Decisão: esperar o preço cair.";
  return { opinions: [optimist, pessimist, world, realist], verdict, summary };
}
