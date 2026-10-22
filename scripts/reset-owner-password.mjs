import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { htmlAttribute, setupOrigin } from "./bootstrap-supabase-config.mjs";

// Owner password reset without email. Writes a one-time link to an ignored local file and
// prints only its path. The link alone is not enough: /setup also asks for the current
// authenticator code when MFA is enrolled.
const env = parseEnv(await readFile(".env.local", "utf8"));
for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ATLAS_OWNER_ID", "ATLAS_APP_URL"])
  if (!env[key]) throw new Error(`Configure ${key} in .env.local.`);
const origin = setupOrigin(env.ATLAS_APP_URL);
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = await admin.auth.admin.getUserById(env.ATLAS_OWNER_ID);
if (owner.error || !owner.data.user?.email) throw new Error("Owner lookup failed.");
const link = await admin.auth.admin.generateLink({ type: "recovery", email: owner.data.user.email, options: { redirectTo: `${origin}/setup` } });
const hash = link.data?.properties?.hashed_token;
if (link.error || !hash) throw new Error("Reset link creation failed.");
const url = `${origin}/setup#token_hash=${encodeURIComponent(hash)}`;
await mkdir(".supabase", { recursive: true });
await writeFile(".supabase/atlas-password-reset.html", `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Redefinir senha ATLAS</title><meta name="referrer" content="no-referrer"><h1>Redefinir a senha do ATLAS</h1><p>Link pessoal de uso único. O ATLAS precisa estar rodando neste computador (npm run local). Tenha o aplicativo autenticador em mãos.</p><p><a href="${htmlAttribute(url)}">Abrir a página de nova senha</a></p></html>`, { mode: 0o600 });
console.log(JSON.stringify({ resetFile: ".supabase/atlas-password-reset.html", emailSent: false }));
