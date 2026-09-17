import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/executor", () => ({ runExecutor: vi.fn(async () => ({ status: "UNCONFIGURED", dispatched: 0 })) }));
import { POST } from "@/app/api/executor/route";
import { runExecutor } from "@/lib/executor";
// Plain Node worker is intentionally framework independent.
import { executorEndpoint, tickExecutor } from "../scripts/run-executor.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const secret = "test-only-" + "x".repeat(40);
describe("Executor server-to-server boundary", () => {
  it("denies absent/wrong/short secret before touching the runtime", async () => {
    for (const configured of [undefined, "short", secret]) {
      vi.stubEnv("EXECUTOR_SECRET", configured);
      expect((await POST(new Request("http://localhost/api/executor", { method: "POST" }))).status).toBe(401);
    }
    expect(runExecutor).not.toHaveBeenCalled();
  });
  it("rejects browser-origin calls even with the worker credential", async () => {
    vi.stubEnv("EXECUTOR_SECRET", secret);
    const response = await POST(new Request("http://localhost/api/executor", { method: "POST", headers: { authorization: `Bearer ${secret}`, origin: "http://localhost" } }));
    expect(response.status).toBe(403); expect(runExecutor).not.toHaveBeenCalled();
  });
  it("accepts only authenticated ticks and never receives commands or risk flags", async () => {
    vi.stubEnv("EXECUTOR_SECRET", secret);
    const response = await POST(new Request("http://localhost/api/executor", { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: '{"liveTradingEnabled":true}' }));
    expect(await response.json()).toEqual({ status: "UNCONFIGURED", dispatched: 0 });
    expect(runExecutor).toHaveBeenCalledExactlyOnceWith();
  });
});
describe("Executor worker", () => {
  const env = { ATLAS_APP_URL: "http://127.0.0.1:3000", EXECUTOR_SECRET: secret };
  it("pins its endpoint and refuses insecure remote credentials or URL parameters", () => {
    expect(executorEndpoint(env).href).toBe("http://127.0.0.1:3000/api/executor");
    for (const url of ["http://remote.test", "https://x:secret@remote.test", "https://remote.test/?secret=x", "https://remote.test/#x"])
      expect(() => executorEndpoint({ ...env, ATLAS_APP_URL: url })).toThrow();
  });
  it("does not retry network errors and outputs no gateway response fields", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("sensitive-provider-response"));
    expect(await tickExecutor(env, new AbortController().signal, transport)).toEqual({ status: "UNAVAILABLE" });
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValue(Response.json({ status: "BLOCKED", accountId: "private-account", privateData: "secret" }));
    expect(await tickExecutor(env, new AbortController().signal, transport)).toEqual({ status: "BLOCKED" });
  });
});
