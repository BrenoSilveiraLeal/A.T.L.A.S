import "server-only";
import { z } from "zod";
import type { ProviderErrorCode, ProviderName } from "./types";

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly code: ProviderErrorCode,
    public readonly status?: number,
  ) {
    // Do not propagate upstream bodies, request headers or URLs containing secrets.
    super(`${provider}: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ProviderError";
  }
}

const ORIGINS: Record<ProviderName, string> = {
  brapi: "https://brapi.dev",
  bcb: "https://api.bcb.gov.br",
  ibge: "https://servicodados.ibge.gov.br",
};
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function httpCode(status: number): ProviderErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return "UNAVAILABLE";
}

async function limitedJson(
  response: Response,
  provider: ProviderName,
): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ProviderError(provider, "INVALID_RESPONSE");
  }
  if (!response.body) throw new ProviderError(provider, "INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ProviderError(provider, "INVALID_RESPONSE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    throw new ProviderError(provider, "INVALID_RESPONSE");
  }
}

function retryWait(
  response: Response | undefined,
  attempt: number,
): number | null {
  const header = response?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - Date.now();
    // Respect long cooldowns by returning the error, rather than retrying too early.
    if (Number.isFinite(delay)) return delay > 2000 ? null : Math.max(0, delay);
  }
  return 250 * 2 ** attempt + Math.floor(Math.random() * 100);
}

export async function getJson(
  provider: ProviderName,
  url: URL,
  options: { token?: string; timeoutMs?: number; maxAttempts?: number } = {},
): Promise<unknown> {
  if (
    url.origin !== ORIGINS[provider] ||
    url.username ||
    url.password ||
    url.searchParams.has("token")
  ) {
    throw new ProviderError(provider, "INVALID_INPUT");
  }
  const attempts = Math.min(3, Math.max(1, options.maxAttempts ?? 3));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 8000,
    );
    let response: Response | undefined;
    let error: ProviderError;
    let retryable = false;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
        },
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (response.ok) return await limitedJson(response, provider);
      error = new ProviderError(
        provider,
        httpCode(response.status),
        response.status,
      );
      retryable = RETRYABLE.has(response.status);
      await response.body?.cancel();
    } catch (cause) {
      if (cause instanceof ProviderError) {
        error = cause;
      } else {
        error = new ProviderError(
          provider,
          controller.signal.aborted ? "TIMEOUT" : "UNAVAILABLE",
        );
        retryable = true;
      }
    } finally {
      clearTimeout(timer);
    }
    if (!retryable || attempt + 1 >= attempts) throw error;
    const delay = retryWait(response, attempt);
    if (delay === null) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new ProviderError(provider, "UNAVAILABLE");
}

export function parseResponse<T>(
  provider: ProviderName,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError(provider, "INVALID_RESPONSE");
  return parsed.data;
}
