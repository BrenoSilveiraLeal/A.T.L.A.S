import { timingSafeEqual } from "node:crypto";
import { failure, json } from "@/lib/http";
import { ApiError } from "@/lib/auth";
import { runExecutor } from "@/lib/executor";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Server-to-server control only. Does not accept orders, risk flags or a gateway URL in the request. */
export async function POST(request: Request) {
  try {
    const secret = process.env.EXECUTOR_SECRET;
    const expected = Buffer.from(`Bearer ${secret ?? ""}`);
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    if (!secret || secret.length < 32 || /[\r\n]/.test(secret) || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new ApiError(401, "EXECUTOR_UNAUTHORIZED", "Executor não autorizado.");
    if (request.headers.has("origin")) throw new ApiError(403, "EXECUTOR_ORIGIN_REJECTED", "Use o canal privado do Executor.");
    return json(await runExecutor());
  } catch (error) { return failure(error); }
}
