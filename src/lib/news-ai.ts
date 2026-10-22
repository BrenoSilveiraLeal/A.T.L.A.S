import "server-only";
import { adminClient } from "./supabase";
import { required } from "./env";
import { resolveCompany } from "@/core/context";
import type { NewsTag } from "@/core/news";
import { NEWS_AI_SCHEMA, NEWS_AI_SYSTEM, newsAiConfig, newsAiPrompt, parseNewsAi, type NewsAiConfig } from "@/core/news-ai";

async function ask(config: NewsAiConfig, prompt: string, signal: AbortSignal): Promise<string> {
  if (config.kind === "ollama") {
    const response = await fetch(`${config.url}/api/chat`, { method: "POST", signal, redirect: "error",
      body: JSON.stringify({ model: config.model, stream: false, think: false, format: NEWS_AI_SCHEMA, options: { temperature: 0 },
        messages: [{ role: "system", content: NEWS_AI_SYSTEM }, { role: "user", content: prompt }] }) });
    if (!response.ok) throw new Error("NEWS_AI_UNAVAILABLE");
    return String(((await response.json()) as { message?: { content?: string } }).message?.content ?? "");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal, redirect: "error",
    headers: { "content-type": "application/json", "x-api-key": config.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: config.model, max_tokens: 400, temperature: 0, system: NEWS_AI_SYSTEM, messages: [{ role: "user", content: prompt }] }) });
  if (!response.ok) throw new Error("NEWS_AI_UNAVAILABLE");
  const body = (await response.json()) as { content?: { type: string; text?: string }[] };
  return body.content?.find((c) => c.type === "text")?.text ?? "";
}

/**
 * Reads one unread headline (priority below) with the configured model. One per call,
 * so a slow local model never delays the agents' analyses. Failed answers stay unread and are
 * retried later; a headline the model cannot parse three times is marked as unreadable.
 */
export async function readNextHeadline(timeoutMs = 180_000) {
  const config = newsAiConfig();
  if (!config) return { status: "DISABLED" as const };
  const db = adminClient(), owner = required("ATLAS_OWNER_ID");
  const [pending, assets] = await Promise.all([
    db.from("news_items").select("url,title,tags,published_at").eq("owner_id", owner).is("ai", null)
      .gte("published_at", new Date(Date.now() - 2 * 86400000).toISOString()).order("published_at", { ascending: false }).limit(40),
    db.from("assets").select("ticker,company_name").eq("owner_id", owner).eq("active", true),
  ]);
  if (pending.error || assets.error) throw new Error("NEWS_AI_DATABASE_UNAVAILABLE");
  // A slow local model cannot read everything: headlines the keyword rules already linked to
  // the team go first, then any headline from the last 12 hours, newest first.
  const fresh = Date.now() - 12 * 3600000;
  const next = pending.data.find((r) => (r.tags as NewsTag[]).length > 0) ?? pending.data.find((r) => Date.parse(r.published_at) >= fresh);
  if (!next) return { status: "IDLE" as const };
  const team = assets.data.map((a) => ({ ticker: a.ticker, name: resolveCompany(a.ticker, a.company_name, null).name }));
  const attempts = await db.rpc("consume_rate_limit", { p_key: `news-ai:${next.url}`.slice(0, 200), p_limit: 3, p_window_seconds: 86400 });
  let tags: NewsTag[];
  if (!attempts.error && attempts.data === false) tags = [];
  else {
    const text = await ask(config, newsAiPrompt(next.title, team), AbortSignal.timeout(timeoutMs));
    tags = parseNewsAi(text, team.map((t) => t.ticker));
  }
  const saved = await db.from("news_items").update({ ai: tags, ai_model: config.model.slice(0, 80), ai_at: new Date().toISOString() })
    .eq("owner_id", owner).eq("url", next.url).is("ai", null);
  if (saved.error) throw new Error("NEWS_AI_SAVE_FAILED");
  return { status: "READ" as const, tags: tags.length };
}
