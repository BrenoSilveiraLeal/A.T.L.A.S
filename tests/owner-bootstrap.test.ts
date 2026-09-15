import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { htmlAttribute, serializeEnvironment, setupOrigin } from "../scripts/bootstrap-supabase-config.mjs";

describe("owner bootstrap local configuration", () => {
  it("accepts a public HTTPS origin and local HTTP setup, normalizing the trailing slash", () => {
    expect(setupOrigin("https://atlas.example.test/")).toBe("https://atlas.example.test");
    expect(setupOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(setupOrigin("http://[::1]:3000")).toBe("http://[::1]:3000");
  });

  it.each([
    "http://atlas.example.test", "http://localhost.attacker.test", "https://owner:password@atlas.example.test",
    "https://atlas.example.test/setup", "https://atlas.example.test/?redirect=elsewhere",
    "https://atlas.example.test/#fragment", "javascript:alert(1)", "not a URL",
  ])("rejects an unsafe or non-origin setup target: %s", (value) => {
    expect(() => setupOrigin(value)).toThrow();
  });

  it("preserves existing environment values including comment characters and spaces", () => {
    const values = { KEY: "sb_secret_fixture", EMPTY: "", HASH: "before#after", SPACES: "  keep spaces  ", QUOTE: "owner's # value" };
    expect(parseEnv(serializeEnvironment(values))).toEqual(values);
  });

  it("rejects an invalid entry without emitting secret values in errors", () => {
    const secret = "private\nvalue";
    expect(() => serializeEnvironment({ TOKEN: secret })).toThrow("Invalid environment entry");
    expect(() => serializeEnvironment({ "INVALID KEY": "private" })).toThrow("Invalid environment entry");
  });

  it("escapes HTML attribute boundaries in generated local links", () => {
    expect(htmlAttribute('https://atlas.test/?x="<>&')).toBe("https://atlas.test/?x=&quot;&lt;&gt;&amp;");
  });
});
