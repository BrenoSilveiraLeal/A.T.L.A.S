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
 * The boss compares the whole team (owner, 25/10/2026: "comparar as 6 opções ... gasta na que
 * está com um bom momento ... e compra mais de uma"). Candidates are the agents whose stock is in
 * its buy zone now; `score` ranks them (lower = better: closer to the 6-month low within the
 * 6-month range, worse for a company flagged "Atenção"). The best gets money first — at least one
 * share, or its fair part of what is left — then the next, until the pot is empty. A single
 * candidate gets the whole free pot and may buy several shares.
 */
export interface Candidate { agentId: string; price: number; fee: number; score: number }

export function opportunityScore(price: number, low: number, high: number, attention: boolean, upside: number | null = null) {
  const position = high > low ? (price - low) / (high - low) : 0;
  // More upside to the analysts' mean target ranks a stock higher (capped both ways).
  return Math.max(0, position) + (attention ? 0.15 : 0) - 0.3 * Math.max(-0.3, Math.min(0.5, upside ?? 0));
}

export function allocatePot(pool: number, candidates: readonly Candidate[]): Record<string, number> {
  const ranked = [...candidates].sort((a, b) => a.score - b.score);
  const out: Record<string, number> = {};
  let left = Math.max(0, pool);
  ranked.forEach((c, i) => {
    const oneShare = c.price * 1.01 + c.fee;
    const fair = left / (ranked.length - i);
    const give = left >= oneShare ? Math.min(left, Math.max(fair, oneShare)) : 0;
    out[c.agentId] = Math.floor(give * 100) / 100;
    left -= out[c.agentId];
  });
  return out;
}
