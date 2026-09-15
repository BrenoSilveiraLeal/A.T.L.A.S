import { describe, expect, it, vi } from "vitest";
import { classifyAnonymousRead, createReadOnlyFetch, validatePortfolioEvidence } from "../scripts/verify-supabase.mjs";

describe("read-only remote verification boundaries", () => {
  it("rejects writes and credential forwarding to a different host before network access", async () => {
    const network = vi.fn();
    const safeFetch = createReadOnlyFetch("https://fixture.supabase.co", network);
    await expect(safeFetch("https://fixture.supabase.co/auth/v1/user", { method: "PUT" })).rejects.toThrow("READ_ONLY_REQUEST_REJECTED");
    await expect(safeFetch("https://other.supabase.co/rest/v1/system_state")).rejects.toThrow("READ_ONLY_REQUEST_REJECTED");
    expect(network).not.toHaveBeenCalled();
  });

  it("applies an abort deadline and refuses redirects even when requested otherwise", async () => {
    const network = vi.fn().mockResolvedValue(new Response("[]"));
    const safeFetch = createReadOnlyFetch("https://fixture.supabase.co", network);
    await safeFetch("https://fixture.supabase.co/rest/v1/system_state", { redirect: "follow" });
    expect(network.mock.calls[0][1].redirect).toBe("error");
    expect(network.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("distinguishes permission denial, empty visibility, leaks and unrelated failures", () => {
    expect(classifyAnonymousRead({ status: 401, error: { code: "42501" }, data: null })).toEqual({ ok: true, status: "PERMISSION_DENIED", visibleRows: 0 });
    expect(classifyAnonymousRead({ status: 200, error: null, data: [] }).status).toBe("EMPTY_NO_ROWS_VISIBLE");
    expect(classifyAnonymousRead({ status: 200, error: null, data: [{ id: "private" }] }).ok).toBe(false);
    expect(classifyAnonymousRead({ status: 404, error: { code: "42P01" }, data: null }).ok).toBe(false);
    expect(classifyAnonymousRead({ status: 503, error: { code: "unavailable" }, data: null }).ok).toBe(false);
  });

  it("requires a genuinely absent broker account for an empty onboarding portfolio", () => {
    const empty = { brokerAccounts: [], brokerAccountId: null, snapshots: [], positions: [], historyTruncated: false, positionsTruncated: false };
    expect(validatePortfolioEvidence(empty)).toMatchObject({ ok: true, status: "EMPTY_NO_BROKER_ACCOUNT", snapshotCount: 0 });
    expect(validatePortfolioEvidence({ ...empty, snapshots: [{ cash: "0" }] }).ok).toBe(false);
    expect(validatePortfolioEvidence({ ...empty, historyTruncated: true }).ok).toBe(false);
  });

  it("continues to accept real portfolio evidence after onboarding without requiring an empty database", () => {
    const data = { brokerAccounts: [{ id: "account" }], brokerAccountId: "account", snapshots: [{
      brokerAccountId: "account", reconciled: true, discrepancies: [], cash: "15.00", equity: "15.00",
      invested: "0", realizedPnl: null, unrealizedPnl: null,
    }], positions: [], historyTruncated: false, positionsTruncated: false };
    expect(validatePortfolioEvidence(data)).toMatchObject({ ok: true, accountCount: 1, snapshotCount: 1 });
    expect(validatePortfolioEvidence({ ...data, snapshots: [{ ...data.snapshots[0], cash: 15 }] }).ok).toBe(false);
    expect(validatePortfolioEvidence({ ...data, snapshots: [{ ...data.snapshots[0], brokerAccountId: "another" }] }).ok).toBe(false);
  });
});
