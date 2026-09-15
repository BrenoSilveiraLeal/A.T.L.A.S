import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cached } from "@/lib/data";

const mocks = vi.hoisted(() => ({
  found: vi.fn(),
  rpc: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  adminClient: () => ({
    rpc: mocks.rpc,
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: mocks.found,
        upsert: mocks.upsert,
      };
      return query;
    },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T15:00:00Z"));
  vi.stubEnv("ATLAS_OWNER_ID", "owner-test-only");
  mocks.found.mockResolvedValue({ data: null, error: null });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const options = [
  "brapi",
  "QUOTE:TEST3",
  60000,
  "https://example.test/cache",
] as const;

it("reuses a fresh durable cache without consuming provider allowance", async () => {
  const payload = { value: "existing-only-test-fixture" };
  mocks.found.mockResolvedValue({
    data: { payload, retrieved_at: "2026-09-14T14:59:59Z" },
    error: null,
  });
  const fetcher = vi.fn();
  expect(await cached(...options, fetcher)).toEqual(payload);
  expect(fetcher).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it.each(["2026-09-14T14:59:00Z", "2026-09-14T15:01:00Z", "invalid"])(
  "refreshes expired/future/invalid cache retrieval time %s using a singleton upsert",
  async (retrievedAt) => {
    mocks.found.mockResolvedValue({
      data: { payload: { old: true }, retrieved_at: retrievedAt },
      error: null,
    });
    const payload = { refreshed: true };
    expect(await cached(...options, async () => payload)).toEqual(payload);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: "owner-test-only",
        provider: "brapi",
        ticker: "QUOTE:TEST3",
        data_kind: "READ_CACHE_V1",
        provider_timestamp: null,
        payload,
        retrieved_at: "2026-09-14T15:00:00.000Z",
      }),
      { onConflict: "owner_id,provider,ticker,data_kind,provider_timestamp" },
    );
  },
);

it("does not fetch or save once the distributed provider allowance is exhausted", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  const fetcher = vi.fn();
  await expect(cached(...options, fetcher)).rejects.toMatchObject({
    code: "DATA_BUDGET_EXHAUSTED",
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it("does not persist a failed provider request", async () => {
  await expect(
    cached(...options, async () => {
      throw new Error("SOURCE_UNAVAILABLE");
    }),
  ).rejects.toThrow("SOURCE_UNAVAILABLE");
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it("reserves the smaller CVM logical request quota on cache misses", async () => {
  await cached(
    "cvm",
    "DFP:TEST",
    7 * 86400000,
    "https://dados.cvm.gov.br/",
    async () => ({}),
  );
  expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
    p_key: "provider:cvm:2026-09-14",
    p_limit: 4,
    p_window_seconds: 86400,
  });
});
