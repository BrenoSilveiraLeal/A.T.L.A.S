import { headlineTone, normalizeText, type CompanyProfile } from "./context";

/**
 * The office "TV": how each agent reads a headline. Free keyword rules, the same lists the
 * context analyst uses to brake. It is a reading for the owner, not a trading signal:
 * buys still follow the tested rule and the context can only brake.
 */
export type NewsDirection = "UP" | "DOWN" | "WATCH";
/** ticker "*" = whole market (rates, Ibovespa, wars, disasters). */
export interface NewsTag { ticker: string; direction: NewsDirection; why: string }
export interface NewsProfile { ticker: string; profile: Pick<CompanyProfile, "name" | "aliases" | "commodity"> }

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(text));
const OIL = ["petroleo", "brent", "opep", "opep\\+", "opec", "barril", "oil", "crude"];
const RATES = ["selic", "juros", "copom", "taxa basica"];
const RATES_UP = ["eleva", "elevar", "elevacao", "alta", "sobe", "aumenta", "aumento", "aperto"];
const RATES_DOWN = ["corta", "corte", "cortar", "reduz", "reducao", "queda", "cai", "baixa", "afrouxamento"];
const DOLLAR = ["dolar", "cambio"];
const MARKET = ["ibovespa", "bolsa brasileira", "b3", "mercado financeiro", "inflacao", "ipca",
  "fiscal", "arcabouco", "recessao", "pib"];

const sign = (tone: "UP" | "DOWN" | "NEUTRAL"): NewsDirection => (tone === "NEUTRAL" ? "WATCH" : tone);

export function tagHeadline(title: string, profiles: readonly NewsProfile[]): NewsTag[] {
  const text = normalizeText(title);
  const { tone, severe, stress } = headlineTone(title);
  const tags: NewsTag[] = [];
  for (const { ticker, profile } of profiles) {
    if (profile.aliases.some((alias) => ` ${text.replace(/[^a-z0-9.+ ]+/g, " ")} `.includes(` ${alias} `)))
      tags.push({ ticker, direction: sign(tone), why: severe ? `notícia grave sobre ${profile.name}` : `fala de ${profile.name}` });
    else if (profile.commodity === "BRENT" && has(text, OIL))
      tags.push({ ticker, direction: sign(tone), why: "notícia do petróleo" });
  }
  if (has(text, RATES)) {
    const up = has(text, RATES_UP), down = has(text, RATES_DOWN);
    // Higher rates usually weigh on stocks; cuts usually help.
    tags.push({ ticker: "*", direction: up && !down ? "DOWN" : down && !up ? "UP" : "WATCH", why: "juros" });
  } else if (stress) tags.push({ ticker: "*", direction: "DOWN", why: "estresse no mundo" });
  // A falling dollar usually comes with foreign money into the Brazilian market, and vice versa.
  else if (has(text, DOLLAR)) tags.push({ ticker: "*", direction: tone === "UP" ? "DOWN" : tone === "DOWN" ? "UP" : "WATCH", why: "dólar" });
  else if (has(text, MARKET)) tags.push({ ticker: "*", direction: sign(tone), why: "economia" });
  return tags;
}

/** Tags that concern one agent: its own ticker first, then the whole market. */
export function tagsFor(ticker: string, tags: readonly NewsTag[]): NewsTag[] {
  return [...tags.filter((t) => t.ticker === ticker), ...tags.filter((t) => t.ticker === "*")];
}
