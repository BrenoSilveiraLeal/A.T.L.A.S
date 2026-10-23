/**
 * Where the monthly contribution goes. Each living agent starts with an equal share; the
 * share grows or shrinks with its measured result (same weights as the IA gestora) and is
 * halved under caution. An agent whose stock is falling (below its long average) or whose
 * news brake blocks buys gets nothing this month: its share stays in the reserve, which in
 * the real account is cash earning roughly the CDI. Amounts are whole reais.
 */
export type ContextAction = "ALLOW" | "REDUCE" | "BLOCK_BUY" | "EXIT";
export interface ContributionAgent {
  id: string; name: string; ticker: string; alive: boolean; pnl: number | null; budget: number; sells: number;
  trendUp: boolean | null; context: ContextAction | null;
}
export interface ContributionRow { agentId: string; name: string; ticker: string; amount: number; reason: string }

export function planContribution(amount: number, agents: readonly ContributionAgent[], minSells = 3) {
  const alive = agents.filter((a) => a.alive);
  const skipped: { name: string; ticker: string; reason: string }[] = [];
  const weighted = alive.map((a) => {
    const measured = a.sells >= minSells && a.pnl !== null && a.budget > 0;
    let w = measured ? Math.min(1.5, Math.max(0.5, 1 + 2 * (a.pnl! / a.budget))) : 1;
    let reason = measured ? (w > 1 ? "vem dando resultado" : w < 1 ? "vem perdendo: recebe menos" : "resultado neutro") : "ainda sem histórico: parte igual";
    let eligible = true;
    if (a.context === "BLOCK_BUY" || a.context === "EXIT") { eligible = false; reason = "notícia ruim travou as compras"; }
    else if (a.trendUp === false) { eligible = false; reason = "a ação está em queda (abaixo da média de 100 dias)"; }
    else {
      if (a.context === "REDUCE") { w *= 0.5; reason = "cautela com as notícias: metade da parte"; }
      if (a.trendUp === null) { w *= 0.5; reason = "sem histórico de preço suficiente: metade da parte"; }
    }
    if (!eligible) skipped.push({ name: a.name, ticker: a.ticker, reason });
    return { a, w: eligible ? w : 0, base: measured ? Math.min(1.5, Math.max(0.5, 1 + 2 * (a.pnl! / a.budget))) : 1, reason };
  });
  // Skipped agents still count in the total, so their share stays in the reserve.
  const total = weighted.reduce((s, x) => s + Math.max(x.base, x.w), 0);
  const rows: ContributionRow[] = weighted.filter((x) => x.w > 0).map((x) => ({
    agentId: x.a.id, name: x.a.name, ticker: x.a.ticker, amount: total ? Math.floor((amount * x.w) / total) : 0, reason: x.reason,
  })).filter((r) => r.amount > 0);
  const reserve = Math.round((amount - rows.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  const reserveReason = !alive.length ? "Nenhuma IA viva: tudo fica na reserva."
    : rows.length === 0 ? "Nenhuma ação está boa para comprar agora: tudo fica na reserva rendendo."
      : skipped.length ? `Fica na reserva a parte de ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.`
        : "Sobra de arredondamento.";
  return { amount, rows, reserve, reserveReason, skipped };
}

/** Month key and day in São Paulo (the contribution calendar follows the owner's clock). */
export function saoPauloMonth(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { month: `${p.year}-${p.month}`, day: Number(p.day) };
}
