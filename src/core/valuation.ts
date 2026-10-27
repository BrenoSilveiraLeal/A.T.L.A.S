/**
 * Valuation and the economists' outlook for the council (owner, 27/10/2026: "alguma biblioteca...
 * que ajude o ATLAS a tomar melhores decisões"), from the same public sources the Python libraries
 * `fundamentus` and `python-bcb` read:
 * - Fundamentus (fundamentus.com.br/resultado.php): price/earnings, price/book, dividend yield, ROE
 *   and net debt/equity of every listed stock, from the companies' own statements;
 * - Boletim Focus (Banco Central, olinda Expectativas): the median of ~100 economists for the Selic and
 *   inflation (IPCA) at the end of next year, now and four weeks before.
 * Pure: parsing and reading only; lib/market-data fetches and caches.
 */
export interface Valuation { pl: number | null; pvp: number | null; dy: number | null; roe: number | null; debt: number | null }
export interface FocusTrend { asOf: string; year: string; selic: number | null; selicBefore: number | null; ipca: number | null; ipcaBefore: number | null }

/** "1.234,56" / "4,53%" / "-0,69" → number; empty or dash → null. */
export function brNumber(text: string): number | null {
  const clean = text.replace(/&nbsp;|\s|%/g, "").replace(/\./g, "").replace(",", ".");
  if (!clean || clean === "-") return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** The results table of fundamentus.com.br, one row per ticker. Throws when the layout changed. */
export function parseFundamentus(html: string, minRows = 50): Record<string, Valuation> {
  const head = [...html.matchAll(/<th[^>]*>(?:<[^>]*>)*([^<]*)/g)].map((m) => m[1].trim()).filter(Boolean);
  const at = (name: string) => head.findIndex((h) => h.replace(/[^\w/.]/g, "").toLowerCase() === name.replace(/[^\w/.]/g, "").toLowerCase());
  const index = { pl: at("P/L"), pvp: at("P/VP"), dy: at("Div.Yield"), roe: at("ROE"), debt: head.findIndex((h) => /^D.v\.(Brut|L.q)\/ ?Patrim\.?$/.test(h)) };
  if (head[0] !== "Papel" || Object.values(index).some((i) => i < 0)) throw new Error("FUNDAMENTUS_LAYOUT_CHANGED");
  const out: Record<string, Valuation> = {};
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim());
    if (cells.length < head.length || !/^[A-Z0-9]{4,6}$/.test(cells[0])) continue;
    const pct = (i: number) => { const v = brNumber(cells[i]); return v === null ? null : v / 100; };
    out[cells[0]] = { pl: brNumber(cells[index.pl]), pvp: brNumber(cells[index.pvp]), dy: pct(index.dy), roe: pct(index.roe), debt: brNumber(cells[index.debt]) };
  }
  if (Object.keys(out).length < minRows) throw new Error("FUNDAMENTUS_TOO_FEW_ROWS");
  return out;
}

const pctText = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const num = (x: number) => x.toFixed(1).replace(".", ",");

/** What the numbers say: a reason to rise for the Otimista, worries for the Pessimista. */
export function valuationView(v: Valuation | null | undefined): { ups: string[]; worries: string[] } {
  if (!v) return { ups: [], worries: [] };
  const ups: string[] = [], worries: string[] = [];
  if (v.pl !== null && v.pl > 0 && v.pl <= 12 && v.roe !== null && v.roe >= 0.1)
    ups.push(`barata pelos números: preço/lucro ${num(v.pl)} com rentabilidade (ROE) de ${pctText(v.roe)}`);
  if (v.dy !== null && v.dy >= 0.06) ups.push(`paga bons dividendos (${pctText(v.dy)} ao ano)`);
  if (v.pl !== null && v.pl < 0) worries.push("a empresa teve prejuízo nos últimos 12 meses");
  else if (v.pl !== null && v.pl > 30) worries.push(`cara pelo lucro atual (preço/lucro ${num(v.pl)})`);
  if (v.debt !== null && v.debt > 3) worries.push(`muito endividada (dívida ${num(v.debt)} vezes o patrimônio)`);
  return { ups, worries };
}

/** Economists' outlook: rising rates or inflation expectations are a risk; falling rates, a reason to rise. */
export function focusView(f: FocusTrend | null | undefined): { up: string | null; risk: string | null } {
  if (!f || f.selic === null || f.selicBefore === null) return { up: null, risk: null };
  const dSelic = f.selic - f.selicBefore, dIpca = f.ipca !== null && f.ipcaBefore !== null ? f.ipca - f.ipcaBefore : 0;
  const selic = `${num(f.selicBefore)}% → ${num(f.selic)}%`;
  if (dSelic >= 0.5 || dIpca >= 0.3)
    return { up: null, risk: `os economistas do Boletim Focus passaram a esperar ${dSelic >= 0.5 ? `juros mais altos no fim de ${f.year} (Selic ${selic})` : `inflação maior em ${f.year} (IPCA ${num(f.ipcaBefore!)}% → ${num(f.ipca!)}%)`} em 4 semanas` };
  if (dSelic <= -0.5) return { up: `os economistas do Boletim Focus esperam juros caindo (Selic no fim de ${f.year}: ${selic})`, risk: null };
  return { up: null, risk: null };
}

/** Latest and ~4-week-old medians from Focus rows (newest first), for one indicator and year. */
export function focusTrend(selicRows: readonly { Data: string; Mediana: number }[], ipcaRows: readonly { Data: string; Mediana: number }[], year: string): FocusTrend | null {
  const pick = (rows: readonly { Data: string; Mediana: number }[]) => {
    if (!rows.length) return { now: null, before: null, asOf: "" };
    const latest = rows[0], cutoff = new Date(Date.parse(latest.Data) - 26 * 86400000).toISOString().slice(0, 10);
    const old = rows.find((r) => r.Data <= cutoff);
    return { now: latest.Mediana, before: old?.Mediana ?? null, asOf: latest.Data };
  };
  const s = pick(selicRows), i = pick(ipcaRows);
  if (s.now === null) return null;
  return { asOf: s.asOf, year, selic: s.now, selicBefore: s.before, ipca: i.now, ipcaBefore: i.before };
}
