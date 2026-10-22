import "server-only";
import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { configured, required } from "./env";
import { adminClient, sessionClient } from "./supabase";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Development convenience: skips login ONLY when all of these hold, so it can never
 * apply to a public deployment: ATLAS_DEV_AUTH_BYPASS=true in the local environment,
 * not running on Vercel, ATLAS_APP_URL on 127.0.0.1 and the request addressed to that
 * same loopback host (the local server also binds to 127.0.0.1 only).
 */
export async function localDevBypass(): Promise<boolean> {
  if (process.env.ATLAS_DEV_AUTH_BYPASS !== "true" || process.env.VERCEL) return false;
  let app: URL;
  try { app = new URL(process.env.ATLAS_APP_URL ?? ""); } catch { return false; }
  if (app.hostname !== "127.0.0.1" || app.protocol !== "http:") return false;
  return (await headers()).get("host") === app.host;
}

export async function requireOwner(mfa = true) {
  if (!configured())
    throw new ApiError(
      503,
      "SETUP_REQUIRED",
      "Configure Supabase e o proprietário antes de continuar.",
    );
  if (await localDevBypass())
    // Single-owner database: the service client acts as the configured owner locally.
    return { db: adminClient(), user: { id: required("ATLAS_OWNER_ID") } as User };
  const db = await sessionClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new ApiError(401, "AUTH_REQUIRED", "Entre novamente para continuar.");
  if (data.user.id !== required("ATLAS_OWNER_ID"))
    throw new ApiError(
      403,
      "OWNER_REQUIRED",
      "Esta conta não é o proprietário do ATLAS.",
    );
  const claims = await db.auth.getClaims();
  if (claims.error || !claims.data)
    throw new ApiError(
      401,
      "SESSION_INVALID",
      "A sessão expirou. Entre novamente.",
    );
  if (mfa && claims.data.claims.aal !== "aal2")
    throw new ApiError(
      403,
      "MFA_REQUIRED",
      "Confirme seu código de autenticação de dois fatores.",
    );
  return { db, user: data.user };
}
