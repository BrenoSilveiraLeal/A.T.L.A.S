import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, requireOwner } from "@/lib/auth";
import { checkOrigin, checkCron, readBody } from "@/lib/http";
import { riskConfigSchema } from "@/lib/risk-config";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ sessionClient: async () => ({ auth }) }));

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-only-public-key");
  vi.stubEnv("ATLAS_OWNER_ID", "owner-fixture");
  vi.stubEnv("ATLAS_APP_URL", "https://atlas.example.test");
  vi.stubEnv("CRON_SECRET", "test-only-cron-secret");
  auth.getUser.mockResolvedValue({
    data: { user: { id: "owner-fixture" } },
    error: null,
  });
  auth.getClaims.mockResolvedValue({
    data: { claims: { aal: "aal2" } },
    error: null,
  });
});
describe("server trust boundaries", () => {
  it("rejects an anonymous/expired token before accessing data", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("expired"),
    });
    await expect(requireOwner()).rejects.toMatchObject({ status: 401 });
  });
  it("rejects another valid Supabase user", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { id: "outsider" } },
      error: null,
    });
    await expect(requireOwner()).rejects.toMatchObject({ status: 403 });
  });
  it("rejects AAL1 for data and mutations, permits it only for MFA setup", async () => {
    auth.getClaims.mockResolvedValue({
      data: { claims: { aal: "aal1" } },
      error: null,
    });
    await expect(requireOwner()).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await expect(requireOwner(false)).resolves.toHaveProperty(
      "user.id",
      "owner-fixture",
    );
  });
  it("fails closed when signature validation fails or configuration is absent", async () => {
    auth.getClaims.mockResolvedValue({
      data: null,
      error: new Error("invalid signature"),
    });
    await expect(requireOwner()).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("ATLAS_OWNER_ID", "");
    await expect(requireOwner()).rejects.toMatchObject({ status: 503 });
  });
  it("rejects missing and foreign CSRF origins", () => {
    expect(() =>
      checkOrigin(new Request("https://atlas.example.test/api/atlas/kill")),
    ).toThrow(ApiError);
    expect(() =>
      checkOrigin(
        new Request("https://atlas.example.test/api/atlas/kill", {
          headers: { origin: "https://attacker.test" },
        }),
      ),
    ).toThrow(ApiError);
    expect(() =>
      checkOrigin(
        new Request("https://atlas.example.test/api/atlas/kill", {
          headers: { origin: "https://atlas.example.test" },
        }),
      ),
    ).not.toThrow();
  });
  it("requires the exact cron bearer secret and cannot use an empty secret", () => {
    expect(() =>
      checkCron(new Request("https://atlas.example.test/api/cron")),
    ).toThrow();
    expect(() =>
      checkCron(
        new Request("https://atlas.example.test/api/cron", {
          headers: { authorization: "Bearer test-only-cron-secret" },
        }),
      ),
    ).not.toThrow();
    vi.stubEnv("CRON_SECRET", "");
    expect(() =>
      checkCron(
        new Request("https://atlas.example.test/api/cron", {
          headers: { authorization: "Bearer " },
        }),
      ),
    ).toThrow();
  });
  it("enforces streamed request size, JSON content type and valid JSON", async () => {
    const request = (body: string, contentType = "application/json") =>
      new Request("https://atlas.example.test", {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
    await expect(readBody(request("x".repeat(17000)))).rejects.toMatchObject({
      status: 413,
    });
    await expect(readBody(request("{}", "text/plain"))).rejects.toMatchObject({
      status: 415,
    });
    await expect(readBody(request("bad-json"))).rejects.toMatchObject({
      status: 400,
    });
    await expect(readBody(request('{"ok":true}'))).resolves.toEqual({
      ok: true,
    });
  });
  it("does not accept partial risk profiles or money supplied as floating point", () => {
    expect(
      riskConfigSchema.safeParse({ name: "Test", limits: {} }).success,
    ).toBe(false);
    expect(
      riskConfigSchema.safeParse({
        name: "Test",
        limits: { maxOrderValue: 100.25 },
      }).success,
    ).toBe(false);
  });
});
