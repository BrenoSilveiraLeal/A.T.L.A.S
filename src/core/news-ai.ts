import { z } from "zod";
import type { NewsTag } from "./news";

/**
 * AI reading of one headline (local Ollama or Anthropic). The model may only answer about
 * the team's tickers or "*" (whole market); anything else is dropped. Display only.
 */
export type NewsAiConfig =
  | { kind: "ollama"; url: string; model: string }
  | { kind: "anthropic"; key: string; model: string };

export function newsAiConfig(env: Record<string, string | undefined> = process.env): NewsAiConfig | null {
  if (env.ATLAS_NEWS_AI === "ollama") {
    const url = env.OLLAMA_URL ?? "http://127.0.0.1:11434";
    // Local model only: never send the owner's team to an arbitrary remote host by mistake.
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(url)) return null;
    return { kind: "ollama", url, model: env.ATLAS_NEWS_AI_MODEL ?? "gemma4:12b" };
  }
  if (env.ATLAS_NEWS_AI === "anthropic" && env.ANTHROPIC_API_KEY)
    return { kind: "anthropic", key: env.ANTHROPIC_API_KEY, model: env.ATLAS_NEWS_AI_MODEL ?? "claude-haiku-5-5" };
  return null;
}

export const NEWS_AI_SYSTEM = [
  "Você é um analista da bolsa brasileira (B3). Recebe UMA manchete e a lista de ações da equipe.",
  "Diga, para cada ação afetada, se a notícia tende a fazer o preço subir (UP), cair (DOWN) ou só merece atenção (WATCH).",
  "Use \"*\" para notícias que afetam o mercado todo (juros, dólar, guerra, eleição, Ibovespa).",
  "Inclua SOMENTE ações com impacto claro; não liste uma ação só para dizer que ela não é afetada.",
  "Se a manchete não afeta nenhuma ação nem o mercado, responda readings vazio.",
  "Não invente fatos. Justificativa curta em português (até 12 palavras).",
  "Responda SOMENTE JSON: {\"readings\":[{\"ticker\":\"PETR4\",\"direction\":\"UP\",\"why\":\"...\"}]}",
].join("\n");

export function newsAiPrompt(title: string, team: readonly { ticker: string; name: string }[]) {
  return `Manchete: "${title.replace(/"/g, "'")}"\nAções da equipe:\n${team.map((t) => `- ${t.ticker}: ${t.name}`).join("\n")}`;
}

export const NEWS_AI_SCHEMA = {
  type: "object", required: ["readings"],
  properties: { readings: { type: "array", maxItems: 20, items: { type: "object", required: ["ticker", "direction", "why"],
    properties: { ticker: { type: "string" }, direction: { type: "string", enum: ["UP", "DOWN", "WATCH"] }, why: { type: "string" } } } } },
} as const;

const answer = z.object({ readings: z.array(z.object({ ticker: z.string(), direction: z.enum(["UP", "DOWN", "WATCH"]), why: z.string() })).max(20) });

/** Validates the model's JSON and keeps only allowed tickers. Throws on malformed output. */
export function parseNewsAi(text: string, tickers: readonly string[]): NewsTag[] {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const parsed = answer.parse(JSON.parse(json));
  const allowed = new Set([...tickers, "*"]);
  const unique = new Map<string, NewsTag>();
  for (const r of parsed.readings) {
    const ticker = r.ticker.trim().toUpperCase();
    if (!allowed.has(ticker) || unique.has(ticker)) continue;
    unique.set(ticker, { ticker, direction: r.direction, why: r.why.replace(/\s+/g, " ").trim().slice(0, 120) || "leitura da IA" });
  }
  return [...unique.values()];
}
