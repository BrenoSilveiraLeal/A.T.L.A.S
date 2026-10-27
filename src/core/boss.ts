/**
 * The boss (owner, 25/10/2026): all the owner's money at Genial is one pot. The owner does not
 * assign money to agents; the boss releases it to an agent only when that agent's rule says it is
 * the right moment to buy, and every sale returns the money to the pot for any agent.
 * How much: what is free in the pot, but one agent never holds more than `maxSharePct` of all the
 * deposited money, unless that is not enough for a single share (small accounts, e.g. R$ 50).
 * Pure: the caller passes the pot and the agent's position.
 */
export const BOSS = { maxSharePct: 50 } as const;

export interface GrantInput {
  /** Money free in the pot now (deposits + realized results − cost of shares held − orders in flight). */
  pool: number;
  /** Everything the owner deposited. */
  deposited: number;
  /** What this agent already holds (cost, fees included) plus its buy orders in flight. */
  committed: number;
  /** Price of one share now and the brokerage of one order. */
  price: number; fee: number;
}

export function bossGrant(i: GrantInput): number {
  if (!(i.pool > 0) || !(i.price > 0)) return 0;
  // One share at the order's limit price (up to 1% above the quote) plus the brokerage.
  const oneShare = i.price * 1.01 + i.fee;
  const cap = Math.max((i.deposited * BOSS.maxSharePct) / 100, oneShare) - Math.max(0, i.committed);
  const grant = Math.min(i.pool, cap);
  return grant >= oneShare ? Math.floor(grant * 100) / 100 : 0;
}

/**
 * The boss compares the whole team (owner, 25–26/10/2026: "comprar o máximo possível daquela que vai
 * retornar o máximo possível; se faltar dinheiro, a segunda melhor"). Candidates are the agents whose
 * stock is in its buy zone at the right moment; `score` ranks them (lower = better: closer to the
 * 6-month low within the range, more analyst upside, worse for a company flagged "Atenção").
 * The free money goes 50% to the best, 30% to the second and 20% to the third (at least one share
 * each while money lasts; one that cannot pay a share passes its part to the next). A single
 * candidate gets the whole pot. On the team's B3 history 2023–2026 this split matched putting
 * everything on the best in the good years and avoided its bad years (docs/BACKTEST_CAIXA.md).
 */
export const POT_SPLIT = [0.5, 0.3, 0.2] as const;
export interface Candidate { agentId: string; price: number; fee: number; score: number }

export function opportunityScore(price: number, low: number, high: number, attention: boolean, upside: number | null = null) {
  const position = high > low ? (price - low) / (high - low) : 0;
  // More upside to the analysts' mean target ranks a stock higher (capped both ways).
  return Math.max(0, position) + (attention ? 0.15 : 0) - 0.3 * Math.max(-0.3, Math.min(0.5, upside ?? 0));
}

export function allocatePot(pool: number, candidates: readonly Candidate[]): Record<string, number> {
  const ranked = [...candidates].sort((a, b) => a.score - b.score);
  const out: Record<string, number> = Object.fromEntries(ranked.map((c) => [c.agentId, 0]));
  const total = Math.max(0, pool);
  let left = total, slot = 0;
  for (const c of ranked) {
    if (slot >= POT_SPLIT.length) break;
    const oneShare = c.price * 1.01 + c.fee;
    if (left < oneShare) continue; // cannot pay one share: its part goes to the next
    const weights = POT_SPLIT.slice(0, Math.min(POT_SPLIT.length, ranked.length));
    const last = slot === weights.length - 1 || ranked.indexOf(c) === ranked.length - 1;
    const part = (total * weights[slot]) / weights.reduce((s, w) => s + w, 0);
    const give = last ? left : Math.min(left, Math.max(part, oneShare));
    out[c.agentId] = Math.floor(give * 100) / 100;
    left -= out[c.agentId]; slot++;
  }
  return out;
}
