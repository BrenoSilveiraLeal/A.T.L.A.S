import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

export function validateLocalConfiguration(env) {
  if (!/^http:\/\/127\.0\.0\.1:3000\/?$/.test(env.ATLAS_APP_URL ?? "")) {
    throw new Error("Configure ATLAS_APP_URL=http://127.0.0.1:3000 para execução local.");
  }
  if (env.LIVE_TRADING_ENABLED !== "false") throw new Error("A execução local exige LIVE_TRADING_ENABLED=false.");
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32 || /[\r\n]/.test(env.CRON_SECRET)) {
    throw new Error("Configure um CRON_SECRET de pelo menos 32 caracteres.");
  }
  for (const name of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ATLAS_OWNER_ID"]) {
    if (!env[name]) throw new Error(`Configuração obrigatória ausente: ${name}.`);
  }
  if (env.SESSION_COOKIE_SECURE !== "false") throw new Error("Configure SESSION_COOKIE_SECURE=false somente para esta origem HTTP local.");
  return env;
}

// The caller awaits each tick before scheduling another. Never log bodies, IDs,
// headers, URLs from errors or provider messages: they can contain private data.
export async function tickLocalScheduler(secret, signal, transport = fetch) {
  try {
    const response = await transport("http://127.0.0.1:3000/api/cron", {
      method: "POST", headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]), redirect: "error",
    });
    if (!response.ok) return { status: "HTTP_ERROR", httpStatus: response.status };
    const result = await response.json();
    if (!result || !Array.isArray(result.jobs) || result.jobs.length > 3 ||
        result.jobs.some((job) => !job || !["SUCCEEDED", "FAILED"].includes(job.status))) {
      return { status: "INVALID_RESPONSE" };
    }
    if (result.skipped === "RECENT_TICK") return { status: "RECENT_TICK", completed: 0, failed: 0 };
    return {
      status: "OK", completed: result.jobs.filter((job) => job.status === "SUCCEEDED").length,
      failed: result.jobs.filter((job) => job.status === "FAILED").length,
    };
  } catch { return { status: signal.aborted ? "STOPPED" : "UNAVAILABLE" }; }
}

async function requireAvailablePort() {
  await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("A porta 3000 está ocupada. Encerre o servidor ATLAS anterior antes de usar npm run local.")));
    probe.listen(3000, "127.0.0.1", () => probe.close(resolvePort));
  });
}

export async function runLocal() {
  let env;
  try { env = validateLocalConfiguration(parseEnv(await readFile(".env.local", "utf8"))); }
  catch (error) {
    console.error(error.code === "ENOENT" ? "Configure .env.local antes de iniciar o ATLAS." : error.message);
    process.exitCode = 1; return;
  }
  try { await access(".next/BUILD_ID"); }
  catch { console.error("Execute npm run build antes de npm run local."); process.exitCode = 1; return; }
  try { await requireAvailablePort(); }
  catch (error) { console.error(error.message); process.exitCode = 1; return; }
  const controller = new AbortController();
  let server;
  let serverExited = false;
  const stop = () => {
    controller.abort();
    if (server && !serverExited) server.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await new Promise((ready, reject) => {
      let readySeen = false;
      let startupOutput = "";
      const timer = setTimeout(() => reject(new Error("O servidor não iniciou em 30 segundos.")), 30000);
      const fail = () => { clearTimeout(timer); reject(new Error("Não foi possível iniciar o servidor local. Confira o build e a porta 3000.")); };
      server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3000"], {
        cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env, NODE_ENV: "production", FORCE_COLOR: "0" },
      });
      server.once("error", fail);
      server.once("exit", () => {
        serverExited = true;
        if (!controller.signal.aborted) process.exitCode = 1;
        controller.abort();
        if (!readySeen) fail();
      });
      server.stderr.on("data", () => {});
      server.stdout.on("data", (chunk) => {
        if (readySeen) return;
        startupOutput = (startupOutput + chunk.toString()).slice(-4096);
        if (/Ready in \d/.test(startupOutput)) {
          readySeen = true; clearTimeout(timer); ready();
        }
      });
    });
    console.log("ATLAS disponível em http://127.0.0.1:3000. Análises locais a cada 60 segundos; Ctrl+C encerra o programa.");
    while (!controller.signal.aborted) {
      const started = Date.now();
      const result = await tickLocalScheduler(env.CRON_SECRET, controller.signal);
      if (controller.signal.aborted) break;
      console.log(JSON.stringify({ component: "local-scheduler", ...result }));
      await delay(Math.max(0, 60000 - (Date.now() - started)), undefined, { signal: controller.signal }).catch(() => {});
    }
  } catch {
    if (!controller.signal.aborted) { console.error("Inicialização local indisponível. Confira npm run build e a porta 3000."); process.exitCode = 1; }
  } finally {
    stop();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runLocal();
