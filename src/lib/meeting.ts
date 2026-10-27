import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { meetingDue, meetingMinutes, type MeetingAgent, type Minutes } from "@/core/meeting";
import { agentLevels } from "./levels";
import { loadLive } from "./live-view";
import { loadPrices } from "./prices";
import { notify, sendWhatsApp } from "./notify";

/**
 * Holds the end-of-day team meeting once per trading day after the close (core/meeting.ts) with
 * real data: Genial positions and cash, B3 closes, analysts' consensus. Saves the minutes and tells
 * the owner (bell and e-mail). Returns null when it is not time or it was already held.
 */
export async function holdTeamMeeting(db: SupabaseClient, owner: string, now = new Date()): Promise<Minutes | null> {
  const { due, day } = meetingDue(now);
  if (!due) return null;
  const done = await db.from("team_meetings").select("id").eq("owner_id", owner).eq("day", day).maybeSingle();
  if (done.error || done.data) return null;
  const [agents, assets, live, prices] = await Promise.all([
    db.from("agents").select("id,name,status,asset_id").eq("owner_id", owner).order("created_at"),
    db.from("assets").select("id,ticker").eq("owner_id", owner),
    loadLive(db, owner),
    loadPrices(db, owner).catch(() => ({ prices: {} as Record<string, { price: number }> })),
  ]);
  if (agents.error || assets.error) return null;
  // The day's real fills, for the supervisor's report and for each agent to tell what it did.
  const since = new Date(`${day}T00:00:00-03:00`).toISOString();
  const [analyses, fills] = await Promise.all([
    db.from("decisions").select("id", { count: "exact", head: true }).eq("owner_id", owner).gte("created_at", since),
    db.from("live_fills").select("agent_id,side,quantity,price,fee").eq("owner_id", owner).gte("executed_at", since),
  ]);
  const team: MeetingAgent[] = [];
  for (const agent of agents.data.filter((a) => !["DEAD", "FIRED"].includes(String(a.status)))) {
    const ticker = String(assets.data.find((a) => a.id === agent.asset_id)?.ticker ?? "");
    if (!ticker) continue;
    const levels = await agentLevels(db, ticker).catch(() => null);
    const position = (live.positions ?? []).find((p) => p.agent_id === agent.id && p.ticker === ticker);
    const ready = levels?.available ? levels : null;
    const price = prices.prices[ticker]?.price ?? Number(ready?.lastClose ?? 0);
    if (!(price > 0)) continue;
    team.push({ agentId: String(agent.id), name: String(agent.name), ticker, price,
      closes: ready?.turnCloses ?? [], holding: Number(position?.quantity ?? 0), cost: Number(position?.cost ?? 0),
      range: ready?.range ?? null, history: ready?.history ?? null, consensus: ready?.consensus ?? null,
      trades: (fills.data ?? []).filter((f) => f.agent_id === agent.id).map((f) => {
        const quantity = Number(f.quantity), price = Number(f.price), fee = Number(f.fee ?? 0);
        return { side: f.side as "BUY" | "SELL", quantity, price, value: f.side === "BUY" ? quantity * price + fee : quantity * price - fee };
      }) });
  }
  if (!team.length) return null;
  const minutes = meetingMinutes(day, team, { deposited: live.genial.deposited, free: live.genial.free, analyses: analyses.count ?? 0,
    buys: (fills.data ?? []).filter((f) => f.side === "BUY").length, sells: (fills.data ?? []).filter((f) => f.side === "SELL").length });
  const saved = await db.from("team_meetings").insert({ owner_id: owner, day, lines: minutes.lines, summary: minutes.summary,
    lessons: minutes.lessons, suggestions: minutes.suggestions });
  if (saved.error) return null; // another runner held it first
  // Full minutes by e-mail and in the bell; the phone gets the short version.
  await notify({ level: "info", whatsapp: false, email: true, title: `Reunião de fim de dia (${day.split("-").reverse().join("/")})`,
    lines: [...minutes.summary, "", "O que aprendemos:", ...minutes.lessons, ...(minutes.suggestions.length ? ["", "Sugestões para você:", ...minutes.suggestions] : []),
      "", "O que cada IA disse:", ...minutes.lines.map((l) => `${l.name}: ${l.text}`)] });
  await sendWhatsApp([`*ATLAS ℹ️ Reunião de fim de dia (${day.split("-").reverse().join("/")})*`, ...minutes.summary, ...minutes.lessons,
    ...minutes.suggestions.slice(0, 2)].join("\n"));
  return minutes;
}

/** Latest meetings, newest first (office screen and history). */
export async function recentMeetings(db: SupabaseClient, owner: string, limit = 5) {
  const result = await db.from("team_meetings").select("day,lines,summary,lessons,suggestions,created_at").eq("owner_id", owner)
    .order("day", { ascending: false }).limit(limit);
  if (result.error) throw new Error("MEETINGS_UNAVAILABLE");
  return result.data as (Omit<Minutes, "day"> & { day: string; created_at: string })[];
}
