import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/setup/route";

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  mfa: { listFactors: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({ sessionClient: async () => ({ auth }) }));

const tokenHash = "a".repeat(64);
const password = "Only a test fixture password 42";
const ownerId = "05e31ddb-c1c1-41a3-a025-508c19497652";

function request(body: unknown = { tokenHash, password }, origin = "https://atlas.example.test") {
  return new Request("https://atlas.example.test/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-only-public-key");
  vi.stubEnv("ATLAS_OWNER_ID", ownerId);
  vi.stubEnv("ATLAS_APP_URL", "https://atlas.example.test");
  auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "fixture" }, user: { id: ownerId } }, error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
  auth.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [], phone: [] }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: { id: ownerId } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe("owner first-access endpoint", () => {
  it("defines a password only after recovery and owner verification, then closes the temporary session", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, next: "login" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "recovery" });
    expect(auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0]);
    expect(auth.mfa.listFactors.mock.invocationCallOrder[0]).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0]);
    expect(auth.updateUser).toHaveBeenCalledWith({ password });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("rejects foreign origins before consuming the single-use link", async () => {
    const response = await POST(request(undefined, "https://attacker.example.test"));
    expect(response.status).toBe(403);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it.each([
    { password },
    { tokenHash, password: "short" },
    { tokenHash, password: " ".repeat(20) },
    { tokenHash, password: "p".repeat(129) },
    { tokenHash: "malformed hash", password },
    { tokenHash, password, ownerId: "someone-else" },
  ])("rejects an invalid request without consuming a token: %j", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects missing owner configuration before authentication", async () => {
    vi.stubEnv("ATLAS_OWNER_ID", "");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("does not accept a signed-in cookie in place of a valid recovery token", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: new Error("expired token with private detail") });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private detail");
  });

  it("rejects a different authenticated user and clears the recovery session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "other-user" } }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("checks the recovered user identity as well as the server-validated session", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "fixture" }, user: { id: "other-user" } }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it.each(["totp", "phone", "webauthn"])("never resets an existing %s-protected owner through first setup", async (factorType) => {
    auth.mfa.listFactors.mockResolvedValue({ data: { all: [{ factor_type: factorType, status: "verified" }] }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("SETUP_ALREADY_PROTECTED");
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("permits initial setup with an incomplete, unverified factor", async () => {
    auth.mfa.listFactors.mockResolvedValue({ data: { all: [{ factor_type: "totp", status: "unverified" }] }, error: null });
    expect((await POST(request())).status).toBe(200);
  });

  it("fails closed when MFA status cannot be established", async () => {
    auth.mfa.listFactors.mockResolvedValue({ data: null, error: new Error("unavailable") });
    expect((await POST(request())).status).toBe(503);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("does not expose provider errors, password or token in the response", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error(`${password} ${tokenHash} private provider error`) });
    const response = await POST(request());
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain(password);
    expect(body).not.toContain(tokenHash);
    expect(body).not.toContain("private provider error");
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("does not report success when the temporary session cannot be closed", async () => {
    auth.signOut.mockResolvedValue({ error: new Error("unavailable") });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("SETUP_SESSION_END_FAILED");
  });
});
