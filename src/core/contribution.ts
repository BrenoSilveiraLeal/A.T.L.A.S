/**
 * Where the monthly contribution goes (owner's rule, 24/10/2026: "cada um ganha uma parte").
 * Every active agent gets the same whole-real share, every month, whatever the stock is doing:
 * on official B3 history 2023–2026 this steady split was the only rule that beat the CDI in
 * both halves (docs/BACKTEST_ACUMULAR.md); skipping falling stocks or chasing winners did worse.
 * Fixed money buys more shares when the price is low. The agent saves its share until it has
 * R$ 80 for one order (Genial charges R$ 0,99 per fractional order) and the news brake acts at
 * buy time. Retired or eliminated agents get nothing; the rounding remainder stays in reserve.
 */
export type ContextAction = "ALLOW" | "REDUCE" | "BLOCK_BUY" | "EXIT";
export interface ContributionAgent { id: string; name: string; ticker: string; alive: boolean; active: boolean }
export interface ContributionRow { agentId: string; name: string; ticker: string; amount: number; reason: string }

export function planContribution(amount: number, agents: readonly ContributionAgent[]) {
  const team = agents.filter((a) => a.alive && a.active);
  const skipped = agents.filter((a) => a.alive && !a.active).map((a) => ({ name: a.name, ticker: a.ticker, reason: "aposentada: não opera mais" }));
  const share = team.length ? Math.floor(amount / team.length) : 0;
  const rows: ContributionRow[] = share > 0 ? team.map((a) => ({ agentId: a.id, name: a.name, ticker: a.ticker, amount: share,
    reason: "parte igual do mês; junta até ter R$ 80 para comprar" })) : [];
  const reserve = Math.round((amount - rows.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  const reserveReason = !team.length ? "Nenhuma IA ativa: tudo fica na reserva."
    : !rows.length ? "Valor pequeno demais para dividir: fica na reserva."
      : reserve > 0 ? "Sobra de arredondamento." : "Nada sobrou.";
  return { amount, rows, reserve, reserveReason, skipped, waiting: [] as { name: string; ticker: string; reason: string }[] };
}

/** Month key and day in São Paulo (the contribution calendar follows the owner's clock). */
export function saoPauloMonth(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { month: `${p.year}-${p.month}`, day: Number(p.day) };
}
