import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { htmlAttribute, serializeEnvironment, setupOrigin } from "./bootstrap-supabase-config.mjs";

// Administrative setup only. Inputs/outputs containing secrets stay in ignored
// local files; this script never sends an email or prints an access link/key.
const [projectRef, email] = process.argv.slice(2);
if (!/^[a-z]{20}$/.test(projectRef ?? "") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "")) {
  throw new Error("Usage: node scripts/bootstrap-supabase-owner.mjs PROJECT_REF OWNER_EMAIL");
}
const url = `https://${projectRef}.supabase.co`;
const keys = JSON.parse(await readFile(".supabase/atlas-api-keys.json", "utf8"));
const publicKey = keys.find((key) => key.type === "publishable" && !key.disabled)?.api_key;
const secretKey = keys.find((key) => key.type === "secret" && !key.disabled)?.api_key;
if (!/^sb_publishable_[\w-]+$/.test(publicKey ?? "") || !/^sb_secret_[\w-]+$/.test(secretKey ?? "")) {
  throw new Error("Valid modern project keys are required in the ignored setup file.");
}
let previous = {};
try { previous = parseEnv(await readFile(".env.local", "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (previous.SUPABASE_URL && previous.SUPABASE_URL !== url) throw new Error("Refusing to overwrite another project's environment.");
const appOrigin = setupOrigin(previous.ATLAS_APP_URL || "http://127.0.0.1:3000");

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const current = await admin.from("system_state").select("owner_id").maybeSingle();
if (current.error) throw new Error("ATLAS schema could not be verified.");
const users = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
if (users.error) throw new Error("Owner lookup failed.");
let owner = users.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
if (users.data.users.some((user) => user.id !== owner?.id)) throw new Error("Refusing to provision a personal ATLAS project that has other users.");
if (current.data && current.data.owner_id !== owner?.id) throw new Error("A different owner is already registered.");
if (!owner && users.data.users.length) throw new Error("Refusing to provision over existing users.");
if (!owner) {
  const result = await admin.auth.admin.createUser({ email, password: randomBytes(48).toString("base64url"), email_confirm: true });
  if (result.error || !result.data.user) throw new Error("Owner creation failed.");
  owner = result.data.user;
}
if (!current.data) {
  const inserted = await admin.from("system_state").insert({ owner_id: owner.id });
  if (inserted.error) throw new Error("Owner binding failed.");
}
const ownerDetails = await admin.auth.admin.getUserById(owner.id);
if (ownerDetails.error) throw new Error("Owner verification failed.");
if (ownerDetails.data.user.factors?.some((factor) => factor.status === "verified")) {
  throw new Error("Owner already has MFA. First-time bootstrap is disabled.");
}
const values = {
  ...previous,
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: publicKey,
  SUPABASE_SERVICE_ROLE_KEY: secretKey,
  ATLAS_OWNER_ID: owner.id,
  ATLAS_APP_URL: appOrigin,
  CRON_SECRET: previous.CRON_SECRET || randomBytes(32).toString("base64url"),
  SESSION_COOKIE_SECURE: previous.SESSION_COOKIE_SECURE || "false",
  LIVE_TRADING_ENABLED: "false",
  BRAPI_API_TOKEN: previous.BRAPI_API_TOKEN || "",
};
await writeFile(".env.local", serializeEnvironment(values), { mode: 0o600 });
const link = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${values.ATLAS_APP_URL}/setup` } });
const hash = link.data.properties?.hashed_token;
if (link.error || !hash) throw new Error("One-time setup link creation failed.");
const setupUrl = `${values.ATLAS_APP_URL}/setup#token_hash=${encodeURIComponent(hash)}`;
await mkdir(".supabase", { recursive: true });
await writeFile(".supabase/atlas-owner-setup.html", `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Acesso inicial ATLAS</title><meta name="referrer" content="no-referrer"><h1>Defina seu acesso ao ATLAS</h1><p>Link temporário e pessoal. O servidor ATLAS deve estar em execução.</p><p><a href="${htmlAttribute(setupUrl)}">Definir minha senha e depois cadastrar o autenticador</a></p></html>`, { mode: 0o600 });
await writeFile(".supabase/atlas-project.json", JSON.stringify({ projectRef, ownerId: owner.id, url }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ configured: true, projectRef, ownerId: owner.id, environmentFile: ".env.local", setupFile: ".supabase/atlas-owner-setup.html", emailSent: false, liveEnabled: false }));
