/**
 * Forecasts the agents lean on (owner, 25/10/2026: "tem que ter essas previsões"). Nobody knows
 * what the market will do; these are the free, checkable expectations available:
 * - analysts' consensus (Yahoo Finance): mean target price, recommendation, number of analysts;
 * - the stock's own history: what happened in the following 3 months the past times it came
 *   within 2% of its 6-month low.
 * Pure functions: the caller passes the data.
 */
import type { Vote } from "./committee";

export interface ConsensusView {
  targetMean: number | null; targetLow: number | null; targetHigh: number | null;
  recommendation: string | null; analysts: number | null;
}
export const RECOMMENDATION_PT: Record<string, string> = {
  strong_buy: "compra forte", buy: "compra", hold: "manter", underperform: "abaixo da média", sell: "venda", strong_sell: "venda forte",
};
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Upside to the analysts' mean target (null without a target). */
export function upsideOf(price: number | null, c: ConsensusView | null) {
  return price && c?.targetMean ? c.targetMean / price - 1 : null;
}

/**
 * The "Previsão" specialist: against buying when analysts say sell or the mean target is more
 * than 5% below the price; in favour with a buy recommendation and at least 10% upside.
 */
export function forecastOpinion(price: number | null, c: ConsensusView | null): { role: "Previsão"; vote: Vote; text: string; upside: number | null } {
  const upside = upsideOf(price, c);
  if (!c || (!c.recommendation && upside === null)) return { role: "Previsão", vote: "NEUTRO", text: "Sem previsão de analistas para esta ação.", upside: null };
  const rec = c.recommendation ? RECOMMENDATION_PT[c.recommendation] ?? c.recommendation : "sem recomendação";
  const who = c.analysts ? `${c.analysts} analistas` : "analistas";
  const target = c.targetMean ? `alvo médio ${brl(c.targetMean)} (${pct(upside!)})` : "sem preço-alvo";
  const text = `${who}: ${rec}, ${target}.`;
  if (["sell", "strong_sell", "underperform"].includes(c.recommendation ?? "") || (upside !== null && upside < -0.05))
    return { role: "Previsão", vote: "CONTRA", text, upside };
  if (["buy", "strong_buy"].includes(c.recommendation ?? "") && upside !== null && upside >= 0.1) return { role: "Previsão", vote: "A_FAVOR", text, upside };
  return { role: "Previsão", vote: "NEUTRO", text, upside };
}

/**
 * The past times the stock came within `nearPct` of its 6-month low: how much it moved over the
 * next `horizon` sessions (average) and how often it was higher. Episodes do not overlap.
 */
export function nearLowHistory(closes: readonly number[], window = 126, nearPct = 2, horizon = 63) {
  const returns: number[] = [];
  for (let t = window; t + horizon < closes.length; t++) {
    const low = Math.min(...closes.slice(t - window, t));
    if (closes[t] <= low * (1 + nearPct / 100)) { returns.push(closes[t + horizon] / closes[t] - 1); t += horizon; }
  }
  if (!returns.length) return null;
  return { samples: returns.length, average: returns.reduce((a, b) => a + b, 0) / returns.length, upShare: returns.filter((r) => r > 0).length / returns.length };
}

/** Scout's grade for a stock outside the team: cheap in its 6-month range, analysts positive, profitable. */
export function scoutGrade(s: { price: number; low: number; high: number; upside: number | null; recommendation: string | null; profitMargin: number | null }) {
  const position = s.high > s.low ? (s.price - s.low) / (s.high - s.low) : 1;
  const reasons: string[] = [];
  if (position <= 0.25) reasons.push(`perto da mínima de 6 meses (${(position * 100).toFixed(0)}% da faixa)`);
  if (s.upside !== null && s.upside >= 0.1) reasons.push(`analistas veem ${pct(s.upside)}`);
  if (["buy", "strong_buy"].includes(s.recommendation ?? "")) reasons.push(`recomendação: ${RECOMMENDATION_PT[s.recommendation!]}`);
  if (s.profitMargin !== null && s.profitMargin > 0) reasons.push("empresa com lucro");
  const warnings: string[] = [];
  if (s.profitMargin !== null && s.profitMargin <= 0) warnings.push("empresa com prejuízo");
  if (["sell", "strong_sell", "underperform"].includes(s.recommendation ?? "")) warnings.push("analistas recomendam vender");
  const score = (1 - Math.min(1, position)) * 2 + Math.max(-0.5, Math.min(0.6, s.upside ?? 0)) * 3
    + (["buy", "strong_buy"].includes(s.recommendation ?? "") ? 0.5 : 0) - warnings.length * 2;
  return { score, position, reasons, warnings, good: position <= 0.35 && (s.upside ?? 0) >= 0.1 && !warnings.length };
}
