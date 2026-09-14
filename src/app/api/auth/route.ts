import { z } from "zod";
import { requireOwner, ApiError } from "@/lib/auth";
import { adminClient, sessionClient } from "@/lib/supabase";
import { required } from "@/lib/env";
import { checkOrigin, readBody, json, failure } from "@/lib/http";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("login"),
    email: z.email().max(254),
    password: z.string().min(1).max(256),
  }),
  z.object({ action: z.literal("enroll") }),
  z.object({
    action: z.literal("verify"),
    factorId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({ action: z.literal("logout") }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = schema.parse(await readBody(request));
    if (body.action === "login") {
      // Password attempts are governed by Supabase Auth's native rate limits.
      // Do not create an unauthenticated global bucket that can lock out the owner.
      const db = await sessionClient();
      const { data, error } = await db.auth.signInWithPassword({
        email: body.email,
        password: body.password,
      });
      if (error || data.user?.id !== required("ATLAS_OWNER_ID")) {
        await db.auth.signOut();
        throw new ApiError(
          401,
          "LOGIN_FAILED",
          "E-mail ou senha inválidos para o proprietário.",
        );
      }
      const factors = await db.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      return json({
        next: factors.data.totp.length ? "verify" : "enroll",
        factorId: factors.data.totp[0]?.id,
      });
    }
    const { db } = await requireOwner(false);
    if (body.action === "logout") {
      const result = await db.auth.signOut();
      if (result.error) throw result.error;
      return json({ ok: true });
    }
    const limit = await adminClient().rpc("consume_rate_limit", {
      p_key: `atlas-mfa:${required("ATLAS_OWNER_ID")}`,
      p_limit: 15,
      p_window_seconds: 60,
    });
    if (limit.error)
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Autenticação indisponível. Verifique as migrations do banco.",
      );
    if (!limit.data)
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Muitas tentativas. Aguarde um minuto.",
      );
    if (body.action === "enroll") {
      const factors = await db.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      if (factors.data.totp.length)
        return json({ next: "verify", factorId: factors.data.totp[0].id });
      const result = await db.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `ATLAS ${new Date().toISOString()}`,
        issuer: "ATLAS",
      });
      if (result.error)
        throw new ApiError(
          400,
          "MFA_ENROLL_FAILED",
          "Não foi possível cadastrar o autenticador. Revise os fatores no Supabase Auth.",
        );
      // Enrollment secret is shown only to the authenticated owner over a no-store response.
      return json({
        next: "verify",
        factorId: result.data.id,
        secret: result.data.totp.secret,
        qrCode: result.data.totp.qr_code,
      });
    }
    const result = await db.auth.mfa.challengeAndVerify({
      factorId: body.factorId,
      code: body.code,
    });
    if (result.error)
      throw new ApiError(
        400,
        "MFA_CODE_INVALID",
        "Código inválido ou expirado. Tente o código atual do autenticador.",
      );
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
