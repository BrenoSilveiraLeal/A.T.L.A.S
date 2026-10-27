import type { ContextAction } from "./context";
import type { HealthLevel } from "./company-health";
import { forecastOpinion, type ConsensusView } from "./forecast";
import { entryCheck, entryReason, historyAgrees, RANGE_DEFAULTS } from "./range";
import { minimumSellPrice } from "./live";

/**
 * The council (owner, 24–25/10/2026: "debater com outras IAs sobre o risco, sobre valores, sobre
 * se vale a pena"). Three specialists vote on the agent's stock with the same rules the autopilot
 * applies, so what the room shows is what will actually happen:
 * - Risco: news, material facts, dollar and oil (the context brake);
 * - Balanço: the company's health from its annual statements;
 * - Estratégia: the owner's rule — buy only near the 6-month low once the fall has turned into a
 *   rise, sell only near the 6-month high and never below what was paid; the boss must have money
 *   free for one share.
 * - Previsão: the analysts' consensus (target price and recommendation).
 * A "contra" from Risco, Balanço or Previsão vetoes a purchase.
 */
export type Vote = "A_FAVOR" | "CONTRA" | "NEUTRO";
export interface Opinion { role: "Risco" | "Balanço" | "Estratégia" | "Previsão"; vote: Vote; text: string }
export type Verdict = "COMPRAR" | "SEGURAR" | "ESPERAR" | "VENDER_NA_ALTA";
export interface CommitteeInput {
  context: { action: ContextAction; summary: string } | null;
  health: { level: HealthLevel; reason: string } | null;
  holding: number; averageCost: number | null; price: number | null;
  /** What the boss can release to this agent now (0 when the pot has nothing free). */
  budgetRoom: number;
  /** 6-month levels: lowest/highest close and the buy/sell triggers (null while unknown). */
  range: { low: number; high: number; buyBelow: number; sellAbove: number } | null;
  /** Minimum gain over the average price before selling (fees included), in %. */
  minGainPct: number;
  /** Analysts' consensus (Yahoo Finance), null when unavailable. */
  forecast?: ConsensusView | null;
  /** What followed past visits to the 6-month low (null when unknown). */
  history?: { samples: number; upShare: number; average: number } | null;
  /** Closes before today (oldest first) to see whether the fall has turned; unknown skips the check. */
  recent?: readonly number[];
}

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function committee(i: CommitteeInput): { opinions: Opinion[]; verdict: Verdict; summary: string } {
  const risk: Opinion = !i.context ? { role: "Risco", vote: "NEUTRO", text: "Ainda sem leitura das notícias desta ação." }
    : i.context.action === "ALLOW" ? { role: "Risco", vote: "A_FAVOR", text: "Nenhuma notícia grave, dólar e petróleo sem choque." }
      : i.context.action === "REDUCE" ? { role: "Risco", vote: "NEUTRO", text: `Cautela: ${i.context.summary}` }
        : { role: "Risco", vote: "CONTRA", text: i.context.action === "EXIT" ? `Pede para sair: ${i.context.summary}` : `Segura as compras: ${i.context.summary}` };
  const balance: Opinion = !i.health || i.health.level === "SEM_DADOS" ? { role: "Balanço", vote: "NEUTRO", text: i.health?.reason ?? "Balanço ainda não conferido." }
    : i.health.level === "PERIGO" ? { role: "Balanço", vote: "CONTRA", text: `Empresa em perigo: ${i.health.reason}` }
      : i.health.level === "ATENCAO" ? { role: "Balanço", vote: "NEUTRO", text: `Atenção: ${i.health.reason}` }
        : { role: "Balanço", vote: "A_FAVOR", text: `Empresa saudável. ${i.health.reason}` };
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
  const strategy: Opinion = !r || price === null ? { role: "Estratégia", vote: "NEUTRO", text: "Ainda calculando a mínima e a máxima de 6 meses." }
    : sellNow ? { role: "Estratégia", vote: "NEUTRO", text: `${brl(price)} chegou perto da máxima de 6 meses (${brl(r.high)}) e acima do que pagou: hora de vender na alta.` }
      : badHistory ? { role: "Estratégia", vote: "NEUTRO", text: `Perto da mínima, mas nas ${i.history!.samples} vezes anteriores subiu só em ${Math.round(i.history!.upShare * 100)}% (média ${(i.history!.average * 100).toFixed(0)}%): não vale a pena.` }
      : zone && !badHistory && falling ? { role: "Estratégia", vote: "NEUTRO", text: `Perto da mínima de 6 meses (${brl(r.low)}): ${entryReason(entry!, price)}.` }
      : holdingEnough ? { role: "Estratégia", vote: "NEUTRO", text: `Já tem ${i.holding}: compra mais só se cair abaixo de ${brl(rebuyBelow!)} e virar de novo.` }
      : nearLow ? (canBuy
        ? { role: "Estratégia", vote: "A_FAVOR", text: `${brl(price)} está perto da mínima de 6 meses (${brl(r.low)}) e já virou para cima: hora de comprar na baixa.` }
        : { role: "Estratégia", vote: "NEUTRO", text: `Preço bom (perto da mínima de ${brl(r.low)}), mas o Chefe não tem dinheiro livre para 1 ação.` })
        : i.holding > 0
          ? { role: "Estratégia", vote: "NEUTRO", text: `Segurando: vende perto da máxima, a partir de ${brl(Math.max(r.sellAbove, floor ?? 0))}.` }
          : { role: "Estratégia", vote: "NEUTRO", text: `Caro agora (${brl(price)}). Compra só se cair até ${brl(r.buyBelow)}, perto da mínima de 6 meses (${brl(r.low)}).` };
  const forecast = forecastOpinion(price, i.forecast ?? null);
  const prediction: Opinion = { role: forecast.role, vote: forecast.vote, text: forecast.text };
  const vetoes = [risk, balance, prediction].filter((o) => o.vote === "CONTRA");
  const verdict: Verdict = sellNow ? "VENDER_NA_ALTA" : nearLow && canBuy && !vetoes.length ? "COMPRAR" : i.holding > 0 ? "SEGURAR" : "ESPERAR";
  const summary = verdict === "COMPRAR" ? "Decisão: comprar na baixa."
    : verdict === "VENDER_NA_ALTA" ? "Decisão: vender na alta."
      : nearLow && canBuy && vetoes.length ? `Decisão: não comprar agora (${vetoes.map((v) => v.role).join(" e ")} contra).`
        : falling ? (entry!.big ? "Decisão: esperar a queda virar para cima." : "Decisão: esperar encostar na mínima.")
        : verdict === "SEGURAR" ? "Decisão: segurar até chegar perto da máxima." : "Decisão: esperar o preço cair.";
  return { opinions: [risk, balance, prediction, strategy], verdict, summary };
}
