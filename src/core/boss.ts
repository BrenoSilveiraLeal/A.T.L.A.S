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
