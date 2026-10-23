import { describe, expect, it, vi } from "vitest";
import { tickLocalScheduler, tickNewsAi, validateLocalConfiguration } from "../scripts/run-local.mjs";

const configured = { ATLAS_APP_URL: "http://127.0.0.1:3000", LIVE_TRADING_ENABLED: "false", SESSION_COOKIE_SECURE: "false", CRON_SECRET: "x".repeat(40), SUPABASE_URL: "configured", SUPABASE_PUBLISHABLE_KEY: "configured", SUPABASE_SERVICE_ROLE_KEY: "configured", ATLAS_OWNER_ID: "configured" };
describe("local scheduler boundaries", () => {
  it("requires the exact local origin, explicit non-live mode and server credentials", () => {
    expect(validateLocalConfiguration(configured)).toEqual(configured);
    expect(validateLocalConfiguration({ ...configured, LIVE_TRADING_ENABLED: "true" })).toBeTruthy();
    for (const change of [{ ATLAS_APP_URL: "https://other.example" }, { ATLAS_APP_URL: "http://127.0.0.1:3000/redirect" }, { LIVE_TRADING_ENABLED: "yes" }, { LIVE_TRADING_ENABLED: undefined }, { CRON_SECRET: "short" }, { SUPABASE_SERVICE_ROLE_KEY: "" }, { SESSION_COOKIE_SECURE: "true" }]) {
      expect(() => validateLocalConfiguration({ ...configured, ...change })).toThrow();
    }
  });
  it("sends the secret only in a local authenticated request and logs only counts", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [{ status: "SUCCEEDED", private: "never logged" }, { status: "FAILED", code: "provider secret" }] })));
    const result = await tickLocalScheduler(configured.CRON_SECRET, new AbortController().signal, transport);
    expect(result).toEqual({ status: "OK", completed: 1, failed: 1 });
    expect(transport).toHaveBeenCalledWith("http://127.0.0.1:3000/api/cron", expect.objectContaining({ method: "POST", redirect: "error", headers: { authorization: `Bearer ${configured.CRON_SECRET}` } }));
  });
  it("does not propagate provider error details or invalid job output", async () => {
    const signal = new AbortController().signal;
    expect(await tickLocalScheduler("secret", signal, vi.fn().mockRejectedValue(new Error("private token")))).toEqual({ status: "UNAVAILABLE" });
    expect(await tickLocalScheduler("secret", signal, vi.fn().mockResolvedValue(new Response("private", { status: 503 })))).toEqual({ status: "HTTP_ERROR", httpStatus: 503 });
    expect(await tickLocalScheduler("secret", signal, vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [{ status: "PRIVATE" }] }))))).toEqual({ status: "INVALID_RESPONSE" });
  });
  it("reports cancellation and duplicate ticks without new work", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await tickLocalScheduler("secret", controller.signal, vi.fn().mockRejectedValue(new Error("aborted")))).toEqual({ status: "STOPPED" });
    expect(await tickLocalScheduler("secret", new AbortController().signal, vi.fn().mockResolvedValue(new Response(JSON.stringify({ skipped: "RECENT_TICK", jobs: [] }))))).toEqual({ status: "RECENT_TICK", completed: 0, failed: 0 });
  });
  it("asks the local AI worker for one headline and returns only its status", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "READ", tags: 2, title: "never logged" })));
    expect(await tickNewsAi("secret", new AbortController().signal, transport)).toEqual({ status: "READ" });
    expect(transport.mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/news-ai");
    expect(await tickNewsAi("secret", new AbortController().signal, vi.fn().mockResolvedValue(new Response("{}")))).toEqual({ status: "INVALID_RESPONSE" });
  });
});
