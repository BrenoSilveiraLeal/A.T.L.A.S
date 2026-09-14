import "server-only";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./auth";
import { required } from "./env";

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(required("ATLAS_APP_URL")).origin;
  if (origin !== expected)
    throw new ApiError(
      403,
      "ORIGIN_REJECTED",
      "Origem da solicitação não autorizada.",
    );
}
export function checkCron(request: Request) {
  const expected = `Bearer ${required("CRON_SECRET")}`;
  const actual = request.headers.get("authorization") ?? "";
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new ApiError(401, "CRON_UNAUTHORIZED", "Scheduler não autorizado.");
}
export async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "JSON_REQUIRED", "Envie JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "BODY_REQUIRED", "Solicitação vazia.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError(413, "BODY_TOO_LARGE", "Solicitação muito grande.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON inválido.");
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
export function failure(error: unknown) {
  const correlationId = randomUUID();
  if (error instanceof ApiError)
    return json(
      { error: error.message, code: error.code, correlationId },
      error.status,
    );
  if (error instanceof ZodError)
    return json(
      {
        error: "Confira os campos enviados.",
        code: "INVALID_INPUT",
        fields: error.issues.map((i) => i.path.join(".")),
        correlationId,
      },
      400,
    );
  // Never log credentials, request bodies, provider responses or user content.
  console.error(
    JSON.stringify({
      event: "request_failed",
      correlationId,
      kind: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  return json(
    {
      error:
        "Não foi possível concluir. Confira a configuração e o estado do serviço.",
      code: "SERVICE_UNAVAILABLE",
      correlationId,
    },
    503,
  );
}
