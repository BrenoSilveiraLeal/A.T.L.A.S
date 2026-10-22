import "server-only";

/**
 * Owner notifications through a private Telegram bot. Disabled unless both
 * TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are configured. Never throws: an alert
 * failure must not change the outcome of an analysis, order or reconciliation.
 * Messages carry no credentials, account numbers or balances.
 */
export async function sendAlert(lines: readonly string[], transport: typeof fetch = fetch): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || !lines.length || !/^\d+:[\w-]{20,}$/.test(token) || !/^-?\d{1,20}$/.test(chat)) return false;
  try {
    const response = await transport(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
      body: JSON.stringify({ chat_id: chat, text: ["ATLAS", ...lines].join("\n").slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
