import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyCommandAcknowledgement } from "../src/core/executor";
import type { ClaimedExecutorCommand, CommandCompletion, ExecutionCommit, ExecutorCommand } from "../src/core/executor";
import { applyExecution, createOrder, transitionOrder } from "../src/core/oms";
import type { LedgerAccount } from "../src/core/oms";
import type { BrokerExecution } from "../src/core/broker";
import type { RiskContext, TradeProposal } from "../src/core/risk";

// Real PostgreSQL semantics in an ephemeral database. Only Auth bindings and account fixtures are synthetic.
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), outsider = id(2), asset = id(3), agent = id(4), broker = id(5);
const cash = id(6), invested = id(7), clearing = id(8);
const limits = { maxPositionPerAgent: "500", maxPortfolioExposure: "1000", maxOrderValue: "300",
  maxDailyLoss: "50", maxWeeklyLoss: "100", maxDrawdownBps: "1000", minCashReserve: "100",
  maxOpenPositions: 5, maxSectorExposure: "500", maxCorrelatedExposure: "600", maxOrdersPerMinute: 3,
  maxOrdersPerDay: 10, maxSlippageBps: "100", newsEmergencyThreshold: "0.8", maxQuoteAgeMs: 60000,
  maxBrokerSnapshotAgeMs: 60000, maxClockSkewMs: 1000 };
let db: PGlite;
let now: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
    create function auth.uid() returns uuid language sql stable as 'select (auth.jwt()->>''sub'')::uuid';
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;`);
  const directory = resolve("supabase/migrations");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort())
    await db.exec(readFileSync(resolve(directory, file), "utf8"));
}, 60000);
beforeEach(async () => {
  now = new Date().toISOString();
  await db.exec("begin");
  await db.query("insert into auth.users values ($1),($2)", [owner, outsider]);
  await db.query("insert into public.system_state(owner_id,live_trading_enabled,global_kill_switch) values($1,true,false)", [owner]);
  await db.query("insert into public.assets(id,owner_id,ticker,company_name) values($1,$2,'TEST3','Synthetic test company')", [asset, owner]);
  await db.query("insert into public.risk_profiles(id,owner_id,name,configured,limits) values($1,$2,'Risk fixture',true,$3::jsonb)", [id(9), owner, JSON.stringify(limits)]);
  await db.query("insert into public.strategies(id,owner_id,name) values($1,$2,'Synthetic test strategy')", [id(9001), owner]);
  await db.query("insert into public.strategy_versions(id,owner_id,strategy_id,version,definition,research_status) values($1,$2,$3,'1','{\"engine\":\"v1\"}','VALIDATED')", [id(9002), owner, id(9001)]);
  await db.query("insert into public.agents(id,owner_id,asset_id,name,risk_profile_id,strategy_id,strategy_version_id) values($1,$2,$3,'Synthetic test agent',$4,$5,$6)", [agent, owner, asset, id(9), id(9001), id(9002)]);
  await db.query(`insert into public.broker_accounts(id,owner_id,provider,external_account_id,connection_status,reconciled_at,capabilities)
    values($1,$2,'test-gateway','account-1','CONNECTED',clock_timestamp(),'{"completeAccountReconciliation":true}')`, [broker, owner]);
  await db.query(`insert into public.ledger_accounts(id,owner_id,account_key,name,kind,balance,agent_id) values
    ($1,$4,'cash','Cash fixture','AGENT_CASH',1000,$5),
    ($2,$4,'invested','Invested fixture','INVESTED',0,$5),
    ($3,$4,'clearing','External fixture','EXTERNAL_CLEARING',-1000,null)`, [cash, invested, clearing, owner, agent]);
  await service();
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });
async function admin() { await db.exec("set local role postgres"); }
async function service() { await db.exec("set local role service_role"); }
async function rejected(sql: string, args: unknown[], message: string) {
  await db.exec("savepoint expected_failure");
  try { await expect(db.query(sql, args)).rejects.toThrow(message); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}
async function seed(number = 10, side: "BUY" | "SELL" = "BUY") {
  const proposal: TradeProposal = { id: id(number), agentId: agent, symbol: "TEST3", side, quantity: 2,
    kind: "LIMIT", limitPrice: "100", stopPrice: null, createdAt: now,
    expiresAt: new Date(Date.now() + 120_000).toISOString(), dataTimestamp: now,
    strategyVersion: "v1", reasoningSummary: "Synthetic database fixture" };
  const client = `client-${number}`;
  const order = transitionOrder(transitionOrder(createOrder(proposal, "account-1", client), "RISK_REVIEW", now), "APPROVED", now);
  await admin();
  await db.query(`insert into public.decisions(id,owner_id,agent_id,asset_id,correlation_id,decision,strategy_version,
    reasoning_summary,inputs,result,data_timestamp) values($1,$2,$3,$4,$1,$5,'v1','Test fixture',$7::jsonb,'{}',$6)`,
  [id(number), owner, agent, asset, side, now, JSON.stringify({ configuration: {
    strategyId: id(9001), versionId: id(9002), version: "1", definition: { engine: "v1" },
    riskProfileId: id(9), riskProfileVersion: 1, riskLimits: limits,
  } })]);
  await db.query(`insert into public.trade_proposals(id,owner_id,agent_id,asset_id,decision_id,correlation_id,side,quantity,
    order_type,limit_price,risk_status,risk_result,approved_at,expires_at,risk_profile_version)
    values($1,$2,$3,$4,$1,$1,$5,2,'LIMIT',100,'APPROVED','{"approved":true,"estimatedDebit":"201"}',clock_timestamp(),$6,1)`,
  [id(number), owner, agent, asset, side, proposal.expiresAt]);
  await db.query(`insert into public.orders(id,owner_id,agent_id,asset_id,broker_account_id,proposal_id,correlation_id,
    idempotency_key,client_order_id,side,order_type,status,quantity,limit_price)
    values($1,$2,$3,$4,$5,$1,$1,$6,$6,$7,'LIMIT','APPROVED',2,100)`, [id(number), owner, agent, asset, broker, client, side]);
  await service();
  return { id: id(number + 100), kind: "SUBMIT", providerId: "test-gateway", accountId: "account-1",
    idempotencyKey: client, order, timeInForce: "DAY", riskContext: { ownerMfaVerified: true, limits } as RiskContext } satisfies ExecutorCommand;
}
async function enqueue(command: ExecutorCommand) {
  return (await db.query<{ value: string }>("select public.enqueue_executor_command($1,$2::jsonb) as value", [owner, JSON.stringify(command)])).rows[0].value;
}
async function claim(command: ExecutorCommand) {
  return (await db.query<{ value: ClaimedExecutorCommand | null }>("select public.claim_executor_command($1,$2,$3,'executor-test') as value",
    [owner, command.id, command.providerId])).rows[0].value;
}
async function complete(result: CommandCompletion) {
  return (await db.query<{ value: boolean }>("select public.complete_executor_command($1,$2::jsonb) as value", [owner, JSON.stringify(result)])).rows[0].value;
}
async function submitted() {
  const command = await seed(); await enqueue(command); const claimed = (await claim(command))!;
  const at = new Date().toISOString();
  const brokerOrder = { brokerOrderId: "broker-1", clientOrderId: command.order.clientOrderId, accountId: "account-1",
    symbol: "TEST3", side: "BUY", quantity: 2, filledQuantity: 0, status: "OPEN", observedAt: at } as const;
  const result = { ...applyCommandAcknowledgement(command, brokerOrder, at), commandId: command.id, claimToken: claimed.claimToken,
    expectedOrderVersion: command.order.version, brokerOrder, at };
  expect(await complete(result)).toBe(true);
  return { command, claimed, result };
}
async function fillFixture() {
  const setup = await submitted();
  const account: LedgerAccount = { accountId: "account-1", agentId: agent, symbol: "TEST3", cash: "1000", quantity: 0,
    costBasis: "0", realizedPnl: "0", totalFees: "0" };
  await db.query("select public.initialize_executor_ledger($1,$2,$3::jsonb,$4,$5,$6)",
    [owner, setup.command.order.id, JSON.stringify(account), cash, invested, clearing]);
  const at = new Date().toISOString();
  const execution: BrokerExecution = { executionId: "fill-1", brokerOrderId: "broker-1", accountId: "account-1",
    symbol: "TEST3", side: "BUY", quantity: 1, price: "99", fees: "0.5", executedAt: at };
  const result = applyExecution(setup.result.order, account, execution, at);
  const commit: ExecutionCommit = { providerId: "test-gateway", expectedOrderVersion: setup.result.order.version,
    expectedLedgerVersion: 0, order: result.order, account: result.account, execution, entry: result.entry!, breaches: result.breaches, at };
  return { ...setup, commit };
}
async function observe(execution: BrokerExecution) {
  return (await db.query<{ value: boolean }>("select public.record_executor_observation($1,$2,$3,'EXECUTION',$4::jsonb) as value",
    [owner, broker, `execution:${execution.executionId}`, JSON.stringify(execution)])).rows[0].value;
}
async function commitFill(commit: ExecutionCommit) {
  return (await db.query<{ value: string }>("select public.commit_executor_execution($1,$2::jsonb) as value", [owner, JSON.stringify(commit)])).rows[0].value;
}

describe("executor durable PostgreSQL dispatch", () => {
  it("reserves once, returns the same immutable command on replay, and claims at most once", async () => {
    const command = await seed(); expect(await enqueue(command)).toBe(command.id); expect(await enqueue(command)).toBe(command.id);
    const reservation = await db.query<{ amount: string; released_at: null }>("select amount,released_at from public.order_reservations");
    expect(reservation.rows).toEqual([{ amount: "201.0000000000", released_at: null }]);
    const outcomes = await Promise.all([claim(command), claim(command)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(outcomes.find(Boolean)?.command.order.state).toBe("APPROVED");
    expect((await db.query("select status,reconciliation_required from public.orders")).rows).toEqual([{ status: "SUBMITTING", reconciliation_required: true }]);
    expect((await db.query("select status from public.executor_commands")).rows).toEqual([{ status: "DISPATCHED" }]);
  });
  it("rejects changed idempotent payloads and serializes unresolved commands per order", async () => {
    const command = await seed(); await enqueue(command);
    await rejected("select public.enqueue_executor_command($1,$2::jsonb)", [owner, JSON.stringify({ ...command, timeInForce: "GTC" })], "ATLAS_IDEMPOTENCY_CONFLICT");
    await rejected("select public.enqueue_executor_command($1,$2::jsonb)", [owner, JSON.stringify({ ...command, id: id(999), idempotencyKey: "changed" })], "ATLAS_APPROVED_ORDER_REQUIRED");
    expect((await db.query("select id from public.executor_commands")).rows).toHaveLength(1);
  });
  it("does not reserve money already committed to another order", async () => {
    const first = await seed(10), second = await seed(11);
    await admin(); await db.query("update public.ledger_accounts set balance=300 where id=$1", [cash]); await service();
    await enqueue(first);
    await rejected("select public.enqueue_executor_command($1,$2::jsonb)", [owner, JSON.stringify(second)], "ATLAS_INSUFFICIENT_UNRESERVED_CASH");
    expect((await db.query("select id from public.executor_commands")).rows).toHaveLength(1);
    expect((await db.query("select id from public.order_reservations")).rows).toHaveLength(1);
  });
  it("reserves owned stock and prevents a second order selling the same shares", async () => {
    const first = await seed(10, "SELL"), second = await seed(11, "SELL");
    await admin(); await db.query(`insert into public.positions(owner_id,broker_account_id,asset_id,agent_id,quantity,reserved_quantity,reconciled_at)
      values($1,$2,$3,$4,3,0,clock_timestamp())`, [owner, broker, asset, agent]); await service();
    await enqueue(first);
    await rejected("select public.enqueue_executor_command($1,$2::jsonb)", [owner, JSON.stringify(second)], "ATLAS_INSUFFICIENT_UNRESERVED_STOCK");
    expect((await db.query("select reserved_quantity from public.positions")).rows).toEqual([{ reserved_quantity: "2.0000000000" }]);
  });
  it("blocks non-approved terms and current kill switch at dispatch", async () => {
    const command = await seed();
    await rejected("select public.enqueue_executor_command($1,$2::jsonb)", [owner, JSON.stringify({ ...command,
      order: { ...command.order, proposal: { ...command.order.proposal, quantity: 3 } } })], "ATLAS_RISK_APPROVAL_REQUIRED");
    await enqueue(command); await admin(); await db.query("update public.system_state set global_kill_switch=true where owner_id=$1", [owner]); await service();
    expect(await claim(command)).toBeNull();
    expect((await db.query("select status from public.executor_commands")).rows).toEqual([{ status: "PENDING" }]);
  });
  it("requires current persisted approval at claim time, not just enqueue time", async () => {
    const command = await seed(); await enqueue(command);
    await admin(); await db.query("update public.trade_proposals set expires_at=clock_timestamp()-interval '1 second' where id=$1", [command.order.id]); await service();
    expect(await claim(command)).toBeNull();
  });
  it("preserves reservations while UNKNOWN and permits recovery only with the original token and current CAS", async () => {
    const command = await seed(); await enqueue(command); const claimed = (await claim(command))!;
    const pending = transitionOrder(command.order, "SUBMITTING", now);
    const unknown = transitionOrder(pending, "SUBMISSION_UNKNOWN", now);
    const result: CommandCompletion = { commandId: command.id, claimToken: claimed.claimToken,
      expectedOrderVersion: command.order.version, status: "UNKNOWN", order: unknown, brokerOrder: null,
      reconciliationRequired: true, reasons: ["GATEWAY_OUTCOME_UNKNOWN"], at: now };
    expect(await complete({ ...result, claimToken: id(999) })).toBe(false);
    expect(await complete(result)).toBe(true);
    expect(await claim(command)).toBeNull(); expect(await complete(result)).toBe(false);
    expect((await db.query("select released_at from public.order_reservations")).rows).toEqual([{ released_at: null }]);
    const next = { ...result, expectedOrderVersion: unknown.version, order: { ...unknown, version: unknown.version + 1 } };
    expect(await complete(next)).toBe(true); expect(await claim(command)).toBeNull();
  });
  it("allows a known open order cancellation after kill switch activation", async () => {
    const setup = await submitted();
    const cancel: ExecutorCommand = { ...setup.command, id: id(120), kind: "CANCEL", idempotencyKey: "cancel-1", order: setup.result.order };
    await admin(); await db.query("update public.system_state set global_kill_switch=true,live_trading_enabled=false where owner_id=$1", [owner]); await service();
    await enqueue(cancel); expect((await claim(cancel))?.command.kind).toBe("CANCEL");
    expect((await db.query("select status from public.orders")).rows).toEqual([{ status: "CANCEL_REQUESTED" }]);
  });
  it("rejects attempts to mutate immutable payloads or recycle a claim", async () => {
    const command = await seed(); await enqueue(command); await claim(command); await admin();
    await rejected("update public.executor_commands set payload=jsonb_set(payload,'{timeInForce}','\"GTC\"') where id=$1", [command.id], "ATLAS_COMMAND_IMMUTABLE");
    await rejected("update public.executor_commands set status='PENDING',claim_token=null where id=$1", [command.id], "ATLAS_COMMAND_IMMUTABLE");
  });
});

describe("executor PostgreSQL execution evidence and ledger", () => {
  it("refuses an unpersisted fill, then atomically posts exact partial-fill ledger once", async () => {
    const { commit } = await fillFixture();
    await rejected("select public.commit_executor_execution($1,$2::jsonb)", [owner, JSON.stringify(commit)], "ATLAS_PERSISTED_EXECUTION_REQUIRED");
    expect(await observe(commit.execution)).toBe(true); expect(await commitFill(commit)).toBe("COMMITTED");
    expect(await commitFill(commit)).toBe("DUPLICATE");
    expect((await db.query("select kind,balance from public.ledger_accounts order by kind")).rows).toEqual([
      { kind: "AGENT_CASH", balance: "900.5000000000" }, { kind: "EXTERNAL_CLEARING", balance: "-1000.0000000000" }, { kind: "INVESTED", balance: "99.5000000000" },
    ]);
    expect((await db.query("select status,filled_quantity,reconciliation_required from public.orders")).rows).toEqual([
      { status: "PARTIALLY_FILLED", filled_quantity: "1.0000000000", reconciliation_required: true },
    ]);
    expect((await db.query("select id from public.executions")).rows).toHaveLength(1);
    expect((await db.query("select id from public.ledger_transactions where kind='FILL'")).rows).toHaveLength(1);
    expect((await db.query("select sum(amount)::text as balance from public.ledger_entries")).rows[0]).toEqual({ balance: "0.0000000000" });
    expect((await db.query("select id from public.positions")).rows).toHaveLength(0);
    expect((await db.query("select state->>'quantity' as quantity from public.executor_ledger_states")).rows[0]).toEqual({ quantity: "1" });
    expect((await db.query("select reconciled_at from public.broker_accounts")).rows[0]).toEqual({ reconciled_at: null });
  });
  it("detects conflicting raw fill evidence, retains the original payload and activates kill switch", async () => {
    const { commit } = await fillFixture(); expect(await observe(commit.execution)).toBe(true);
    expect(await observe(commit.execution)).toBe(true);
    expect(await observe({ ...commit.execution, price: "98" })).toBe(false);
    expect((await db.query<{ payload: BrokerExecution }>("select payload from public.executor_observations")).rows[0].payload).toEqual(commit.execution);
    expect((await db.query("select live_trading_enabled,global_kill_switch from public.system_state")).rows).toEqual([
      { live_trading_enabled: false, global_kill_switch: true },
    ]);
  });
  it("rejects stale ledger versions before accounting and rejects forged cash", async () => {
    const { commit } = await fillFixture(); await observe(commit.execution);
    expect(await commitFill({ ...commit, expectedLedgerVersion: 5 })).toBe("CONFLICT");
    await rejected("select public.commit_executor_execution($1,$2::jsonb)", [owner, JSON.stringify({ ...commit,
      account: { ...commit.account, cash: "9999" } })], "ATLAS_EXECUTION_ACCOUNTING_MISMATCH");
    expect((await db.query("select id from public.executions")).rows).toHaveLength(0);
    expect((await db.query("select balance from public.ledger_accounts where id=$1", [cash])).rows[0]).toEqual({ balance: "1000.0000000000" });
  });
  it("refuses initialization that would manufacture funding", async () => {
    const { command } = await submitted();
    const forged = { accountId: "account-1", agentId: agent, symbol: "TEST3", cash: "1001", quantity: 0, costBasis: "0", realizedPnl: "0", totalFees: "0" };
    await rejected("select public.initialize_executor_ledger($1,$2,$3::jsonb,$4,$5,$6)", [owner, command.order.id, JSON.stringify(forged), cash, invested, clearing], "ATLAS_LEDGER_EVIDENCE_MISMATCH");
    expect((await db.query("select state from public.executor_ledger_states")).rows).toHaveLength(0);
  });
});

describe("executor database access controls", () => {
  it("exposes owner AAL2 read only and denies financial RPCs to browser roles", async () => {
    const command = await seed(); await enqueue(command);
    for (const [who, aal, visible] of [[owner, "aal2", 1], [owner, "aal1", 0], [outsider, "aal2", 0]] as const) {
      await admin(); await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: who, aal })]);
      await db.exec("set local role authenticated");
      expect((await db.query("select id from public.executor_commands")).rows).toHaveLength(visible);
      await rejected("select public.enqueue_executor_command($1,$2::jsonb)", [owner, JSON.stringify(command)], "permission denied");
      await rejected("select public.claim_executor_command($1,$2,$3,'browser')", [owner, command.id, command.providerId], "permission denied");
      await rejected("select public.commit_executor_execution($1,'{}'::jsonb)", [owner], "permission denied");
    }
    await db.exec("set local role anon"); await rejected("select * from public.executor_commands", [], "permission denied");
  });
  it("requires the configured owner and denies service role direct mutation", async () => {
    const command = await seed();
    await rejected("select public.enqueue_executor_command($1,$2::jsonb)", [outsider, JSON.stringify(command)], "ATLAS_OWNER_REQUIRED");
    for (const table of ["executor_commands", "executor_order_states", "executor_ledger_states", "executor_observations"])
      await rejected(`delete from public.${table}`, [], "permission denied");
  });
});

describe("Executor adversarial accounting and recovery", () => {
  it("registers observed gateway identity without inventing money or enabling it", async () => {
    const call = () => db.query<{ value: string }>("select public.register_execution_gateway($1,'MT5',$2::jsonb,$3::jsonb) as value", [owner,
      JSON.stringify({ accountId: "different-official-account-fixture", currency: "BRL", mode: "OFFICIAL_SANDBOX" }),
      JSON.stringify({ providerId: "MT5", completeAccountReconciliation: false })]);
    expect((await call()).rows[0].value).toBe((await call()).rows[0].value);
    expect((await db.query("select connection_status,reconciled_at from public.broker_accounts where provider='MT5'")).rows[0]).toEqual({ connection_status: "PENDING", reconciled_at: null });
    expect((await db.query("select * from public.ledger_transactions")).rows).toHaveLength(0);
  });
  it("rechecks the risk profile and reservation immediately before dispatch", async () => {
    const command = await seed(); await enqueue(command);
    await admin(); await db.query("update public.trade_proposals set risk_profile_version=2 where id=$1", [command.order.id]); await service();
    expect(await claim(command)).toBeNull();
    await admin(); await db.query("update public.trade_proposals set risk_profile_version=1 where id=$1", [command.order.id]);
    await db.query("update public.ledger_accounts set balance=100 where id=$1", [cash]); await service();
    expect(await claim(command)).toBeNull();
  });
  it("refuses ACK state/broker-ID tampering without changing fill evidence", async () => {
    const { result } = await submitted();
    await rejected("select public.complete_executor_command($1,$2::jsonb)", [owner, JSON.stringify({ ...result,
      expectedOrderVersion: result.order.version, order: { ...result.order, brokerOrderId: "another-ticket", version: result.order.version + 1 } })], "ATLAS_INVALID_COMMAND_COMPLETION");
    await rejected("select public.complete_executor_command($1,$2::jsonb)", [owner, JSON.stringify({ ...result,
      expectedOrderVersion: result.order.version, order: { ...result.order, state: "FILLED", version: result.order.version + 1 } })], "ATLAS_INVALID_ORDER_TRANSITION");
  });
  it("validates identity even on duplicate execution paths", async () => {
    const { commit } = await fillFixture(); await observe(commit.execution); await commitFill(commit);
    for (const patch of [{ accountId: "other-account" }, { side: "SELL" }, { symbol: "OTHER3" }])
      await rejected("select public.commit_executor_execution($1,$2::jsonb)", [owner, JSON.stringify({ ...commit, execution: { ...commit.execution, ...patch } })], "ATLAS_EXECUTION_IDENTITY_MISMATCH");
  });
  it("refuses forged fees, realized P&L and notional projections", async () => {
    const { commit } = await fillFixture(); await observe(commit.execution);
    for (const patch of [
      { account: { ...commit.account, realizedPnl: "100" } }, { account: { ...commit.account, totalFees: "0" } },
      { order: { ...commit.order, filledNotional: "1" } }, { order: { ...commit.order, fees: "0" } },
    ]) await rejected("select public.commit_executor_execution($1,$2::jsonb)", [owner, JSON.stringify({ ...commit, ...patch })], "ATLAS_EXECUTION_ACCOUNTING_MISMATCH");
    expect((await db.query("select * from public.executions")).rows).toHaveLength(0);
  });
  it("keeps an actual cash-deficit fill in the inbox when posting fails", async () => {
    const { commit } = await fillFixture(); await observe(commit.execution);
    await admin(); await db.query("update public.ledger_accounts set balance=1 where id=$1", [cash]); await service();
    await rejected("select public.commit_executor_execution($1,$2::jsonb)", [owner, JSON.stringify(commit)], "ATLAS_EXECUTOR_LEDGER_DIVERGED");
    expect((await db.query("select * from public.executor_observations")).rows).toHaveLength(1);
    expect((await db.query("select * from public.executions")).rows).toHaveLength(0);
  });
  it("stores all pages atomically, resumes with a cursor and defers unverified fees", async () => {
    const { commit } = await fillFixture(); const provisional = { ...commit.execution, feesVerified: false };
    const stage = async (expected: string | null, next: string | null, fills: unknown[]) =>
      (await db.query<{ ok: boolean }>("select public.stage_executor_executions($1,$2,$3,$4,$5::jsonb) as ok", [owner, broker, expected, next, JSON.stringify(fills)])).rows[0].ok;
    expect(await stage(null, "cursor-1", [provisional])).toBe(true);
    expect(await stage(null, "cursor-2", [])).toBe(false);
    expect(await stage("cursor-1", null, [{ ...provisional, executionId: "fill-2" }])).toBe(true);
    const backlog = (await db.query<{ data: { pendingCount: number; unverifiedFeesCount: number; pending: unknown[] } }>("select public.executor_execution_backlog($1,$2) as data", [owner, broker])).rows[0].data;
    expect(backlog).toEqual({ pending: [], pendingCount: 2, unverifiedFeesCount: 2 });
    expect((await db.query("select cursor,history_complete from public.executor_sync")).rows).toEqual([{ cursor: null, history_complete: true }]);
    await rejected("select public.commit_executor_execution($1,$2::jsonb)", [owner, JSON.stringify({ ...commit, execution: provisional })], "ATLAS_EXECUTION_FEES_UNVERIFIED");
  });
  it("uses the same half-even accounting rounding as decimal.js", async () => {
    await admin();
    expect((await db.query<{ value: string }>("select atlas_private.executor_round8(1.000000005)::text as value")).rows[0].value).toBe("1.00000000000000000000");
    expect(Number((await db.query<{ value: string }>("select atlas_private.executor_round8(1.000000015)::text as value")).rows[0].value)).toBe(1.00000002);
  });
  it("accounts a round trip with partial sell and rejects invented remaining cost basis", async () => {
    const setup = await fillFixture(); await observe(setup.commit.execution); await commitFill(setup.commit);
    const at = new Date().toISOString();
    const second = { ...setup.commit.execution, executionId: "fill-2", executedAt: at };
    const secondResult = applyExecution(setup.commit.order, setup.commit.account, second, at);
    const secondCommit: ExecutionCommit = { ...setup.commit, expectedOrderVersion: setup.commit.order.version, expectedLedgerVersion: 1,
      execution: second, order: secondResult.order, account: secondResult.account, entry: secondResult.entry!, at };
    await observe(second); expect(await commitFill(secondCommit)).toBe("COMMITTED");
    await admin(); await db.query("insert into public.ledger_accounts(owner_id,account_key,name,kind) values($1,'broker-cash','Broker cash fixture','BROKER_CASH')", [owner]); await service();
    const local = (await db.query<{ data: object }>("select public.executor_reconciliation_snapshot($1,$2) as data", [owner, broker])).rows[0].data;
    const result = { matches: true, discrepancies: [], checkedAt: new Date().toISOString() };
    await db.query("select public.record_executor_observation($1,$2,'buy-recon','RECONCILIATION',$3::jsonb)", [owner, broker, JSON.stringify({ result })]);
    expect((await db.query<{ ok: boolean }>("select public.finish_executor_reconciliation($1,$2,$3::jsonb,$4::jsonb) as ok", [owner, broker, JSON.stringify(result), JSON.stringify(local)])).rows[0].ok).toBe(true);
    const sell = await seed(30, "SELL"); await enqueue(sell); const claimed = (await claim(sell))!;
    const sellAt = new Date().toISOString();
    const brokerOrder = { brokerOrderId: "sell-ticket", clientOrderId: sell.order.clientOrderId, accountId: "account-1", symbol: "TEST3", side: "SELL" as const, quantity: 2, filledQuantity: 0, status: "OPEN" as const, observedAt: sellAt };
    const ack = { ...applyCommandAcknowledgement(sell, brokerOrder, sellAt), commandId: sell.id, claimToken: claimed.claimToken, expectedOrderVersion: sell.order.version, brokerOrder, at: sellAt };
    expect(await complete(ack)).toBe(true);
    const execution: BrokerExecution = { ...second, executionId: "sell-fill", brokerOrderId: "sell-ticket", side: "SELL", price: "105", executedAt: sellAt };
    const applied = applyExecution(ack.order, secondCommit.account, execution, sellAt);
    const commit: ExecutionCommit = { providerId: "test-gateway", expectedOrderVersion: ack.order.version, expectedLedgerVersion: 2, order: applied.order, account: applied.account, execution, entry: applied.entry!, breaches: applied.breaches, at: sellAt };
    await observe(execution);
    await rejected("select public.commit_executor_execution($1,$2::jsonb)", [owner, JSON.stringify({ ...commit, account: { ...commit.account, costBasis: "198" } })], "ATLAS_EXECUTION_BASIS_MISMATCH");
    expect(await commitFill(commit)).toBe("COMMITTED");
    expect(commit.account).toMatchObject({ cash: "905.5", quantity: 1, costBasis: "99.5", realizedPnl: "5", totalFees: "1.5" });
    expect((await db.query<{ total: string }>("select sum(amount)::text as total from public.ledger_entries")).rows[0].total).toBe("0.0000000000");
    expect((await db.query<{ executor_stock_reserved: string }>("select executor_stock_reserved from public.orders where id=$1", [sell.order.id])).rows[0].executor_stock_reserved).toBe("1.0000000000");
  });
  it("releases terminal reservations only after fresh persisted matching reconciliation", async () => {
    const setup = await submitted();
    const cancelled = transitionOrder(setup.result.order, "CANCELLED", new Date().toISOString());
    const completion: CommandCompletion = { ...setup.result, expectedOrderVersion: setup.result.order.version, order: cancelled };
    expect(await complete(completion)).toBe(true);
    await admin(); await db.query("insert into public.ledger_accounts(owner_id,account_key,name,kind) values($1,'broker-cash','Broker cash fixture','BROKER_CASH')", [owner]); await service();
    const local = (await db.query<{ data: object }>("select public.executor_reconciliation_snapshot($1,$2) as data", [owner, broker])).rows[0].data;
    const result = { matches: true, discrepancies: [], checkedAt: new Date().toISOString() };
    await rejected("select public.finish_executor_reconciliation($1,$2,$3::jsonb,$4::jsonb)", [owner, broker, JSON.stringify(result), JSON.stringify(local)], "ATLAS_PERSISTED_RECONCILIATION_REQUIRED");
    await db.query("select public.record_executor_observation($1,$2,'recon-1','RECONCILIATION',$3::jsonb)", [owner, broker, JSON.stringify({ result })]);
    expect((await db.query<{ ok: boolean }>("select public.finish_executor_reconciliation($1,$2,$3::jsonb,$4::jsonb) as ok", [owner, broker, JSON.stringify(result), JSON.stringify(local)])).rows[0].ok).toBe(true);
    expect((await db.query("select released_at is not null as released from public.order_reservations")).rows[0]).toEqual({ released: true });
  });
});
