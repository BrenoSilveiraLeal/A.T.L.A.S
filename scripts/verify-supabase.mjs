import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

const sensitiveTables = [
  "system_state", "assets", "strategies", "strategy_versions", "risk_profiles", "agents",
  "broker_accounts", "broker_connections", "decisions", "trade_proposals", "orders",
  "order_events", "executions", "positions", "portfolio_snapshots", "agent_memories",
  "ledger_accounts", "ledger_transactions", "ledger_entries", "agent_allocations",
  "treasury_transactions", "order_reservations", "meetings", "alerts", "audit_logs", "job_runs",
  "executor_commands", "executor_order_states", "executor_ledger_states", "executor_observations", "executor_sync",
  "paper_accounts", "paper_positions", "paper_proposals", "paper_orders", "paper_fills", "paper_ledger_entries", "paper_events",
];

/** No request in this script may mutate Auth, PostgREST or any other service. */
export function createReadOnlyFetch(origin, implementation = fetch) {
  return async (input, init = {}) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (target.origin !== origin || !["GET", "HEAD"].includes(method)) throw new Error("READ_ONLY_REQUEST_REJECTED");
    const originalSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const timeout = AbortSignal.timeout(12000);
    return implementation(input, {
      ...init,
      redirect: "error",
      signal: originalSignal ? AbortSignal.any([originalSignal, timeout]) : timeout,
    });
  };
}

export function classifyAnonymousRead(result) {
  if (result.error) {
    if ([401, 403].includes(result.status) && result.error.code === "42501") {
      return { ok: true, status: "PERMISSION_DENIED", visibleRows: 0 };
    }
    return { ok: false, status: "READ_CHECK_UNAVAILABLE", visibleRows: 0 };
  }
  if (!Array.isArray(result.data)) return { ok: false, status: "INVALID_READ_RESPONSE", visibleRows: 0 };
  return {
    ok: result.data.length === 0,
    // An empty result alone establishes non-disclosure in this request, not proof of a policy on an empty table.
    status: result.data.length === 0 ? "EMPTY_NO_ROWS_VISIBLE" : "ANONYMOUS_DATA_EXPOSED",
    visibleRows: result.data.length,
  };
}

export function validatePortfolioEvidence(data) {
  const invalid = { ok: false, status: "INVALID_PORTFOLIO_RESPONSE" };
  if (!data || !Array.isArray(data.brokerAccounts) || !Array.isArray(data.snapshots) ||
      !Array.isArray(data.positions) || typeof data.historyTruncated !== "boolean" ||
      typeof data.positionsTruncated !== "boolean") return invalid;
  const counts = { accountCount: data.brokerAccounts.length, snapshotCount: data.snapshots.length, positionCount: data.positions.length };
  if (counts.accountCount === 0) {
    const ok = data.brokerAccountId === null && counts.snapshotCount === 0 && counts.positionCount === 0 &&
      !data.historyTruncated && !data.positionsTruncated;
    return { ok, status: ok ? "EMPTY_NO_BROKER_ACCOUNT" : "INVALID_EMPTY_PORTFOLIO", ...counts };
  }
  if (!data.brokerAccounts.some((account) => account.id === data.brokerAccountId)) return invalid;
  const decimal = (value) => typeof value === "string" && /^-?\d{1,18}(?:\.\d{1,10})?$/.test(value);
  const snapshotValid = data.snapshots.every((row) => row.brokerAccountId === data.brokerAccountId &&
    row.reconciled === true && Array.isArray(row.discrepancies) && row.discrepancies.length === 0 && decimal(row.cash) &&
    ["equity", "invested", "realizedPnl", "unrealizedPnl"].every((key) => row[key] === null || decimal(row[key])));
  const positionsValid = data.positions.every((row) => row.brokerAccountId === data.brokerAccountId &&
    decimal(row.quantity) && decimal(row.reservedQuantity) &&
    ["averagePrice", "realizedPnl"].every((key) => row[key] === null || decimal(row[key])));
  const ok = snapshotValid && positionsValid;
  return { ok, status: ok ? "ACCOUNT_SCOPED_EVIDENCE" : "INVALID_PORTFOLIO_EVIDENCE", ...counts };
}

function keyRole(key) {
  if (key?.startsWith("sb_publishable_")) return "anon";
  if (key?.startsWith("sb_secret_")) return "service_role";
  try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role; }
  catch { return null; }
}

export async function verifySupabase() {
  const env = parseEnv(await readFile(".env.local", "utf8"));
  const url = new URL(env.SUPABASE_URL);
  const project = /^([a-z]{20})\.supabase\.co$/.exec(url.hostname);
  if (!project || url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.ATLAS_OWNER_ID ?? "") ||
      keyRole(env.SUPABASE_PUBLISHABLE_KEY) !== "anon" || keyRole(env.SUPABASE_SERVICE_ROLE_KEY) !== "service_role") {
    return { ok: false, status: "INVALID_LOCAL_CONFIGURATION" };
  }
  let identityStatus = "CONFIGURED_PROJECT";
  try {
    const recorded = JSON.parse(await readFile(".supabase/atlas-project.json", "utf8"));
    if (recorded.projectRef !== project[1] || recorded.ownerId !== env.ATLAS_OWNER_ID || new URL(recorded.url).origin !== url.origin) {
      return { ok: false, status: "PROJECT_IDENTITY_MISMATCH" };
    }
    identityStatus = "RECORDED_PROJECT_MATCH";
  } catch (error) {
    if (error.code !== "ENOENT") return { ok: false, status: "PROJECT_IDENTITY_UNAVAILABLE" };
  }
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createReadOnlyFetch(url.origin) },
  };
  const admin = createClient(url.origin, env.SUPABASE_SERVICE_ROLE_KEY, options);
  const anonymous = createClient(url.origin, env.SUPABASE_PUBLISHABLE_KEY, options);
  const checks = {};
  // Identity and safety state are prerequisites for subsequent reads.
  const [owner, state] = await Promise.all([
    admin.auth.admin.getUserById(env.ATLAS_OWNER_ID),
    admin.from("system_state").select("id,owner_id,live_trading_enabled,global_kill_switch", { count: "exact" }).limit(2),
  ]);
  checks.project = { ok: !owner.error && !state.error, status: identityStatus };
  checks.owner = { ok: !owner.error && owner.data.user?.id === env.ATLAS_OWNER_ID, status: owner.error ? "OWNER_UNAVAILABLE" : "OWNER_ID_CHECKED" };
  const row = state.data?.[0];
  checks.systemState = {
    ok: !state.error && state.count === 1 && state.data?.length === 1 && row?.id === true &&
      row.owner_id === env.ATLAS_OWNER_ID && row.live_trading_enabled === false && row.global_kill_switch === true,
    status: state.error ? "STATE_UNAVAILABLE" : "SAFETY_STATE_CHECKED",
    count: state.count ?? 0,
    liveDisabled: row?.live_trading_enabled === false,
    killSwitchEnabled: row?.global_kill_switch === true,
  };
  if (!Object.values(checks).every((check) => check.ok)) return { ok: false, status: "PRECONDITION_FAILED", checks };
  // Omit the default-null account argument: GET query strings cannot encode a SQL null UUID.
  const args = { p_owner_id: env.ATLAS_OWNER_ID, p_limit: 200 };
  const portfolio = await admin.rpc("get_portfolio_history", args, { get: true });
  checks.portfolio = portfolio.error ? { ok: false, status: "PORTFOLIO_RPC_UNAVAILABLE" } : validatePortfolioEvidence(portfolio.data);
  const rpc = await anonymous.rpc("get_portfolio_history", args, { get: true });
  checks.anonymousRpc = {
    ok: Boolean(rpc.error?.code === "42501" && [401, 403].includes(rpc.status)),
    status: rpc.error?.code === "42501" && [401, 403].includes(rpc.status) ? "PERMISSION_DENIED" : rpc.error ? "RPC_CHECK_UNAVAILABLE" : "PRIVILEGED_RPC_EXPOSED",
  };
  const anonymousTables = {};
  // Small bounded batches avoid a burst across every table on the free project.
  for (let offset = 0; offset < sensitiveTables.length; offset += 4) {
    await Promise.all(sensitiveTables.slice(offset, offset + 4).map(async (table) => {
      // Some composite-key tables have no `id`; `*` with limit 1 tests access itself.
      const result = await anonymous.from(table).select("*").limit(1);
      anonymousTables[table] = classifyAnonymousRead(result);
    }));
  }
  checks.anonymousTables = {
    ok: Object.values(anonymousTables).every((check) => check.ok),
    checkedCount: sensitiveTables.length,
    tables: anonymousTables,
  };
  const ok = Object.values(checks).every((check) => check.ok);
  return { ok, status: ok ? "READ_ONLY_VERIFICATION_PASSED" : "VERIFICATION_FAILED", checks };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const report = await verifySupabase();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    // No provider error, URL, user details, environment contents or secret is ever printed.
    console.log(JSON.stringify({ ok: false, status: "VERIFICATION_UNAVAILABLE" }));
    process.exitCode = 1;
  }
}
