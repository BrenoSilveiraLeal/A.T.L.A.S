/**
 * The "IA gestora": suggests how to split the team's budget by simulated results.
 * Agents with at least `minSells` closed sales are measured; better return on their budget
 * earns up to +50% weight, worse down to -50%. Unmeasured agents keep a neutral weight.
 * Eliminated agents free their budget and open a vacancy for their stock.
 * It only suggests: the owner decides whether to change any budget.
 */
export interface AllocationAgent { id: string; name: string; ticker: string; budget: number; pnl: number | null; sells: number; dead: boolean }
export interface AllocationRow { id: string; name: string; ticker: string; current: number; suggested: number; reason: string }

export function suggestAllocation(agents: readonly AllocationAgent[], minSells = 3) {
  const alive = agents.filter((a) => !a.dead);
  const pool = agents.reduce((sum, a) => sum + a.budget, 0);
  const measured = (a: AllocationAgent) => a.sells >= minSells && a.pnl !== null && a.budget > 0;
  const weight = (a: AllocationAgent) => (measured(a) ? Math.min(1.5, Math.max(0.5, 1 + 2 * (a.pnl! / a.budget))) : 1);
  const total = alive.reduce((sum, a) => sum + weight(a), 0);
  const rows: AllocationRow[] = alive.map((a) => {
    const w = weight(a);
    return { id: a.id, name: a.name, ticker: a.ticker, current: a.budget,
      suggested: total ? Math.floor((pool * w) / total / 100) * 100 : 0,
      reason: !measured(a) ? `ainda sem ${minSells} vendas: peso neutro` : w > 1 ? "resultado acima do orçamento: mais dinheiro" : w < 1 ? "resultado negativo: menos dinheiro" : "resultado neutro" };
  });
  const covered = new Set(alive.map((a) => a.ticker));
  const vacancies = [...new Set(agents.filter((a) => a.dead && !covered.has(a.ticker)).map((a) => a.ticker))];
  return { pool, rows, vacancies, measured: alive.some(measured) };
}
