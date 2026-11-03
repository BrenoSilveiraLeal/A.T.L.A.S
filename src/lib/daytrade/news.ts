import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headlineTone } from "@/core/context";
import type { MarketEvent, NewsSnapshot } from "@/core/daytrade/agents";
import { fetchBcbNews } from "@/providers/bcb-news";
import type { Headline } from "@/providers/gdelt";
import { enabledMarketFeeds, fetchRss } from "@/providers/rss";
import { softCached } from "@/lib/context";

const MINUTE = 60_000;
const FRESH_MS = 15 * MINUTE;
const HEADLINE_IMPACT_WINDOW_MS = 60 * MINUTE;
const CALENDAR_TTL_MS = 10 * MINUTE;
const NEWS_TTL_MS = 2 * MINUTE;

const BCB_CALENDARS = [
  { key: "copom-meetings", label: "BCB Copom meetings", lista: "Reuniões do Copom" },
  { key: "copom-releases", label: "BCB Copom releases", lista: "Atas e Comunicados do Copom" },
  { key: "macro-statistics", label: "BCB macroeconomic releases", lista: "Estatísticas macroeconômicas" },
  { key: "focus", label: "BCB Focus releases", lista: "Focus" },
  { key: "events", label: "BCB events", lista: null },
] as const;

interface IcsEvent { title: string; start: string; allDay: boolean }
interface CachedSource<T> { key: string; label: string; payload: T | null; retrievedAt: string | null }

const unescapeIcs = (value: string) => value.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function parseIcsDate(value: string, property: string): { at: string; allDay: boolean } | null {
  const dateOnly = /(?:^|;)VALUE=DATE(?:;|$)/i.test(property) || /^\d{8}$/.test(value);
  if (dateOnly) {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!match) return null;
    return { at: `${match[1]}-${match[2]}-${match[3]}T09:00:00-03:00`, allDay: true };
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${utc ? "Z" : "-03:00"}`;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return { at: new Date(time).toISOString(), allDay: false };
}

/** Small, strict parser for the BCB's public VCALENDAR feeds; malformed events are discarded. */
export function parseBcbIcs(input: string): IcsEvent[] {
  if (input.length > 2 * 1024 * 1024 || !/BEGIN:VCALENDAR/.test(input) || !/END:VCALENDAR/.test(input))
    throw new Error("BCB ICS response is invalid or oversized.");
  const unfolded = input.replace(/\r?\n[ \t]/g, "");
  const events: IcsEvent[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const contents = block.split("END:VEVENT", 1)[0];
    const fields = new Map<string, { property: string; value: string }>();
    for (const line of contents.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon < 1) continue;
      const property = line.slice(0, colon), key = property.split(";", 1)[0].toUpperCase();
      if (["SUMMARY", "DTSTART", "DTEND"].includes(key) && !fields.has(key))
        fields.set(key, { property, value: line.slice(colon + 1) });
    }
    const summary = fields.get("SUMMARY"), start = fields.get("DTSTART");
    // Do not silently drop one malformed event while treating the rest of the
    // calendar as complete: that could hide a market-moving release.
    if (!summary || !unescapeIcs(summary.value) || !start)
      throw new Error("BCB ICS feed contained an incomplete event.");
    const parsed = parseIcsDate(start.value, start.property);
    if (!parsed) throw new Error("BCB ICS feed contained an invalid event date.");
    const end = fields.get("DTEND");
    const sameMidnight = !parsed.allDay && /T000000(?:Z)?$/.test(start.value) &&
      (!end || end.value.slice(0, 8) === start.value.slice(0, 8));
    events.push({ title: unescapeIcs(summary.value), start: parsed.at, allDay: parsed.allDay || sameMidnight });
  }
  // A structurally valid VCALENDAR with no VEVENT blocks is a complete empty
  // agenda. If VEVENT blocks exist but none can be parsed, treat the source as
  // malformed so the news gate remains closed.
  if (!events.length && /BEGIN:VEVENT/.test(input)) throw new Error("BCB ICS feed contained no valid events.");
  return events;
}

async function fetchIcs(url: string): Promise<IcsEvent[]> {
  const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": "ATLAS DASH market calendar/1.0" } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`BCB calendar returned ${response.status}.`);
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > 2 * 1024 * 1024) {
    await response.body?.cancel();
    throw new Error("BCB calendar response is oversized.");
  }
  if (!response.body) throw new Error("BCB calendar response body is empty.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("BCB calendar response is oversized.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return parseBcbIcs(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

async function readCachedSource<T>(db: SupabaseClient, ownerId: string, provider: string, key: string,
  label: string, fetcher: () => Promise<T>, ttlMs: number, dailyLimit: number, url: string, refresh: boolean): Promise<CachedSource<T>> {
  const cacheKey = `${provider}:${key}`;
  try {
    const payload = refresh ? await softCached(provider, key, ttlMs, FRESH_MS, dailyLimit, url, fetcher, async () => true, 120) : null;
    const row = await db.from("market_data_cache").select("payload,retrieved_at").eq("owner_id", ownerId)
      .eq("provider", provider).eq("ticker", key).eq("data_kind", "READ_CACHE_V1")
      .order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
    return { key: cacheKey, label, payload: refresh ? payload : row.data?.payload ?? null, retrievedAt: row.error ? null : row.data?.retrieved_at ?? null };
  } catch {
    return { key: cacheKey, label, payload: null, retrievedAt: null };
  }
}

function localDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function eventIsRelevant(event: IcsEvent, now: string): boolean {
  const eventMs = Date.parse(event.start), nowMs = Date.parse(now);
  if (!Number.isFinite(eventMs) || !Number.isFinite(nowMs)) return false;
  if (event.allDay) return localDate(event.start) === localDate(now);
  return Math.abs(eventMs - nowMs) <= 45 * MINUTE;
}

function headlineEvents(source: CachedSource<Headline[]>, now: string, maxAge: number): MarketEvent[] {
  if (!Array.isArray(source.payload) || !source.retrievedAt) return [];
  const received = Date.parse(source.retrievedAt), nowMs = Date.parse(now);
  if (!Number.isFinite(received) || !Number.isFinite(nowMs) || nowMs - received < 0 || nowMs - received > maxAge) return [];
  return source.payload.flatMap((headline) => {
    const at = Date.parse(headline.seenAt);
    if (!headline.title || !/^https:\/\//.test(headline.url) || !Number.isFinite(at) || nowMs - at < 0 || nowMs - at > HEADLINE_IMPACT_WINDOW_MS) return [];
    const tone = headlineTone(headline.title);
    const impact = tone.severe || tone.stress ? "HIGH" : tone.tone === "DOWN" ? "MEDIUM" : "LOW";
    return [{ kind: "NEWS" as const, title: headline.title.slice(0, 300), at: new Date(at).toISOString(), impact,
      provenance: { source: source.label, receivedAt: new Date(received).toISOString(), delayMs: nowMs - received, simulated: false } }];
  });
}

/**
 * Builds a bounded, source-auditable gate from the official BCB calendars and the
 * existing BCB/InfoMoney news feeds. `complete` means every configured feed is fresh;
 * it does not claim that these feeds contain every market event or headline worldwide.
 */
export async function loadDashNewsSnapshot(db: SupabaseClient, ownerId: string, refresh = false) {
  const calendars = BCB_CALENDARS.map((feed) => {
    const url = feed.lista
      ? `https://www.bcb.gov.br/api/exportarics/sitebcb/agendaics?lista=${encodeURIComponent(feed.lista)}`
      : "https://www.bcb.gov.br/api/exportarics/sitebcb/eventosics";
    return readCachedSource(db, ownerId, "daytrade-bcb-calendar", feed.key, feed.label,
      () => fetchIcs(url), CALENDAR_TTL_MS, 600, url, refresh);
  });
  const headlines = [
    readCachedSource(db, ownerId, "daytrade-bcb-news", "atom", "Banco Central",
      fetchBcbNews, NEWS_TTL_MS, 1500, "https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/noticias", refresh),
    ...enabledMarketFeeds().map((feed) => readCachedSource(db, ownerId, "daytrade-market-news", feed.provider, feed.provider,
      () => fetchRss(feed), NEWS_TTL_MS, 1500, feed.url, refresh)),
  ];
  const [calendarSources, newsSources] = await Promise.all([
    Promise.all(calendars), Promise.all(headlines),
  ]);
  const now = new Date().toISOString();
  const sources = [...calendarSources, ...newsSources];
  const nowMs = Date.parse(now);
  const unavailable = sources.filter((source) => {
    const age = source.retrievedAt ? nowMs - Date.parse(source.retrievedAt) : Infinity;
    return !source.payload || !Number.isFinite(age) || age < 0 || age > FRESH_MS;
  }).map((source) => source.label);
  const provenance = (source: CachedSource<unknown>) => ({
    source: source.label, receivedAt: source.retrievedAt ?? "", delayMs: source.retrievedAt ? Math.max(0, nowMs - Date.parse(source.retrievedAt)) : Infinity,
    simulated: false,
  });
  const calendarEvents: MarketEvent[] = calendarSources.flatMap((source) => {
    if (!Array.isArray(source.payload) || !source.retrievedAt) return [];
    return (source.payload as IcsEvent[]).filter((event) => eventIsRelevant(event, now)).map((event) => ({
      kind: "CALENDAR" as const, title: event.title.slice(0, 300), at: event.start, impact: "HIGH" as const,
      provenance: provenance(source),
    }));
  });
  const newsEvents = newsSources.flatMap((source) => headlineEvents(source as CachedSource<Headline[]>, now, FRESH_MS));
  const freshTimes = sources.flatMap((source) => source.retrievedAt ? [Date.parse(source.retrievedAt)] : []);
  const refreshedAt = freshTimes.length === sources.length && freshTimes.length
    ? new Date(Math.min(...freshTimes)).toISOString() : "";
  const sourceNames = sources.map((source) => source.label).join(", ");
  const snapshot: NewsSnapshot = {
    events: [...calendarEvents, ...newsEvents], complete: unavailable.length === 0,
    source: sourceNames, refreshedAt,
  };
  return { snapshot, unavailable, assessedAt: now };
}
