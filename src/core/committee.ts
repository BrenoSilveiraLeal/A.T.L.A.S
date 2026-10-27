import type { ContextAction } from "./context";
import type { HealthLevel } from "./company-health";
import { forecastOpinion, type ConsensusView } from "./forecast";
import { entryCheck, entryReason, historyAgrees, RANGE_DEFAULTS } from "./range";
import { minimumSellPrice } from "./live";

/**
 * The council (owner, 27/10/2026: "são 4 analistas... cada analista busca ver um lado diferente...
 * se todos tiverem a mesma decisão e não pensarem por outros lados, podem tomar decisões ruins").
 * Four analysts look at the same stock from opposite sides, with real numbers only:
 * - Otimista: reasons to rise — analysts' target, what followed past visits to the low, healthy books;
 * - Pessimista: what is wrong with the company — its books, a collapse, analysts against, a low that
 *   did not hold before;
 * - Riscos do mundo: what outside can make it fall — news, dollar, oil, and the whole market falling
 *   together (in the 2022 election the team's stocks fell another 24% after the shock,
 *   docs/HISTORIA_CRISES.md);
 * - Realista: the owner's rule (buy near the 6-month low once the fall turned, sell near the high and
 *   never below what was paid with both fees) and the consensus of the other three.
 * Consensus, which the autopilot applies to real orders: a "contra" from the Pessimista or Riscos do
 * mundo vetoes a purchase; each of them asking for caution cuts it (half, a third when both do, or
 * when one does and the Otimista finds nothing in favour), so in doubt the agent buys in parts and the
 * rule buys more only after a new dip.
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
}
export interface Consensus { veto: string | null; fraction: number; text: string }

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
/** Half the team or more falling 10%+ together: a market-wide shock, not this company's problem. */
export const marketShock = (m: AnalystInput["market"]) => !!m && m.total >= 4 && m.falling * 2 >= m.total;

export function analysts(i: AnalystInput): { optimist: Opinion; pessimist: Opinion; world: Opinion; consensus: Consensus } {
  const forecast = forecastOpinion(i.price, i.forecast ?? null);
  const h = i.history;
  const goodHistory = !!h && h.samples >= 3 && historyAgrees(h);

  const ups: string[] = [];
  if (forecast.upside !== null && forecast.upside >= 0.1) ups.push(`analistas veem ${pct(forecast.upside)} até o preço-alvo`);
  if (goodHistory) ups.push(`nas ${h!.samples} vezes em que chegou perto da mínima, subiu depois em ${Math.round(h!.upShare * 100)}%`);
  if (i.health?.level === "SAUDAVEL") ups.push("balanço saudável");
  if (marketShock(i.market)) ups.push("em 6 de 8 crises desde 2002 as ações do time estavam mais altas um ano depois");
  const optimist: Opinion = ups.length >= 2 || (ups.length === 1 && forecast.upside !== null && forecast.upside >= 0.2)
    ? { role: "Otimista", vote: "A_FAVOR", text: `Vejo motivos para subir: ${ups.join("; ")}.` }
    : { role: "Otimista", vote: "NEUTRO", text: ups.length ? `Algum motivo para subir (${ups.join("; ")}), mas pouco.` : "Não encontro motivo forte para subir agora." };

  const pessimist: Opinion = i.collapse != null
    ? { role: "Pessimista", vote: "CONTRA", text: `A ação desabou ${Math.round(i.collapse * 100)}% do topo e não voltou: pode ser problema sério da empresa.` }
    : i.health?.level === "PERIGO" ? { role: "Pessimista", vote: "CONTRA", text: `Empresa em perigo: ${i.health.reason}` }
      : forecast.vote === "CONTRA" ? { role: "Pessimista", vote: "CONTRA", text: `Os analistas estão contra: ${forecast.text}` }
        : i.health?.level === "ATENCAO" ? { role: "Pessimista", vote: "NEUTRO", text: `Cautela com o balanço: ${i.health.reason}` }
          : h && h.samples >= 3 && !historyAgrees(h) ? { role: "Pessimista", vote: "NEUTRO", text: `Perto da mínima ela nem sempre voltou: subiu só em ${Math.round(h.upShare * 100)}% das ${h.samples} vezes.` }
            : forecast.upside !== null && forecast.upside < 0 ? { role: "Pessimista", vote: "NEUTRO", text: `O preço já passou do alvo dos analistas (${pct(forecast.upside)}).` }
              : { role: "Pessimista", vote: "A_FAVOR", text: !i.health || i.health.level === "SEM_DADOS" ? "Procurei problemas e não achei, mas o balanço ainda não foi conferido." : "Procurei problemas na empresa e não achei nada grave." };

  const shock = marketShock(i.market);
  const world: Opinion = i.context && (i.context.action === "EXIT" || i.context.action === "BLOCK_BUY")
    ? { role: "Riscos do mundo", vote: "CONTRA", text: `${i.context.action === "EXIT" ? "Pede para sair" : "Segura as compras"}: ${i.context.summary}` }
    : shock ? { role: "Riscos do mundo", vote: "NEUTRO", text: `O mercado inteiro está caindo junto (${i.market!.falling} de ${i.market!.total} ações do time caíram 10% ou mais em 20 pregões). Na eleição de 2022 elas caíram mais 24% antes de voltar: comprar aos poucos.` }
      : i.context?.action === "REDUCE" ? { role: "Riscos do mundo", vote: "NEUTRO", text: `Cautela: ${i.context.summary}` }
        : !i.context ? { role: "Riscos do mundo", vote: "NEUTRO", text: "Ainda sem leitura das notícias, do dólar e do petróleo." }
          : { role: "Riscos do mundo", vote: "A_FAVOR", text: "Nenhuma notícia grave, dólar e petróleo sem choque, mercado sem queda geral." };

  const vetoes = [pessimist, world].filter((o) => o.vote === "CONTRA");
  const cautions = [pessimist, world].filter((o) => o.vote === "NEUTRO").length;
  const fraction = vetoes.length ? 0 : cautions === 0 ? 1 : cautions === 2 || optimist.vote !== "A_FAVOR" ? 1 / 3 : 1 / 2;
  const part = fraction === 1 ? "o valor inteiro" : fraction === 0.5 ? "metade" : "um terço";
  const consensus: Consensus = vetoes.length
    ? { veto: vetoes.map((v) => `${v.role}: ${v.text}`).join(" "), fraction: 0, text: `não comprar (${vetoes.map((v) => v.role).join(" e ")} contra)` }
    : { veto: null, fraction, text: fraction === 1 ? "comprar o valor inteiro (ninguém vê risco)" : `comprar só ${part} agora e o resto se cair mais (${[pessimist, world].filter((o) => o.vote === "NEUTRO").map((o) => o.role).join(" e ")} pedem cautela${optimist.vote === "A_FAVOR" ? "" : ", o Otimista não vê motivo forte"})` };
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
  const sellNow = r !== null && price !== null && i.holding > 0 && price >= r.sellAbove && floor !== null && price >= floor;
  const zone = r !== null && price !== null && price <= r.buyBelow;
  const badHistory = zone && !historyAgrees(i.history);
  const entry = zone && i.recent?.length ? entryCheck(i.recent, price!, r.low) : null;
  const falling = entry !== null && !entry.ok;
  const average = i.holding > 0 ? i.averageCost : null;
  const rebuyBelow = average && RANGE_DEFAULTS.rebuyBelowAvgPct !== undefined ? average * (1 - RANGE_DEFAULTS.rebuyBelowAvgPct / 100) : null;
  const holdingEnough = zone && rebuyBelow !== null && price! > rebuyBelow;
  const nearLow = zone && !badHistory && !falling && !holdingEnough;
  const canBuy = i.budgetRoom > 0;
  const rule = !r || price === null ? "Ainda calculando a mínima e a máxima de 6 meses."
    : sellNow ? `${brl(price)} chegou perto da máxima de 6 meses (${brl(r.high)}) e paga o que custou com as taxas: hora de vender na alta.`
      : badHistory ? `Perto da mínima, mas nas ${i.history!.samples} vezes anteriores subiu só em ${Math.round(i.history!.upShare * 100)}%: não vale a pena.`
      : zone && falling ? `Perto da mínima de 6 meses (${brl(r.low)}): ${entryReason(entry!, price)}.`
      : holdingEnough ? `Já tem ${i.holding}: compra mais só se cair abaixo de ${brl(rebuyBelow!)} e virar de novo.`
      : nearLow ? (canBuy ? `${brl(price)} está perto da mínima de 6 meses (${brl(r.low)}) e já virou para cima. Consenso: ${consensus.text}.`
        : `Preço bom (perto da mínima de ${brl(r.low)}), mas o Chefe não tem dinheiro livre para 1 ação.`)
        : i.holding > 0 ? `Segurando: vende perto da máxima, a partir de ${brl(Math.max(r.sellAbove, floor ?? 0))}.`
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
