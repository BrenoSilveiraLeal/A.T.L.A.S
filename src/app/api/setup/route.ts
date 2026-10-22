import { z } from "zod";
import { ApiError } from "@/lib/auth";
import { configured, required } from "@/lib/env";
import { checkOrigin, failure, json, readBody } from "@/lib/http";
import { sessionClient } from "@/lib/supabase";

const schema = z.strictObject({
  tokenHash: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
  password: z.string().min(14).max(128).refine((value) => value.trim().length >= 14),
  /** Required to reset the password once an authenticator is enrolled. */
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = schema.parse(await readBody(request));
    if (!configured())
      throw new ApiError(503, "SETUP_REQUIRED", "A configuração do servidor ainda está pendente.");

    const db = await sessionClient();
    // Supabase consumes the recovery token. Never accept a cookie alone here.
    // Its native Auth rate limits govern attempts; there is no public global lockout bucket.
    const verified = await db.auth.verifyOtp({
      token_hash: body.tokenHash,
      type: "recovery",
    });
    if (verified.error || !verified.data.session || !verified.data.user)
      throw new ApiError(401, "SETUP_LINK_INVALID", "O link expirou ou já foi utilizado. Gere um novo link de primeiro acesso.");

    try {
      const identity = await db.auth.getUser();
      const owner = required("ATLAS_OWNER_ID");
      if (
        identity.error ||
        identity.data.user?.id !== owner ||
        verified.data.user.id !== owner
      )
        throw new ApiError(403, "OWNER_REQUIRED", "Este link não pertence ao proprietário do ATLAS.");

      const factors = await db.auth.mfa.listFactors();
      if (factors.error || !factors.data)
        throw new ApiError(503, "MFA_STATUS_UNAVAILABLE", "Não foi possível verificar a proteção da conta. Gere um novo link e tente novamente.");
      // A recovery link alone never replaces an enrolled factor: a password reset must
      // also prove possession of the authenticator (the session becomes AAL2 first).
      const verifiedFactors = factors.data.all.filter((factor) => factor.status === "verified");
      const enrolled = verifiedFactors.find((factor) => factor.factor_type === "totp");
      if (verifiedFactors.some((factor) => factor.factor_type !== "totp"))
        throw new ApiError(403, "SETUP_ALREADY_PROTECTED", "Esta conta usa outro tipo de segundo fator; a redefinição por link não é permitida.");
      if (enrolled) {
        if (!body.totp)
          throw new ApiError(403, "TOTP_REQUIRED", "Esta conta já tem autenticador. Informe o código de 6 dígitos para redefinir a senha.");
        const verifiedFactor = await db.auth.mfa.challengeAndVerify({ factorId: enrolled.id, code: body.totp });
        if (verifiedFactor.error)
          throw new ApiError(401, "TOTP_INVALID", "Código do autenticador inválido ou expirado. Gere um novo link e tente de novo.");
      }

      const updated = await db.auth.updateUser({ password: body.password });
      if (updated.error || updated.data.user?.id !== owner) {
        // Only allowlisted error codes leave the server; provider messages may contain private data.
        switch (updated.error?.code) {
          case "same_password":
            throw new ApiError(400, "PASSWORD_UNCHANGED", "Essa já é a senha atual da conta. Vá para o login e entre com ela.");
          case "weak_password":
            throw new ApiError(400, "PASSWORD_POLICY_REJECTED", "O Supabase recusou a senha pela política de segurança. Use uma senha exclusiva de pelo menos 14 caracteres e abra um novo link.");
          case "reauthentication_needed":
          case "reauthentication_not_valid":
            throw new ApiError(400, "PASSWORD_REAUTH_REQUIRED", "O Supabase exigiu confirmação adicional da sessão. É necessário revisar a configuração de recuperação do acesso.");
          case "over_request_rate_limit":
            throw new ApiError(429, "PASSWORD_RATE_LIMITED", "O Supabase limitou as tentativas. Aguarde antes de abrir um novo link de primeiro acesso.");
          default:
            throw new ApiError(503, "PASSWORD_SETUP_UNAVAILABLE", "O serviço não concluiu a definição da senha. É necessário verificar o fluxo de acesso; essa falha não indica necessariamente uma senha fraca.");
        }
      }
    } finally {
      // Clear the temporary HttpOnly recovery session; regular login still requires TOTP.
      const logout = await db.auth.signOut({ scope: "local" });
      if (logout.error)
        throw new ApiError(503, "SETUP_SESSION_END_FAILED", "Não foi possível encerrar a sessão de configuração. Entre novamente antes de continuar.");
    }
    return json({ ok: true, next: "login" });
  } catch (error) {
    return failure(error);
  }
}
