import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function executorEndpoint(env) {
  const base = new URL(env.ATLAS_APP_URL);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" ||
    (base.protocol !== "https:" && !(base.protocol === "http:" && base.hostname === "127.0.0.1")))
    throw new Error("ATLAS_APP_URL deve ser HTTPS ou HTTP em 127.0.0.1.");
  if (!env.EXECUTOR_SECRET || env.EXECUTOR_SECRET.length < 32 || /[\r\n]/.test(env.EXECUTOR_SECRET))
    throw new Error("Configure EXECUTOR_SECRET com pelo menos 32 caracteres.");
  return new URL("api/executor", base);
}
export async function tickExecutor(env, signal, transport = fetch) {
  const endpoint = executorEndpoint(env);
  try {
    const response = await transport(endpoint, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${env.EXECUTOR_SECRET}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(55_000)]),
    });
    if (!response.ok) return { status: "HTTP_ERROR", httpStatus: response.status };
    const value = await response.json();
    if (!value || !["UNCONFIGURED", "RECENT_TICK", "BLOCKED", "CHECKED"].includes(value.status)) return { status: "INVALID_RESPONSE" };
    // Do not log bodies, provider messages, account IDs, cookies or credentials.
    return { status: value.status };
  } catch { return { status: signal.aborted ? "STOPPED" : "UNAVAILABLE" }; }
}
export async function runExecutorWorker() {
  const env = { ...process.env, ...parseEnv(await readFile(".env.local", "utf8")) };
  executorEndpoint(env);
  if (env.ATLAS_EXECUTOR_ENABLED !== "true") throw new Error("Executor não configurado: ATLAS_EXECUTOR_ENABLED=false.");
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    while (!abort.signal.aborted) {
      const started = Date.now();
      console.log(JSON.stringify({ component: "executor-worker", ...await tickExecutor(env, abort.signal) }));
      await delay(Math.max(1000, 20_000 - (Date.now() - started)), undefined, { signal: abort.signal }).catch(() => {});
    }
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  runExecutorWorker().catch(() => { console.error("Executor indisponível. Confira a configuração local e o backend."); process.exitCode = 1; });
