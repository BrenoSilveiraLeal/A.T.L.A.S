import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedExecutorCommand, CommandCompletion, ExecutionCommit, ExecutionState, ExecutorCommand, ExecutorStore } from "@/core/executor";
import type { ManagedOrder, LedgerAccount } from "@/core/oms";

/** All mutations use one Postgres transaction. The service key never leaves this backend. */
export class SupabaseExecutorStore implements ExecutorStore {
  constructor(private readonly db: SupabaseClient, private readonly owner: string) {}

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, { p_owner_id: this.owner, ...args });
    if (error) throw new Error(`EXECUTOR_DATABASE_${name.toUpperCase()}_FAILED`);
    return data as T;
  }
  enqueue(command: ExecutorCommand): Promise<string> {
    return this.rpc("enqueue_executor_command", { p_command: command });
  }
  claim(input: { commandId: string; providerId: string; executorId: string; at: string }): Promise<ClaimedExecutorCommand | null> {
    // Database time is authoritative. A caller cannot shift a lease/approval with a client timestamp.
    return this.rpc("claim_executor_command", { p_command_id: input.commandId, p_provider_id: input.providerId, p_executor_id: input.executorId });
  }
  async getClaim(commandId: string): Promise<ClaimedExecutorCommand | null> {
    const result = await this.db.from("executor_commands").select("payload,order_id,claim_token,dispatched_at,status")
      .eq("owner_id", this.owner).eq("id", commandId).maybeSingle();
    if (result.error) throw new Error("EXECUTOR_CLAIM_READ_FAILED");
    const row = result.data;
    if (!row?.claim_token || row.status === "PENDING") return null;
    const state = await this.db.from("executor_order_states").select("state").eq("owner_id", this.owner).eq("order_id", row.order_id).single();
    if (state.error) throw new Error("EXECUTOR_STATE_READ_FAILED");
    return { command: { ...(row.payload as ExecutorCommand), order: state.data.state as ManagedOrder }, claimToken: row.claim_token, claimedAt: row.dispatched_at };
  }
  complete(completion: CommandCompletion): Promise<boolean> {
    return this.rpc("complete_executor_command", { p_completion: completion });
  }
  async getExecutionState(input: { providerId: string; accountId: string; brokerOrderId: string }): Promise<ExecutionState | null> {
    const account = await this.db.from("broker_accounts").select("id").eq("owner_id", this.owner)
      .eq("provider", input.providerId).eq("external_account_id", input.accountId).maybeSingle();
    if (account.error) throw new Error("EXECUTOR_ACCOUNT_READ_FAILED");
    if (!account.data) return null;
    const order = await this.db.from("orders").select("id,agent_id,asset_id").eq("owner_id", this.owner)
      .eq("broker_account_id", account.data.id).eq("broker_order_id", input.brokerOrderId).maybeSingle();
    if (order.error) throw new Error("EXECUTOR_ORDER_READ_FAILED");
    if (!order.data) return null;
    const [state, ledger] = await Promise.all([
      this.db.from("executor_order_states").select("state").eq("owner_id", this.owner).eq("order_id", order.data.id).single(),
      this.db.from("executor_ledger_states").select("state,version").eq("owner_id", this.owner)
        .eq("broker_account_id", account.data.id).eq("agent_id", order.data.agent_id).eq("asset_id", order.data.asset_id).single(),
    ]);
    if (state.error || ledger.error) throw new Error("EXECUTOR_LEDGER_INITIALIZATION_REQUIRED");
    return { order: state.data.state as ManagedOrder, account: ledger.data.state as LedgerAccount, ledgerVersion: ledger.data.version };
  }
  commitExecution(commit: ExecutionCommit): Promise<"COMMITTED" | "DUPLICATE" | "CONFLICT"> {
    return this.rpc("commit_executor_execution", { p_commit: commit });
  }
  recordObservation(brokerAccountId: string, eventKey: string, kind: "EXECUTION" | "ACCOUNT" | "RECONCILIATION" | "GATEWAY_ERROR", payload: unknown): Promise<boolean> {
    return this.rpc("record_executor_observation", { p_broker_account_id: brokerAccountId, p_event_key: eventKey, p_kind: kind, p_payload: payload });
  }
}
