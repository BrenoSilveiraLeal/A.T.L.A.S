import { parseEnv } from "node:util";

export function setupOrigin(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error("ATLAS_APP_URL must be a valid application origin."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) ||
    parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/"
  ) throw new Error("ATLAS_APP_URL must be HTTPS, or HTTP on localhost, with no path, credentials, query or fragment.");
  return parsed.origin;
}

export function serializeEnvironment(values) {
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new Error("Invalid environment entry. The existing file was not overwritten.");
    }
    // Quoted values preserve existing # characters and surrounding spaces.
    // Confirm the representation before writing to avoid damaging another setting.
    const candidates = [value];
    if (!value.includes("'")) candidates.push(`'${value}'`);
    if (!value.includes('"')) candidates.push(`"${value}"`);
    const serialized = candidates.find((candidate) => parseEnv(`${key}=${candidate}`)[key] === value);
    if (serialized === undefined) throw new Error("An environment value cannot be preserved safely. The existing file was not overwritten.");
    return `${key}=${serialized}`;
  }).join("\n") + "\n";
}

export function htmlAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
