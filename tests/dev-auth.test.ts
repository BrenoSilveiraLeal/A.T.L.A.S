import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ host: "127.0.0.1:3000" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: request.host }) }));
import { localDevBypass } from "@/lib/auth";

afterEach(() => { vi.unstubAllEnvs(); request.host = "127.0.0.1:3000"; });
const local = () => {
  vi.stubEnv("ATLAS_DEV_AUTH_BYPASS", "true");
  vi.stubEnv("ATLAS_APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("VERCEL", "");
};

describe("local development login bypass", () => {
  it("applies only to the owner's own machine with the explicit flag", async () => {
    local();
    expect(await localDevBypass()).toBe(true);
  });

  it("never applies without the flag, on Vercel, or for a public origin", async () => {
    local(); vi.stubEnv("ATLAS_DEV_AUTH_BYPASS", "false");
    expect(await localDevBypass()).toBe(false);
    local(); vi.stubEnv("VERCEL", "1");
    expect(await localDevBypass()).toBe(false);
    local(); vi.stubEnv("ATLAS_APP_URL", "https://atlas-pi-bice.vercel.app");
    expect(await localDevBypass()).toBe(false);
    local(); vi.stubEnv("ATLAS_APP_URL", "not a url");
    expect(await localDevBypass()).toBe(false);
  });

  it("refuses requests addressed to any other host", async () => {
    local();
    for (const host of ["localhost:3000", "192.168.0.10:3000", "atlas-pi-bice.vercel.app", "127.0.0.1:3001"]) {
      request.host = host;
      expect(await localDevBypass()).toBe(false);
    }
  });
});
