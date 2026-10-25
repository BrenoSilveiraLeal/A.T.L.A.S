import "server-only";
import { adminClient } from "./supabase";
import { sendAlert } from "./alerts";

/**
 * Owner notifications (25/10/2026: "qualquer atualização tem que chegar pelo e-mail"): every
 * event is saved for the bell in the app and e-mailed through Resend (RESEND_API_KEY, to
 * ATLAS_ALERT_EMAIL), plus Telegram when configured. Never throws: a failed notification must
 * not change an analysis, an order or a reconciliation. Messages carry no credentials or account
 * numbers. `dedupeKey` + `windowSeconds` silence repeats of the same event.
 */
export type NotifyLevel = "info" | "success" | "warning" | "error";
export interface Notice { level: NotifyLevel; title: string; lines?: readonly string[]; dedupeKey?: string; windowSeconds?: number }

const ICON: Record<NotifyLevel, string> = { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌" };

export async function sendEmail(subject: string, text: string, transport: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY, to = process.env.ATLAS_ALERT_EMAIL;
  if (!key || !to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return false;
  try {
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5"><p>${text.split("\n").map((l) => l.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)).join("<br>")}</p>
<p style="color:#888;font-size:12px">ATLAS · avisos automáticos. Abra o ATLAS para ver os detalhes.</p></div>`;
    const response = await transport("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, redirect: "error",
      body: JSON.stringify({ from: process.env.ATLAS_EMAIL_FROM ?? "ATLAS <onboarding@resend.dev>", to: [to], subject: subject.slice(0, 180), text, html }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function notify(notice: Notice): Promise<void> {
  try {
    const db = adminClient(), owner = process.env.ATLAS_OWNER_ID;
    if (!owner) return;
    if (notice.dedupeKey) {
      const allowed = await db.rpc("consume_rate_limit", { p_key: `notify:${notice.dedupeKey}`.slice(0, 200), p_limit: 1, p_window_seconds: notice.windowSeconds ?? 3600 });
      if (allowed.error || !allowed.data) return;
    }
    const body = (notice.lines ?? []).join("\n");
    const emailed = await sendEmail(`ATLAS ${ICON[notice.level]} ${notice.title}`, [notice.title, body].filter(Boolean).join("\n\n"));
    await db.from("notifications").insert({ owner_id: owner, level: notice.level, title: notice.title.slice(0, 160), body: body.slice(0, 2000), emailed });
    await sendAlert([notice.title, ...(notice.lines ?? [])]);
  } catch { /* notifications never break the caller */ }
}
