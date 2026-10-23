/**
 * Where the monthly contribution goes. Genial charges R$ 0,99 per fractional order, so the
 * money is concentrated: each chosen agent gets at least about R$ 100 (fee near 1%), at most
 * amount / minShare agents are chosen, best weight first (ties: smaller budget first, so the
 * team evens out over the months). Weights follow the IA gestora (measured results), halved
 * under news caution or unknown trend. A falling stock (below its long average) or a news
 * brake gets nothing. With nobody eligible, everything stays in the reserve (cash ≈ CDI in
 * the real account). Amounts are whole reais.
 */
export type ContextAction = "ALLOW" | "REDUCE" | "BLOCK_BUY" | "EXIT";
export interface ContributionAgent {
  id: string; name: string; ticker: string; alive: boolean; pnl: number | null; budget: number; sells: number;
  trendUp: boolean | null; context: ContextAction | null;
}
export interface ContributionRow { agentId: string; name: string; ticker: string; amount: number; reason: string }
export const MIN_SHARE = 95;

export function planContribution(amount: number, agents: readonly ContributionAgent[], minSells = 3, minShare = MIN_SHARE) {
  const skipped: { name: string; ticker: string; reason: string }[] = [];
  const eligible: { a: ContributionAgent; w: number; reason: string }[] = [];
  for (const a of agents.filter((x) => x.alive)) {
    const measured = a.sells >= minSells && a.pnl !== null && a.budget > 0;
    let w = measured ? Math.min(1.5, Math.max(0.5, 1 + 2 * (a.pnl! / a.budget))) : 1;
    let reason = measured ? (w > 1 ? "vem dando resultado" : w < 1 ? "vem perdendo, mas a ação está subindo" : "resultado neutro") : "ação subindo; ainda sem histórico de vendas";
    if (a.context === "BLOCK_BUY" || a.context === "EXIT") { skipped.push({ name: a.name, ticker: a.ticker, reason: "notícia ruim travou as compras" }); continue; }
    if (a.trendUp === false) { skipped.push({ name: a.name, ticker: a.ticker, reason: "a ação está em queda (abaixo da média de 100 dias)" }); continue; }
    if (a.context === "REDUCE") { w *= 0.5; reason = "cautela com as notícias"; }
    if (a.trendUp === null) { w *= 0.5; reason = "pouco histórico de preço"; }
    eligible.push({ a, w, reason });
  }
  const slots = Math.min(eligible.length, Math.floor(amount / minShare));
  const ranked = [...eligible].sort((x, y) => y.w - x.w || x.a.budget - y.a.budget);
  const chosen = ranked.slice(0, slots);
  const waiting = ranked.slice(slots).map((x) => ({ name: x.a.name, ticker: x.a.ticker, reason: "fica para o próximo mês: menos ordens, menos corretagem" }));
  const total = chosen.reduce((s, x) => s + x.w, 0);
  const rows: ContributionRow[] = chosen.map((x) => ({ agentId: x.a.id, name: x.a.name, ticker: x.a.ticker,
    amount: Math.floor((amount * x.w) / total), reason: x.reason }));
  const reserve = Math.round((amount - rows.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  const reserveReason = !agents.some((a) => a.alive) ? "Nenhuma IA viva: tudo fica na reserva."
    : !eligible.length ? "Nenhuma ação está boa para comprar agora: tudo fica na reserva rendendo."
      : !rows.length ? `Valor pequeno demais: com menos de R$ ${minShare} por compra a corretagem pesa demais. Fica na reserva.`
        : reserve > 0 ? "Sobra de arredondamento." : "Nada sobrou.";
  return { amount, rows, reserve, reserveReason, skipped, waiting };
}

/** Month key and day in São Paulo (the contribution calendar follows the owner's clock). */
export function saoPauloMonth(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { month: `${p.year}-${p.month}`, day: Number(p.day) };
}
