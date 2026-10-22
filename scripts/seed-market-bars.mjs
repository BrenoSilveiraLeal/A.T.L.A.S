import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

// Loads official B3 daily bars (CSV from scripts/cotahist_extract.py) into market_bars.
// Insert-only: days already stored are kept. Prints only counts.
//   node scripts/seed-market-bars.mjs bars.csv
const [file] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/seed-market-bars.mjs bars.csv");
const env = parseEnv(await readFile(".env.local", "utf8"));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const [header, ...lines] = (await readFile(file, "utf8")).trim().split(/\r?\n/);
const columns = header.split(",");
if (columns.join(",") !== "date,ticker,isin,open,high,low,close,volume") throw new Error("Unexpected CSV header.");
const rows = lines.map((line) => {
  const v = Object.fromEntries(line.split(",").map((value, i) => [columns[i], value]));
  return { ticker: v.ticker, trade_date: v.date, open: v.open, high: v.high, low: v.low, close: v.close, volume: Number(v.volume), source: "B3_COTAHIST" };
});
let sent = 0;
for (let i = 0; i < rows.length; i += 1000) {
  const chunk = rows.slice(i, i + 1000);
  const result = await db.from("market_bars").upsert(chunk, { onConflict: "ticker,trade_date", ignoreDuplicates: true });
  if (result.error) throw new Error(`Insert failed: ${result.error.message}`);
  sent += chunk.length;
}
console.log(JSON.stringify({ rows: sent, tickers: new Set(rows.map((r) => r.ticker)).size }));
