import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sendEmail } from "@/lib/notify";

afterEach(() => vi.unstubAllEnvs());

describe("e-mail notifications (Resend)", () => {
  it("stays silent without a key or a valid address", async () => {
    const send = vi.fn<typeof fetch>();
    expect(await sendEmail("x", "y", send)).toBe(false);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ATLAS_ALERT_EMAIL", "not-an-email");
    expect(await sendEmail("x", "y", send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("sends one e-mail to the owner, escaping the text", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ATLAS_ALERT_EMAIL", "dono@example.com");
    const send = vi.fn<typeof fetch>(async () => new Response("{}"));
    expect(await sendEmail("ATLAS ✅ Compra executada", "Ana comprou 1 ITUB4 <R$ 48,52>", send)).toBe(true);
    const [url, init] = send.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect(body).toMatchObject({ to: ["dono@example.com"], subject: "ATLAS ✅ Compra executada" });
    expect(body.html).toContain("&lt;R$ 48,52&gt;");
  });
  it("never throws when the e-mail service is down", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ATLAS_ALERT_EMAIL", "dono@example.com");
    expect(await sendEmail("x", "y", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")))).toBe(false);
  });
});

describe("WhatsApp notifications (CallMeBot)", () => {
  it("stays silent without the owner's number and key", async () => {
    const { sendWhatsApp } = await import("@/lib/notify");
    const send = vi.fn<typeof fetch>();
    expect(await sendWhatsApp("x", send)).toBe(false);
    vi.stubEnv("CALLMEBOT_PHONE", "not-a-phone"); vi.stubEnv("CALLMEBOT_APIKEY", "123");
    expect(await sendWhatsApp("x", send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("sends the text to the owner's number", async () => {
    const { sendWhatsApp } = await import("@/lib/notify");
    vi.stubEnv("CALLMEBOT_PHONE", "+5511999990000"); vi.stubEnv("CALLMEBOT_APIKEY", "123456");
    const send = vi.fn<typeof fetch>(async () => new Response("ok"));
    expect(await sendWhatsApp("ATLAS: Ana comprou 1 ITUB4", send)).toBe(true);
    const url = new URL(String(send.mock.calls[0][0]));
    expect([url.host, url.searchParams.get("phone"), url.searchParams.get("text")]).toEqual(["api.callmebot.com", "+5511999990000", "ATLAS: Ana comprou 1 ITUB4"]);
  });
});
