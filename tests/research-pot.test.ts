import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { rangeDecision, rangeLevels, RANGE_DEFAULTS } from "@/core/range";
import { nearLowHistory } from "@/core/forecast";
import { opportunityScore } from "@/core/boss";
import { isinPrefix } from "@/core/corporate-actions";
import { fetchB3CashHistory, fetchB3Events } from "@/providers/b3-events";

/**
 * Opt-in: how the boss should split one pot among the twelve agents (owner, 26/10/2026: "comprar o
 * máximo possível daquela que vai retornar o máximo possível; se faltar dinheiro, a segunda melhor").
 * Monthly deposits, the rule in use decides who may buy, the boss splits the free money by policy,
 * orders fill at the next open with Genial's fees; sales return the money to the pot.
 * ATLAS_BACKTEST_CSV: date,ticker,isin,open,high,low,close,volume. Writes ATLAS_POT_OUT.
 */
const CSV = process.env.ATLAS_BACKTEST_CSV;
const TEAM = ["PETR4", "VALE3", "ITUB4", "B3SA3", "AXIA3", "EMBJ3", "EQTL3", "SANB11", "BPAC11", "LREN3", "MULT3", "CYRE3"];
// Owner, 27/10/2026: "botar mais agentes, deixar como tá ou remover alguns?" — same money, other teams.
const CURRENT = ["PETR4", "ABEV3", "ITUB4", "B3SA3", "AXIA3", "EMBJ3", "EQTL3", "SANB11", "BPAC11", "LREN3", "MULT3", "CYRE3"];
const TEAMS: [string, string[]][] = [
  ["6 ações (o time do começo)", ["PETR4", "VALE3", "ITUB4", "B3SA3", "AXIA3", "EMBJ3"]],
  ["12 ações com a Vale (time de ontem)", TEAM],
  ["12 ações com a Ambev (time atual)", CURRENT],
  ["16 ações (atual + ITSA4, TIMS3, CPFE3, PSSA3)", [...CURRENT, "ITSA4", "TIMS3", "CPFE3", "PSSA3"]],
  ["20 ações (16 + RENT3, MGLU3, BBDC4, BBAS3)", [...CURRENT, "ITSA4", "TIMS3", "CPFE3", "PSSA3", "RENT3", "MGLU3", "BBDC4", "BBAS3"]],
];
const FIXED = 0.99, VARIABLE = (3 + 10 + 5) / 10000;
type Policy = { name: string; split: (pool: number, ranked: { ticker: string; price: number }[]) => Record<string, number> };
const weighted = (weights: number[]) => (pool: number, ranked: { ticker: string; price: number }[]) => {
  const out: Record<string, number> = {};
  let left = pool;
  const picks = ranked.slice(0, weights.length);
  const total = weights.slice(0, picks.length).reduce((s, w) => s + w, 0);
  picks.forEach((c, i) => {
    const one = c.price * (1 + VARIABLE) + FIXED;
    const want = i === picks.length - 1 ? left : Math.max(pool * weights[i] / total, one);
    const give = left >= one ? Math.min(left, want) : 0;
    out[c.ticker] = give; left -= give;
  });
  return out;
};
const POLICIES: Policy[] = [
  { name: "Tudo na melhor oportunidade (se não der 1 ação, a segunda melhor)", split: weighted([1]) },
  { name: "Duas melhores: 60% na melhor, 40% na segunda", split: weighted([0.6, 0.4]) },
  { name: "Três melhores: 50% / 30% / 20%", split: weighted([0.5, 0.3, 0.2]) },
  { name: "Igual entre todas na hora certa (regra atual do Chefe)", split: (pool, ranked) => weighted(ranked.map(() => 1))(pool, ranked) },
];
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) { if (attempt === 4) throw error; await new Promise((r) => setTimeout(r, 4000 * attempt)); }
  }
}

it.skipIf(!CSV)("how the boss should split the pot among the team", async () => {
  const lines = readFileSync(CSV!, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [header[i], v])));
  const data = new Map<string, { byDate: Map<string, { open: number; close: number }>; divs: Map<string, number> }>();
  const teamsMode = Boolean(process.env.ATLAS_POT_TEAMS);
  for (const t of new Set(teamsMode ? TEAMS.flatMap(([, team]) => team) : TEAM)) {
    const daily = rows.filter((r) => r.ticker === t).sort((a, b) => a.date.localeCompare(b.date));
    const prefix = isinPrefix(t);
    const stock = (await retry(() => fetchB3Events(t.slice(0, 4)))).filter((e) => e.kind !== "CASH" && prefix && e.isin.startsWith(prefix));
    const ratios = stock.map((e) => ({ date: e.lastDatePrior, ratio: e.kind === "GROUPING" ? Number(e.value) : 1 + Number(e.value) / 100 }));
    const factor = (date: string) => ratios.filter((x) => date <= x.date).reduce((f, x) => f * x.ratio, 1);
    const bars = daily.map((r) => ({ date: r.date, open: Number(r.open) / factor(r.date), close: Number(r.close) / factor(r.date) }));
    const cash = await retry(() => fetchB3CashHistory(t));
    const divs = new Map<string, number>();
    for (const e of cash) {
      const ex = bars.find((b) => b.date > e.lastDatePrior);
      if (ex) divs.set(ex.date, (divs.get(ex.date) ?? 0) + (Number(e.value) * (/JRS/.test(e.label) ? 0.85 : 1)) / factor(e.lastDatePrior));
    }
    data.set(t, { byDate: new Map(bars.map((b) => [b.date, b])), divs });
  }
  const dates = [...new Set([...data.values()].flatMap((d) => [...d.byDate.keys()]))].sort();

  /** One pot for `team`, monthly deposits, the rule in use decides, `policy` splits the free money. */
  const simulate = (team: readonly string[], policy: Policy, monthly: number, from: string, to: string) => {
    const state = new Map(team.map((t) => [t, { closes: [] as number[], shares: 0, cost: 0, pending: null as null | { side: "BUY"; spend: number } | { side: "SELL" } }]));
    let cash = 0, month = "", buys = 0, deposited = 0;
    const bought = new Set<string>();
    for (const date of dates.filter((d) => d >= from && d <= to)) {
      if (date.slice(0, 7) !== month) { month = date.slice(0, 7); cash += monthly; deposited += monthly; }
      for (const [t, s] of state) {
        const bar = data.get(t)!.byDate.get(date);
        if (!bar) continue;
        if (s.pending?.side === "BUY") {
          const price = bar.open * (1 + VARIABLE), quantity = Math.floor((Math.min(s.pending.spend, cash) - FIXED) / price);
          if (quantity > 0) { const paid = quantity * price + FIXED; cash -= paid; s.cost += paid; s.shares += quantity; buys++; bought.add(t); }
        } else if (s.pending?.side === "SELL" && s.shares > 0) { cash += s.shares * bar.open * (1 - VARIABLE) - FIXED; s.shares = 0; s.cost = 0; }
        s.pending = null;
        const div = data.get(t)!.divs.get(date);
        if (div && s.shares > 0) cash += s.shares * div;
      }
      // Decide at the close: sales first (money back to the pot), then the boss splits the rest.
      const candidates: { ticker: string; price: number; score: number }[] = [];
      for (const [t, s] of state) {
        const bar = data.get(t)!.byDate.get(date);
        if (!bar) continue;
        const levels = rangeLevels(s.closes, RANGE_DEFAULTS);
        const history = levels && bar.close <= levels.buyBelow ? nearLowHistory(s.closes, RANGE_DEFAULTS.window, RANGE_DEFAULTS.nearPct, 63) : null;
        const d = rangeDecision({ closes: s.closes, price: bar.close, quantity: s.shares, cost: s.cost, cash: 1e9, minOrder: 40, history });
        if (d.action === "SELL") s.pending = { side: "SELL" };
        if (d.action === "BUY" && levels) candidates.push({ ticker: t, price: bar.close, score: opportunityScore(bar.close, levels.low, levels.high, false) });
        s.closes.push(bar.close);
      }
      const split = policy.split(cash, candidates.sort((a, b) => a.score - b.score));
      for (const [t, spend] of Object.entries(split)) if (spend >= 40) state.get(t)!.pending = { side: "BUY", spend };
    }
    const value = cash + [...state].reduce((sum, [, s]) => sum + s.shares * (s.closes.at(-1) ?? 0), 0);
    return { value, deposited, cash, buys, bought: bought.size };
  };
  const PERIODS = [["2023-01 a 2026-10", "0000", "9999"], ["2023–2024", "2023-01-01", "2024-12-31"], ["2025–2026", "2025-01-01", "2026-12-31"]] as const;

  if (teamsMode) {
    const policy = POLICIES[2];
    const out = ["# Quantas IAs: time menor, igual ou maior", "",
      `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-pot.test.ts\` com ATLAS_POT_TEAMS (execução manual). Histórico oficial da B3.`, "",
      `**Plano:** o mesmo dinheiro (R$ 300/mês) para times diferentes; a regra em uso decide quem pode comprar e o Chefe divide como em uso (${policy.name}). Corretagem, taxas, dividendos e vendas como em BACKTEST_CAIXA.md.`, ""];
    for (const [label, from, to] of PERIODS) {
      out.push(`## ${label}`, "", "| Time | Valor final | Ganho sobre o depositado | Dinheiro parado no fim | Compras | Ações diferentes compradas |", "| --- | --- | --- | --- | --- | --- |");
      let deposited = 0;
      for (const [name, team] of TEAMS) {
        const r = simulate(team, policy, 300, from, to); deposited = r.deposited;
        out.push(`| ${name} | R$ ${r.value.toFixed(2)} | ${pct(r.value / r.deposited - 1)} | R$ ${r.cash.toFixed(2)} | ${r.buys} | ${r.bought} |`);
      }
      out.push("", `Depositado: R$ ${deposited.toFixed(2)}`, "");
    }
    writeFileSync(process.env.ATLAS_POT_OUT ?? "docs/BACKTEST_TIME.md", out.join("\n") + "\n");
    return;
  }

  const out = ["# Como o Chefe deve dividir o caixa", "",
    `Gerado em ${new Date().toISOString().slice(0, 10)} por \`tests/research-pot.test.ts\` (execução manual). Histórico oficial da B3 das 12 ações do time (${TEAM.join(", ")}).`, "",
    "**Plano:** um caixa só para as 12 IAs, depósito mensal no 1º pregão do mês. Cada dia a regra em uso (faixa de 6 meses, virada depois de queda grande, histórico a favor) diz quem pode comprar; o Chefe ordena as candidatas (mais perto da mínima de 6 meses = melhor) e divide o dinheiro livre conforme a política. Compra na abertura seguinte com corretagem Genial R$ 0,99, taxas e slippage; vende perto da máxima depois que a alta para, nunca abaixo do preço médio + 3%; a venda volta para o caixa. Dividendos e JCP líquidos entram no caixa.", ""];
  for (const monthly of [200, 300, 500]) for (const [label, from, to] of PERIODS) {
    out.push(`## R$ ${monthly}/mês · ${label}`, "", "| Política | Valor final | Ganho sobre o depositado | Dinheiro parado no fim | Compras | Ações diferentes compradas |", "| --- | --- | --- | --- | --- | --- |");
    let deposited = 0;
    for (const policy of POLICIES) {
      const r = simulate(TEAM, policy, monthly, from, to); deposited = r.deposited;
      out.push(`| ${policy.name} | R$ ${r.value.toFixed(2)} | ${pct(r.value / r.deposited - 1)} | R$ ${r.cash.toFixed(2)} | ${r.buys} | ${r.bought} |`);
    }
    out.push("", `Depositado: R$ ${deposited.toFixed(2)}`, "");
  }
  writeFileSync(process.env.ATLAS_POT_OUT ?? "docs/BACKTEST_CAIXA.md", out.join("\n") + "\n");
}, 1800000);
