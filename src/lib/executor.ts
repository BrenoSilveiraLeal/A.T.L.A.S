import "server-only";
import { randomUUID } from "node:crypto";
import { AtlasExecutor, reconcileExecutorAccount } from "@/core/executor";
import type { ManagedOrder } from "@/core/oms";
import type { BrokerExecution } from "@/core/broker";
import { HttpExecutionGateway } from "@/providers/execution-gateway";
import { adminClient } from "./supabase";
import { required } from "./env";
import { SupabaseExecutorStore } from "./executor-store";

/** One bounded tick. Reconciliation runs even when new trading is disabled. */
export async function runExecutor() {
  const deadline = Date.now() + 45_000;
  if (process.env.ATLAS_EXECUTOR_ENABLED !== "true") return { status: "UNCONFIGURED", dispatched: 0 };
  const owner = required("ATLAS_OWNER_ID"), db = adminClient();
  const rate = await db.rpc("consume_rate_limit", { p_key: `atlas-executor:${owner}`, p_limit: 1, p_window_seconds: 15 });
  if (rate.error) throw new Error("EXECUTOR_RATE_CHECK_FAILED");
  if (!rate.data) return { status: "RECENT_TICK", dispatched: 0 };
  const gateway = await HttpExecutionGateway.connect({
    url: required("ATLAS_GATEWAY_URL"), token: required("ATLAS_GATEWAY_TOKEN"),
    expectedAccountId: required("ATLAS_GATEWAY_ACCOUNT_ID"), expectedProviderId: required("ATLAS_GATEWAY_PROVIDER_ID"), timeoutMs: 5000,
  });
  const store = new SupabaseExecutorStore(db, owner);
  const account = await gateway.getAccount();
  const registered = await db.from("broker_accounts").select("id").eq("owner_id", owner)
    .eq("provider", gateway.capabilities.providerId).eq("external_account_id", account.accountId).maybeSingle();
  if (registered.error) throw new Error("EXECUTOR_REGISTERED_ACCOUNT_READ_FAILED");
  const registration = registered.data ? null : await db.rpc("register_execution_gateway", {
    p_owner_id: owner, p_provider: gateway.capabilities.providerId, p_account: account, p_capabilities: gateway.capabilities,
  });
  if (registration?.error) throw new Error("EXECUTOR_REGISTERED_ACCOUNT_REQUIRED");
  const brokerId: string = registered.data?.id ?? registration?.data;
  const executor = new AtlasExecutor(gateway, store, { executorId: `atlas:${randomUUID()}`, timeoutMs: 6000 });
  const issues: string[] = [];
  let accounted = 0, recovered = 0, dispatched = 0;
  const health = await gateway.healthCheck();
  if (!health.healthy) issues.push("GATEWAY_UNHEALTHY");

  // A DISPATCHED record may mean crash-after-send. Read only, never reset it to PENDING.
  const recoveries = await db.from("executor_commands").select("id").eq("owner_id", owner).eq("broker_account_id", brokerId)
    .in("status", ["DISPATCHED", "UNKNOWN"]).lt("dispatched_at", new Date(Date.now() - 30_000).toISOString()).order("created_at").limit(2);
  if (recoveries.error) throw new Error("EXECUTOR_RECOVERY_READ_FAILED");
  for (const item of recoveries.data) {
    try { const result = await executor.recover(item.id); if (result?.status === "ACKNOWLEDGED") recovered++; else issues.push("UNRESOLVED_ORDER"); }
    catch { issues.push("RECOVERY_FAILED"); }
  }
  // Poll acknowledged orders too: expiry/cancel events may arrive without a new fill.
  const openOrders = await db.from("orders").select("id").eq("owner_id", owner).eq("broker_account_id", brokerId)
    .in("status", ["SUBMITTED", "PARTIALLY_FILLED", "CANCEL_REQUESTED"]).order("updated_at").limit(2);
  if (openOrders.error) throw new Error("EXECUTOR_OPEN_ORDER_READ_FAILED");
  for (const order of openOrders.data) {
    if (Date.now() > deadline - 15_000) { issues.push("TICK_BUDGET_EXHAUSTED"); break; }
    const command = await db.from("executor_commands").select("id,status").eq("owner_id", owner).eq("order_id", order.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (command.error) { issues.push("ORDER_STATUS_READ_FAILED"); continue; }
    if (command.data?.status !== "ACKNOWLEDGED") continue;
    try { const result = await executor.recover(command.data.id); if (result?.status === "UNKNOWN") issues.push("ORDER_STATUS_UNKNOWN"); }
    catch { issues.push("ORDER_STATUS_READ_FAILED"); }
  }

  // Stage a complete page and its cursor atomically before applying any accounting.
  // The next tick resumes pagination. A completed replay starts again to detect delayed/corrected deals.
  try {
    const sync = await db.from("executor_sync").select("cursor").eq("owner_id", owner).eq("broker_account_id", brokerId).maybeSingle();
    if (sync.error) throw new Error("EXECUTOR_CURSOR_READ_FAILED");
    const cursor = sync.data?.cursor ?? null;
    const batch = await gateway.getExecutions(cursor);
    const staged = await db.rpc("stage_executor_executions", { p_owner_id: owner, p_broker_account_id: brokerId,
      p_expected_cursor: cursor, p_next_cursor: batch.nextCursor, p_executions: batch.executions });
    if (staged.error || staged.data !== true) throw new Error("EXECUTOR_PAGE_STAGE_FAILED");
    if (batch.nextCursor !== null) issues.push("EXECUTION_HISTORY_INCOMPLETE");
    const backlog = await db.rpc("executor_execution_backlog", { p_owner_id: owner, p_broker_account_id: brokerId });
    if (backlog.error) throw new Error("EXECUTOR_BACKLOG_READ_FAILED");
    if (backlog.data.unverifiedFeesCount > 0) issues.push("EXECUTION_FEES_UNVERIFIED");
    if (backlog.data.pendingCount > 0) issues.push("EXECUTION_BACKLOG_RECONCILIATION_REQUIRED");
    for (const fill of backlog.data.pending as BrokerExecution[]) {
      if (Date.now() > deadline) { issues.push("TICK_BUDGET_EXHAUSTED"); break; }
      try { const result = await executor.processExecution(fill); if (result === "COMMITTED") accounted++; if (result === "CONFLICT") issues.push("EXECUTION_COMMIT_CONFLICT"); }
      catch { issues.push("EXECUTION_RECONCILIATION_REQUIRED"); }
    }
  } catch { issues.push("EXECUTION_HISTORY_OR_FEES_UNAVAILABLE"); }

  if (!gateway.capabilities.completeAccountReconciliation || !account.cashOnly) issues.push("COMPLETE_CASH_ACCOUNT_PROOF_REQUIRED");
  else {
    try {
      const [cash, positions, orders, localStates, accountCount] = await Promise.all([
        gateway.getCash(), gateway.getPositions(), gateway.getOrders(),
        db.from("executor_order_states").select("state").eq("owner_id", owner),
        db.from("broker_accounts").select("id").eq("owner_id", owner),
      ]);
      if (localStates.error || accountCount.error || accountCount.data.length !== 1)
        throw new Error("UNSCOPED_LEDGER");
      // RPC exposes numeric balances as strings and includes all agent and unallocated custody rows.
      const local = await db.rpc("executor_reconciliation_snapshot", { p_owner_id: owner, p_broker_account_id: brokerId });
      if (local.error || !local.data) throw new Error("RECONCILIATION_SNAPSHOT_UNAVAILABLE");
      const at = new Date().toISOString();
      const result = reconcileExecutorAccount({ local: local.data, localOrders: localStates.data.map((s) => s.state as ManagedOrder),
        account, cash, positions, orders, complete: gateway.capabilities.completeAccountReconciliation,
        now: at, maxAgeMs: 30_000 });
      await store.recordObservation(brokerId, `reconciliation:${randomUUID()}`, "RECONCILIATION", { result, account, cash, positions, orders });
      const persisted = await db.rpc("finish_executor_reconciliation", { p_owner_id: owner, p_broker_account_id: brokerId, p_result: result, p_local: local.data });
      if (persisted.error || persisted.data !== true || !result.matches) issues.push("ACCOUNT_RECONCILIATION_REQUIRED");
    } catch { issues.push("ACCOUNT_RECONCILIATION_UNAVAILABLE"); }
  }
  // Never dispatch based merely on a gateway capability. SQL and the Central Risk Engine recheck too.
  if (health.healthy && Date.now() < deadline) {
    let query = db.from("executor_commands").select("id,kind").eq("owner_id", owner).eq("broker_account_id", brokerId).eq("status", "PENDING");
    if (issues.length || process.env.LIVE_TRADING_ENABLED !== "true") query = query.eq("kind", "CANCEL");
    const pending = await query.order("created_at").limit(1);
    if (pending.error) throw new Error("EXECUTOR_QUEUE_READ_FAILED");
    for (const item of pending.data) {
      if (item.kind !== "CANCEL" && process.env.LIVE_TRADING_ENABLED !== "true") continue;
      const result = await executor.execute(item.id); if (result) dispatched++;
    }
  }
  const uniqueIssues = [...new Set(issues)];
  const at = new Date();
  const update = await db.from("system_health").upsert({ owner_id: owner, component: "EXECUTION",
    status: uniqueIssues.length ? "YELLOW" : "GREEN", message: uniqueIssues.length ? uniqueIssues.join(", ") : "Gateway e reconciliação verificados; fila consultada.",
    checked_at: at.toISOString(), expires_at: new Date(at.getTime() + 60_000).toISOString(),
  }, { onConflict: "owner_id,component" });
  if (update.error) throw new Error("EXECUTOR_HEALTH_WRITE_FAILED");
  return { status: uniqueIssues.length ? "BLOCKED" : "CHECKED", dispatched, recovered, accounted, issues: uniqueIssues };
}
