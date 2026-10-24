import type { ContextAction } from "./context";
import type { HealthLevel } from "./company-health";

/**
 * The meeting-room committee (owner, 24/10/2026: "debater com outras IAs sobre o risco, sobre
 * valores, sobre se vale a pena"). Three specialists give their vote on the agent's stock with
 * the same rules the autopilot applies, so what the room shows is what will actually happen:
 * - Risco: news, material facts, dollar and oil (the context brake);
 * - Balanço: the company's health from its annual statements;
 * - Estratégia: the owner's rule (buy with each share of the contribution, sell only high).
 * A "contra" from Risco or Balanço vetoes a purchase.
 */
export type Vote = "A_FAVOR" | "CONTRA" | "NEUTRO";
export interface Opinion { role: "Risco" | "Balanço" | "Estratégia"; vote: Vote; text: string }
export type Verdict = "COMPRAR" | "SEGURAR" | "ESPERAR" | "VENDER_NA_ALTA";
export interface CommitteeInput {
  context: { action: ContextAction; summary: string } | null;
  health: { level: HealthLevel; reason: string } | null;
  holding: number; averageCost: number | null; price: number | null;
  /** Budget the agent may still spend (its accumulated share of the contributions). */
  budgetRoom: number;
  rule: { targetPct: number; turnPct: number; minOrder: number };
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
  const { targetPct, minOrder } = i.rule;
  const gain = i.holding > 0 && i.averageCost && i.price ? i.price / i.averageCost - 1 : null;
  const canBuy = i.budgetRoom >= minOrder;
  const strategy: Opinion = gain !== null && gain >= targetPct / 100
    ? { role: "Estratégia", vote: "NEUTRO", text: `Lucro de ${(gain * 100).toFixed(1)}%: passou da meta de +${targetPct}%. Vende tudo quando o preço virar ${i.rule.turnPct}% do topo.` }
    : canBuy ? { role: "Estratégia", vote: "A_FAVOR", text: `Tem ${brl(i.budgetRoom)} do aporte: hora de acumular mais ações${gain !== null ? ` (preço médio ${brl(i.averageCost!)})` : ""}.` }
      : { role: "Estratégia", vote: "NEUTRO", text: `Juntando o aporte: tem ${brl(Math.max(0, i.budgetRoom))}, compra a partir de ${brl(minOrder)}.${gain !== null ? ` Segura as ações (${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(1)}%) até +${targetPct}%.` : ""}` };
  const vetoes = [risk, balance].filter((o) => o.vote === "CONTRA");
  const verdict: Verdict = gain !== null && gain >= targetPct / 100 ? "VENDER_NA_ALTA"
    : canBuy && !vetoes.length ? "COMPRAR" : i.holding > 0 ? "SEGURAR" : "ESPERAR";
  const summary = verdict === "COMPRAR" ? `Decisão: comprar${risk.vote === "NEUTRO" && i.context?.action === "REDUCE" ? " pela metade" : ""}.`
    : verdict === "VENDER_NA_ALTA" ? "Decisão: preparar a venda na alta."
      : canBuy && vetoes.length ? `Decisão: não comprar agora (${vetoes.map((v) => v.role).join(" e ")} contra).`
        : verdict === "SEGURAR" ? "Decisão: segurar as ações e juntar o aporte." : "Decisão: esperar juntar o aporte.";
  return { opinions: [risk, balance, strategy], verdict, summary };
}
