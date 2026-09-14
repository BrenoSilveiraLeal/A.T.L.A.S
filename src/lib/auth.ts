import "server-only";
import { configured, required } from "./env";
import { sessionClient } from "./supabase";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function requireOwner(mfa = true) {
  if (!configured())
    throw new ApiError(
      503,
      "SETUP_REQUIRED",
      "Configure Supabase e o proprietário antes de continuar.",
    );
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
