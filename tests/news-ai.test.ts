import { describe, expect, it } from "vitest";
import { newsAiConfig, newsAiPrompt, parseNewsAi } from "@/core/news-ai";

describe("AI news reading", () => {
  it("is off unless configured and only talks to a local Ollama", () => {
    expect(newsAiConfig({})).toBeNull();
    expect(newsAiConfig({ ATLAS_NEWS_AI: "ollama" })).toEqual({ kind: "ollama", url: "http://127.0.0.1:11434", model: "gemma4:12b" });
    expect(newsAiConfig({ ATLAS_NEWS_AI: "ollama", OLLAMA_URL: "http://example.com:11434" })).toBeNull();
    expect(newsAiConfig({ ATLAS_NEWS_AI: "anthropic" })).toBeNull();
    expect(newsAiConfig({ ATLAS_NEWS_AI: "anthropic", ANTHROPIC_API_KEY: "k" })).toMatchObject({ kind: "anthropic", model: "claude-haiku-5-5" });
  });

  it("keeps only the team's tickers and the market, once each", () => {
    const text = '```json\n{"readings":[{"ticker":"petr4","direction":"UP","why":"petróleo sobe"},{"ticker":"AAPL","direction":"DOWN","why":"x"},{"ticker":"*","direction":"WATCH","why":"juros"},{"ticker":"PETR4","direction":"DOWN","why":"dup"}]}\n```';
    expect(parseNewsAi(text, ["PETR4", "VALE3"])).toEqual([
      { ticker: "PETR4", direction: "UP", why: "petróleo sobe" }, { ticker: "*", direction: "WATCH", why: "juros" }]);
  });

  it("rejects malformed answers and quotes the headline safely", () => {
    expect(() => parseNewsAi("não sei", ["PETR4"])).toThrow();
    expect(() => parseNewsAi('{"readings":[{"ticker":"PETR4","direction":"MAYBE","why":""}]}', ["PETR4"])).toThrow();
    expect(newsAiPrompt('Petrobras "dispara"', [{ ticker: "PETR4", name: "Petrobras" }])).toContain("Petrobras 'dispara'");
  });
});
