import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAlert } from "@/lib/alerts";

const token = "123456:test-only-token-abcdefghijklmnop";
afterEach(() => vi.unstubAllEnvs());

describe("owner Telegram alerts", () => {
  it("stays silent until both bot token and chat are configured", async () => {
    const send = vi.fn<typeof fetch>();
    expect(await sendAlert(["x"], send)).toBe(false);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
    expect(await sendAlert(["x"], send)).toBe(false);
    vi.stubEnv("TELEGRAM_CHAT_ID", "not-a-chat");
    expect(await sendAlert(["x"], send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("posts one message to the configured chat", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
    vi.stubEnv("TELEGRAM_CHAT_ID", "987654");
    const send = vi.fn<typeof fetch>(async () => new Response("{}"));
    expect(await sendAlert(["Maria (PETR4): compra virtual"], send)).toBe(true);
    const [url, init] = send.mock.calls[0];
    expect(String(url)).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ chat_id: "987654", text: "ATLAS\nMaria (PETR4): compra virtual" });
  });

  it("never throws when Telegram is unavailable", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
    vi.stubEnv("TELEGRAM_CHAT_ID", "987654");
    expect(await sendAlert(["x"], vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")))).toBe(false);
    expect(await sendAlert(["x"], vi.fn<typeof fetch>(async () => new Response("", { status: 500 })))).toBe(false);
  });
});
