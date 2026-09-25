import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { analyzeAsset } from "@/core/analysis";
import type { MarketHistory, MarketQuote } from "@/providers/types";

// These fixtures exist only inside the ephemeral PostgreSQL test database.
const owner = "10000000-0000-4000-8000-000000000001";
const outsider = "10000000-0000-4000-8000-000000000002";
const assetId = "20000000-0000-4000-8000-000000000001";
let db: PGlite;

async function admin() {
  await db.exec("set local role postgres");
}
async function service() {
  await db.exec("set local role service_role");
}
async function signedIn(id: string, aal = "aal2") {
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: id, aal, role: "authenticated" }),
  ]);
  await db.exec("set local role authenticated");
}
async function rejected(sql: string, params: unknown[], message: string) {
  await db.exec("savepoint expected_failure");
  try {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  } finally {
    await db.exec(
      "rollback to savepoint expected_failure; release savepoint expected_failure",
    );
  }
}
async function agent(name = "Agent fixture") {
  const result = await db.query<{ id: string; status: string }>(
    "select id,status from public.create_agent($1,$2,$3,'atlas','125.10')",
    [owner, assetId, name],
  );
  return result.rows[0];
}
async function account(key: string, kind: string) {
  const result = await db.query<{ id: string }>(
    "select id from public.create_ledger_account($1,$2,$2,$3)",
    [owner, key, kind],
  );
  return result.rows[0].id;
}
async function post(
  key: string,
  kind: string,
  lines: { accountId: string; amount: string }[],
  external: string | null = null,
) {
  return db.query<{ id: string }>(
    "select public.post_ledger_transaction($1,$2,$3,$4::jsonb,'official-provider-test-fixture','fixture verification',$5) as id",
    [owner, key, kind, JSON.stringify(lines), external],
  );
}
type ClaimedJob = { job_id: string; agent_id: string; lease_token: string };
async function claimAnalysis() {
  const created = await agent();
  await db.query("select public.update_agent_enabled($1,$2,true)", [
    owner,
    created.id,
  ]);
  return (
    await db.query<ClaimedJob>("select * from public.claim_due_agents($1)", [
      owner,
    ])
  ).rows[0];
}
function analysisEvidence(ticker = "TEST3") {
  const now = new Date().toISOString();
  const quote: MarketQuote = {
    ticker,
    price: "31.05",
    currency: "BRL",
    dataTimestamp: new Date(Date.now() - 60000).toISOString(),
    retrievedAt: now,
    source: "https://example.test/quote",
    feed: "DELAYED",
    freshness: "DELAYED",
    ageSeconds: 60,
    tradable: false,
  };
  const history: MarketHistory = {
    ticker,
    interval: "1d",
    range: "3mo",
    retrievedAt: now,
    source: "https://example.test/history",
    feed: "EOD",
    tradable: false,
    bars: Array.from({ length: 60 }, (_, index) => ({
      timestamp: new Date(Date.now() - (60 - index) * 86400000).toISOString(),
      open: "30",
      high: "32",
      low: "29",
      close: "31",
      adjustedClose: null,
      volume: 1000,
    })),
  };
  const inputs = { quote, history, news: [], macro: [] };
  const result = analyzeAsset({ ticker, now, ...inputs });
  return { result, inputs };
}
async function finishAnalysis(
  job: ClaimedJob,
  evidence: ReturnType<typeof analysisEvidence>,
) {
  return db.query<{ id: string }>(
    "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb) as id",
    [
      owner,
      job.job_id,
      job.lease_token,
      JSON.stringify(evidence.result),
      JSON.stringify(evidence.inputs),
    ],
  );
}

beforeAll(async () => {
  db = new PGlite();
  // Managed Supabase's Auth/roles are not available in PGlite. Only these bindings are stubbed.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
    create function auth.uid() returns uuid language sql stable as
      'select (auth.jwt()->>''sub'')::uuid';
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
  `);
  const directory = resolve("supabase/migrations");
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(resolve(directory, file), "utf8"));
  }
}, 60000);

beforeEach(async () => {
  await db.exec("begin");
  await db.query("insert into auth.users(id) values ($1),($2)", [
    owner,
    outsider,
  ]);
  await db.query("insert into public.system_state(owner_id) values ($1)", [
    owner,
  ]);
  await db.query(
    "insert into public.assets(id,owner_id,ticker,company_name) values ($1,$2,'TEST3','Test fixture company')",
    [assetId, owner],
  );
  await service();
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});

describe("paper trading isolated virtual book", () => {
  async function openPaper() {
    await db.query("select public.paper_open_account($1,1000,200,500,50)", [owner]);
  }
  async function propose(agentId: string, side: string, quantity: number, limit: string, key: string) {
    return (await db.query<{ id: string; status: string }>(
      `select id,status from public.paper_create_proposal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
      [owner, agentId, side, quantity, limit, "10.00", "https://example.test/quote",
        new Date(Date.now() - 600000).toISOString(), "https://example.test/history",
        new Date(Date.now() - 600000).toISOString(), "paper-fixture/1", "Proposta de teste virtual com origem explícita.",
        JSON.stringify({ sma3: "10", sma8: "9" }), key],
    )).rows[0];
  }
  it("persists approval, next-quote fill, balanced virtual ledger and idempotency", async () => {
    await openPaper();
    const a = await agent("Virtual trader");
    await db.query("select public.update_agent_enabled($1,$2,true)", [owner, a.id]);
    const key = "30000000-0000-4000-8000-000000000001";
    const first = await propose(a.id, "BUY", 2, "10.50", key);
    const same = await propose(a.id, "BUY", 2, "10.50", key);
    expect(same.id).toBe(first.id);
    const review = await db.query<{ result: { status: string; orderId: string } }>(
      "select public.paper_review_proposal($1,$2,true) as result", [owner, first.id],
    );
    expect(review.rows[0].result.status).toBe("OPEN");
    const prior = await db.query<{ result: { filled: number } }>(
      "select public.paper_settle_quote($1,$2,10,'https://example.test/quote',$3) as result",
      [owner, assetId, new Date(Date.now() - 600000).toISOString()],
    );
    expect(prior.rows[0].result.filled).toBe(0);
    await admin();
    await db.query("update public.paper_orders set placed_at=now()-interval '2 minutes' where id=$1", [review.rows[0].result.orderId]);
    await service();
    const settled = await db.query<{ result: { filled: number } }>(
      "select public.paper_settle_quote($1,$2,10,'https://example.test/quote',$3) as result",
      [owner, assetId, new Date(Date.now() - 60000).toISOString()],
    );
    expect(settled.rows[0].result.filled).toBe(1);
    const repeated = await db.query<{ result: { filled: number } }>(
      "select public.paper_settle_quote($1,$2,10,'https://example.test/quote',$3) as result",
      [owner, assetId, new Date(Date.now() - 60000).toISOString()],
    );
    expect(repeated.rows[0].result.filled).toBe(0);
    const account = await db.query<{ cash: string; reserved_cash: string }>("select cash,reserved_cash from public.paper_accounts where owner_id=$1", [owner]);
    expect(Number(account.rows[0].cash)).toBeLessThan(1000);
    expect(Number(account.rows[0].reserved_cash)).toBe(0);
    const positions = await db.query<{ quantity: number }>("select quantity from public.paper_positions where owner_id=$1", [owner]);
    expect(positions.rows[0].quantity).toBe(2);
    const sell = await propose(a.id, "SELL", 1, "10.00", "30000000-0000-4000-8000-000000000005");
    const sellReview = await db.query<{ result: { status: string; orderId: string } }>(
      "select public.paper_review_proposal($1,$2,true) as result", [owner, sell.id],
    );
    expect(sellReview.rows[0].result.status).toBe("OPEN");
    await admin();
    await db.query("update public.paper_orders set placed_at=now()-interval '2 minutes' where id=$1", [sellReview.rows[0].result.orderId]);
    await service();
    const sale = await db.query<{ result: { filled: number } }>(
      "select public.paper_settle_quote($1,$2,11,'https://example.test/quote',$3) as result",
      [owner, assetId, new Date(Date.now() - 60000).toISOString()],
    );
    expect(sale.rows[0].result.filled).toBe(1);
    const closed = await db.query<{ quantity: number; realized_pnl: string }>(
      "select quantity,realized_pnl from public.paper_positions where owner_id=$1", [owner],
    );
    expect(closed.rows[0].quantity).toBe(1);
    expect(Number(closed.rows[0].realized_pnl)).toBeGreaterThan(0);
    const balance = await db.query<{ total: string }>("select sum(amount) as total from public.paper_ledger_entries where owner_id=$1", [owner]);
    expect(Number(balance.rows[0].total)).toBe(0);
    const real = await db.query<{ count: string }>("select count(*) from public.orders where owner_id=$1", [owner]);
    expect(Number(real.rows[0].count)).toBe(0);
  });

  it("rejects insufficient virtual cash, short selling and direct anonymous access", async () => {
    await openPaper();
    const a = await agent("Risk fixture");
    await db.query("select public.update_agent_enabled($1,$2,true)", [owner, a.id]);
    const buy = await propose(a.id,"BUY",20,"10.00","30000000-0000-4000-8000-000000000002");
    const buyReview = await db.query<{ result: { status: string; risk: { reasons: string[] } } }>(
      "select public.paper_review_proposal($1,$2,true) as result", [owner,buy.id],
    );
    expect(buyReview.rows[0].result.status).toBe("REJECTED");
    expect(buyReview.rows[0].result.risk.reasons).toContain("AGENT_BUDGET_LIMIT");
    const sell = await propose(a.id,"SELL",1,"10.00","30000000-0000-4000-8000-000000000003");
    const sellReview = await db.query<{ result: { risk: { reasons: string[] } } }>(
      "select public.paper_review_proposal($1,$2,true) as result", [owner,sell.id],
    );
    expect(sellReview.rows[0].result.risk.reasons).toContain("SHORT_SELLING_FORBIDDEN");
    await db.exec("set local role anon");
    await rejected("select public.paper_open_account($1,1000,200,500,50)",[owner],"permission denied");
    await rejected("select * from public.paper_accounts", [], "permission denied");
    await signedIn(outsider);
    const visible = await db.query("select * from public.paper_accounts");
    expect(visible.rows).toHaveLength(0);
  });

  it("pauses and cancels virtual orders without touching real execution", async () => {
    await openPaper();
    const a = await agent("Pause fixture");
    await db.query("select public.update_agent_enabled($1,$2,true)", [owner,a.id]);
    const proposal = await propose(a.id,"BUY",1,"10.50","30000000-0000-4000-8000-000000000004");
    await db.query("select public.paper_review_proposal($1,$2,true)",[owner,proposal.id]);
    await db.query("select public.paper_set_paused($1,true)",[owner]);
    const order = await db.query<{ status: string }>("select status from public.paper_orders where proposal_id=$1",[proposal.id]);
    expect(order.rows[0].status).toBe("CANCELLED");
    const account = await db.query<{ paused: boolean; reserved_cash: string }>("select paused,reserved_cash from public.paper_accounts where owner_id=$1",[owner]);
    expect(account.rows[0].paused).toBe(true);
    expect(Number(account.rows[0].reserved_cash)).toBe(0);
  });
});

it.skipIf(process.env.ATLAS_PUBLIC_DATA_SMOKE !== "1")(
  "real public data -> analysis -> PostgreSQL decision, memory and audit",
  async () => {
    const { fetchQuote, fetchHistory, fetchNews, fetchMacro } = await import(
      "@/providers"
    );
    const { analyzeAsset } = await import("@/core/analysis");
    // This symbol is a public provider test instrument, not a production universe.
    const ticker = "PETR4";
    const [quote, history, news, macro] = await Promise.all([
      fetchQuote(ticker),
      fetchHistory(ticker),
      fetchNews(),
      fetchMacro(),
    ]);
    await admin();
    await db.query("update public.assets set ticker=$1 where id=$2", [
      ticker,
      assetId,
    ]);
    await service();
    const created = await agent("Public data integration fixture");
    await db.query("select public.update_agent_enabled($1,$2,true)", [
      owner,
      created.id,
    ]);
    const claimed = await db.query<{ job_id: string; lease_token: string }>(
      "select * from public.claim_due_agents($1)",
      [owner],
    );
    const job = claimed.rows[0];
    const result = analyzeAsset({
      ticker,
      quote,
      history,
      news,
      macro,
      now: new Date().toISOString(),
    });
    const saved = await db.query<{ id: string }>(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb) as id",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify(result),
        JSON.stringify({ quote, history, news: news.slice(0, 5), macro }),
      ],
    );
    expect(saved.rows[0].id).toBeTruthy();
    expect(result.decision).toBe("HOLD");
    expect(result.risk.approved).toBe(false);
    expect(
      (
        await db.query("select * from public.decisions where id=$1", [
          saved.rows[0].id,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from public.agent_memories where agent_id=$1",
          [created.id],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from public.audit_logs where action='ANALYSIS_COMMITTED'",
        )
      ).rows,
    ).toHaveLength(1);
    expect((await db.query("select * from public.orders")).rows).toHaveLength(
      0,
    );
  },
  60000,
);

describe("real PostgreSQL migration in PGlite (Supabase Auth/Cron integration remains pending)", () => {
  it("enables RLS for every application table and defines no browser write policy", async () => {
    await admin();
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'",
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(30);
    expect(tables.rows.every((table) => table.relrowsecurity)).toBe(true);
    const policies = await db.query<{ count: number }>(
      "select count(*)::int as count from pg_policies where schemaname='public' and cmd <> 'SELECT'",
    );
    expect(policies.rows[0].count).toBe(0);
  });

  it("permits only the configured owner with AAL2 to read rows", async () => {
    await admin();
    await db.query(
      "insert into public.assets(owner_id,ticker,company_name) values ($1,'OTHER3','Other fixture')",
      [outsider],
    );
    await signedIn(owner);
    expect((await db.query("select id from public.assets")).rows).toHaveLength(
      1,
    );
    await signedIn(owner, "aal1");
    expect((await db.query("select id from public.assets")).rows).toHaveLength(
      0,
    );
    await signedIn(outsider);
    expect((await db.query("select id from public.assets")).rows).toHaveLength(
      0,
    );
    await db.exec("set local role anon");
    await rejected("select * from public.assets", [], "permission denied");
  });

  it("denies browser mutations and execution of privileged RPCs", async () => {
    await signedIn(owner);
    await rejected(
      "update public.system_state set global_kill_switch=false",
      [],
      "permission denied",
    );
    await rejected(
      "select public.set_kill_switch($1,false,'test')",
      [owner],
      "permission denied",
    );
    await rejected(
      "select public.claim_due_agents($1)",
      [owner],
      "permission denied",
    );
    await rejected(
      "select public.create_agent($1,$2,'test','atlas','1')",
      [owner, assetId],
      "permission denied",
    );
  });

  it("does not grant financial writes directly even to service_role", async () => {
    for (const table of [
      "ledger_entries",
      "ledger_accounts",
      "ledger_transactions",
      "orders",
      "executions",
      "positions",
      "treasury_transactions",
      "audit_logs",
    ]) {
      await rejected(`delete from public.${table}`, [], "permission denied");
    }
    await rejected(
      "update public.ledger_accounts set balance=1000",
      [],
      "permission denied",
    );
  });

  it("creates a paused agent with a budget cap and an empty real ledger account", async () => {
    const created = await agent();
    expect(created.status).toBe("PAUSED");
    const result = await db.query<{
      balance: string;
      budget: string;
      enabled: boolean;
    }>(
      "select a.budget::text,a.enabled,l.balance::text from public.agents a join public.ledger_accounts l on l.agent_id=a.id where a.id=$1",
      [created.id],
    );
    expect(result.rows[0]).toEqual({
      budget: "125.1000000000",
      enabled: false,
      balance: "0.0000000000",
    });
    expect(
      (await db.query("select * from public.ledger_entries")).rows,
    ).toHaveLength(0);
    await rejected(
      "select public.create_agent($1,$2,'Bad','atlas','1')",
      [outsider, assetId],
      "ATLAS_OWNER_REQUIRED",
    );
  });

  it("claims each due agent once and requires the current lease token to complete", async () => {
    const created = await agent();
    await db.query("select public.update_agent_enabled($1,$2,true)", [
      owner,
      created.id,
    ]);
    const first = await db.query<{
      job_id: string;
      agent_id: string;
      lease_token: string;
    }>("select * from public.claim_due_agents($1)", [owner]);
    expect(first.rows).toHaveLength(1);
    expect(
      (await db.query("select * from public.claim_due_agents($1)", [owner]))
        .rows,
    ).toHaveLength(0);
    const job = first.rows[0];
    const wrong = await db.query<{ complete: boolean }>(
      "select public.complete_agent_job($1,$2,$3,'SUCCEEDED') as complete",
      [owner, job.job_id, outsider],
    );
    expect(wrong.rows[0].complete).toBe(false);
    const complete = await db.query<{ complete: boolean }>(
      "select public.complete_agent_job($1,$2,$3,'SUCCEEDED') as complete",
      [owner, job.job_id, job.lease_token],
    );
    expect(complete.rows[0].complete).toBe(true);
    const repeated = await db.query<{ complete: boolean }>(
      "select public.complete_agent_job($1,$2,$3,'SUCCEEDED') as complete",
      [owner, job.job_id, job.lease_token],
    );
    expect(repeated.rows[0].complete).toBe(false);
    expect(
      (await db.query("select * from public.claim_due_agents($1)", [owner]))
        .rows,
    ).toHaveLength(0);
    const state = await db.query<{ status: string; future: boolean }>(
      "select status,next_analysis_at>now() as future from public.agents where id=$1",
      [created.id],
    );
    expect(state.rows[0]).toEqual({ status: "IDLE", future: true });
  });

  it("reclaims an expired job with fencing and rejects the stale worker", async () => {
    const created = await agent();
    await db.query("select public.update_agent_enabled($1,$2,true)", [
      owner,
      created.id,
    ]);
    const first = (
      await db.query<{ job_id: string; lease_token: string }>(
        "select * from public.claim_due_agents($1)",
        [owner],
      )
    ).rows[0];
    await admin();
    await db.exec(
      "update public.agents set lease_expires_at=now()-interval '1 second'; update public.job_runs set lease_expires_at=now()-interval '1 second'",
    );
    await service();
    const retry = (
      await db.query<{ job_id: string; lease_token: string }>(
        "select * from public.claim_due_agents($1)",
        [owner],
      )
    ).rows[0];
    expect(retry.job_id).toBe(first.job_id);
    expect(retry.lease_token).not.toBe(first.lease_token);
    const stale = await db.query<{ result: boolean }>(
      "select public.complete_agent_job($1,$2,$3,'SUCCEEDED') as result",
      [owner, first.job_id, first.lease_token],
    );
    expect(stale.rows[0].result).toBe(false);
    const count = await db.query<{ attempts: number }>(
      "select attempts from public.job_runs",
    );
    expect(count.rows[0].attempts).toBe(2);
  });

  it("does not let a UI change activation while a job owns the agent", async () => {
    const created = await agent();
    await db.query("select public.update_agent_enabled($1,$2,true)", [
      owner,
      created.id,
    ]);
    await db.query("select * from public.claim_due_agents($1)", [owner]);
    await rejected(
      "select public.update_agent_enabled($1,$2,false)",
      [owner, created.id],
      "ATLAS_AGENT_BUSY",
    );
  });

  it("posts balanced exact decimal entries once and rejects altered idempotent retries", async () => {
    const cash = await account("cash", "BROKER_CASH");
    const clearing = await account("clearing", "EXTERNAL_CLEARING");
    const lines = [
      { accountId: cash, amount: "0.3" },
      { accountId: clearing, amount: "-0.3" },
    ];
    const first = await post(
      "deposit-fixture",
      "DEPOSIT",
      lines,
      "confirmed-external-fixture",
    );
    const duplicate = await post(
      "deposit-fixture",
      "DEPOSIT",
      lines,
      "confirmed-external-fixture",
    );
    expect(duplicate.rows[0].id).toBe(first.rows[0].id);
    const balances = await db.query<{ balance: string }>(
      "select balance::text from public.ledger_accounts where id=$1",
      [cash],
    );
    expect(balances.rows[0].balance).toBe("0.3000000000");
    expect(
      (await db.query("select * from public.ledger_entries")).rows,
    ).toHaveLength(2);
    await rejected(
      "select public.post_ledger_transaction($1,'deposit-fixture','DEPOSIT',$2::jsonb,'changed','fixture verification','confirmed-external-fixture')",
      [owner, JSON.stringify(lines)],
      "ATLAS_IDEMPOTENCY_CONFLICT",
    );
    await db.exec("set constraints all immediate");
  });

  it("rolls back an unbalanced entry, overspend and fake internal funding", async () => {
    const cash = await account("cash", "BROKER_CASH");
    const reserve = await account("reserve", "RESERVE");
    const clearing = await account("clearing", "EXTERNAL_CLEARING");
    await post(
      "fund",
      "DEPOSIT",
      [
        { accountId: cash, amount: "10" },
        { accountId: clearing, amount: "-10" },
      ],
      "external-fixture",
    );
    const attempt = async (
      key: string,
      lines: { accountId: string; amount: string }[],
      message: string,
    ) =>
      rejected(
        "select public.post_ledger_transaction($1,$2,'ALLOCATION',$3::jsonb,'fixture','fixture')",
        [owner, key, JSON.stringify(lines)],
        message,
      );
    await attempt(
      "unbalanced",
      [
        { accountId: cash, amount: "-5" },
        { accountId: reserve, amount: "4" },
      ],
      "ATLAS_UNBALANCED_LEDGER",
    );
    await attempt(
      "overspend",
      [
        { accountId: cash, amount: "-11" },
        { accountId: reserve, amount: "11" },
      ],
      "ATLAS_INSUFFICIENT_BALANCE",
    );
    await attempt(
      "mint",
      [
        { accountId: clearing, amount: "-20" },
        { accountId: reserve, amount: "20" },
      ],
      "ATLAS_INTERNAL_ALLOCATION_ONLY",
    );
    const balances = await db.query<{ key: string; balance: string }>(
      "select account_key as key,balance::text from public.ledger_accounts where id in ($1,$2) order by account_key",
      [cash, reserve],
    );
    expect(balances.rows).toEqual([
      { key: "cash", balance: "10.0000000000" },
      { key: "reserve", balance: "0.0000000000" },
    ]);
    expect(
      (await db.query("select * from public.ledger_transactions")).rows,
    ).toHaveLength(1);
    await db.exec("set constraints all immediate");
  });

  it("does not post the same confirmed external movement under a second idempotency key", async () => {
    const cash = await account("cash", "BROKER_CASH");
    const clearing = await account("clearing", "EXTERNAL_CLEARING");
    const lines = [
      { accountId: cash, amount: "10" },
      { accountId: clearing, amount: "-10" },
    ];
    await post("original-key", "DEPOSIT", lines, "same-external-id");
    await rejected(
      "select public.post_ledger_transaction($1,'different-key','DEPOSIT',$2::jsonb,'official-provider-test-fixture','fixture verification','same-external-id')",
      [owner, JSON.stringify(lines)],
      "duplicate key",
    );
    expect(
      (await db.query("select * from public.ledger_transactions")).rows,
    ).toHaveLength(1);
    const balance = await db.query<{ balance: string }>(
      "select balance::text from public.ledger_accounts where id=$1",
      [cash],
    );
    expect(balance.rows[0].balance).toBe("10.0000000000");
    await db.exec("set constraints all immediate");
  });

  it("exports monetary snapshots as exact strings and keeps missing broker cash null", async () => {
    const cash = await account("cash", "BROKER_CASH");
    const clearing = await account("clearing", "EXTERNAL_CLEARING");
    await post(
      "precise",
      "DEPOSIT",
      [
        { accountId: cash, amount: "9007199254740993.1234567890" },
        { accountId: clearing, amount: "-9007199254740993.1234567890" },
      ],
      "precise-fixture",
    );
    const result = await db.query<{
      snapshot: {
        ledgerAccounts: { accountKey: string; balance: string }[];
        latestPortfolioSnapshot: null;
        positions: unknown[];
      };
    }>("select public.get_accounting_snapshot($1) as snapshot", [owner]);
    expect(
      result.rows[0].snapshot.ledgerAccounts.find(
        (entry) => entry.accountKey === "cash",
      )?.balance,
    ).toBe("9007199254740993.1234567890");
    expect(result.rows[0].snapshot.latestPortfolioSnapshot).toBeNull();
    expect(result.rows[0].snapshot.positions).toEqual([]);
    await signedIn(owner);
    await rejected(
      "select public.get_accounting_snapshot($1)",
      [owner],
      "permission denied",
    );
  });

  it("requires decimal strings and rejects NaN, infinity and excessive precision", async () => {
    const cash = await account("cash", "BROKER_CASH");
    const clearing = await account("clearing", "EXTERNAL_CLEARING");
    for (const amount of [0.1, "NaN", "Infinity", "0.12345678901", "1e2"]) {
      await rejected(
        "select public.post_ledger_transaction($1,'invalid','DEPOSIT',$2::jsonb,'fixture','fixture','external-fixture')",
        [
          owner,
          JSON.stringify([
            { accountId: cash, amount },
            { accountId: clearing, amount: "-0.1" },
          ]),
        ],
        "ATLAS_DECIMAL_STRING_REQUIRED",
      );
    }
    await admin();
    await rejected(
      "update public.ledger_accounts set balance='NaN' where id=$1",
      [cash],
      "atlas_decimal_check",
    );
    await rejected(
      "update public.ledger_accounts set balance='Infinity' where id=$1",
      [cash],
      "numeric field overflow",
    );
  });

  it("prevents silent edits and rejects a directly inserted unbalanced transaction at constraint time", async () => {
    const cash = await account("cash", "BROKER_CASH");
    const clearing = await account("clearing", "EXTERNAL_CLEARING");
    await post(
      "fund",
      "DEPOSIT",
      [
        { accountId: cash, amount: "1" },
        { accountId: clearing, amount: "-1" },
      ],
      "external-fixture",
    );
    await admin();
    await rejected(
      "update public.ledger_entries set amount=2",
      [],
      "ATLAS_APPEND_ONLY",
    );
    await rejected(
      "delete from public.ledger_transactions",
      [],
      "ATLAS_APPEND_ONLY",
    );
    await rejected("delete from public.audit_logs", [], "ATLAS_APPEND_ONLY");
    await db.exec("set constraints all immediate");
    await rejected(
      "insert into public.ledger_transactions(owner_id,idempotency_key,kind,source,reason,correlation_id,request_payload) values ($1,'empty','ADJUSTMENT','test','test',gen_random_uuid(),'{}')",
      [owner],
      "ATLAS_UNBALANCED_LEDGER",
    );
  });

  it("never confirms a treasury deposit from an instruction alone", async () => {
    await admin();
    await rejected(
      "insert into public.treasury_transactions(owner_id,kind,amount,status) values ($1,'DEPOSIT',100,'CONFIRMED')",
      [owner],
      "check constraint",
    );
    await db.query(
      "insert into public.treasury_transactions(owner_id,kind,amount) values ($1,'DEPOSIT',100)",
      [owner],
    );
    const pending = await db.query<{ status: string }>(
      "select status from public.treasury_transactions",
    );
    expect(pending.rows[0].status).toBe("PENDING_CONFIRMATION");
    expect(
      (await db.query("select * from public.ledger_entries")).rows,
    ).toHaveLength(0);
  });

  it("persists and audits the kill switch without liquidating positions", async () => {
    await db.query(
      "select public.set_kill_switch($1,true,'Owner emergency stop')",
      [owner],
    );
    const state = await db.query<{
      global_kill_switch: boolean;
      live_trading_enabled: boolean;
    }>(
      "select global_kill_switch,live_trading_enabled from public.system_state",
    );
    expect(state.rows[0]).toEqual({
      global_kill_switch: true,
      live_trading_enabled: false,
    });
    const audit = await db.query<{
      details: { liquidatePositions: boolean; cancelOpenOrders: string };
    }>(
      "select details from public.audit_logs where action='KILL_SWITCH_CHANGED'",
    );
    expect(audit.rows[0].details.liquidatePositions).toBe(false);
    expect(audit.rows[0].details.cancelOpenOrders).toBe(
      "PENDING_BROKER_PROVIDER",
    );
    expect((await db.query("select * from public.orders")).rows).toHaveLength(
      0,
    );
  });

  it("enforces a persistent rate limit and starts a fresh window after expiry", async () => {
    const allowed: boolean[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await db.query<{ allowed: boolean }>(
        "select public.consume_rate_limit('test-owner',2,60) as allowed",
      );
      allowed.push(result.rows[0].allowed);
    }
    expect(allowed).toEqual([true, true, false]);
    await admin();
    await db.exec(
      "update atlas_private.rate_limit_buckets set window_started_at=now()-interval '61 seconds'",
    );
    await service();
    const next = await db.query<{ allowed: boolean }>(
      "select public.consume_rate_limit('test-owner',2,60) as allowed",
    );
    expect(next.rows[0].allowed).toBe(true);
  });

  it("deduplicates source URLs while preserving a shared event key across publishers", async () => {
    const insert =
      "insert into public.news_articles(owner_id,source,url,title,published_at,event_key) values ($1,'official-test-source',$2,'Fixture news',now(),'same-event')";
    await db.query(insert, [owner, "https://example.test/one"]);
    await rejected(
      insert,
      [owner, "https://example.test/one"],
      "duplicate key",
    );
    await db.query(insert, [owner, "https://example.test/two"]);
    const events = await db.query<{ count: number }>(
      "select count(distinct event_key)::int as count from public.news_articles",
    );
    expect(events.rows[0].count).toBe(1);
  });

  it("commits a real deterministic HOLD analysis, evidence, memory, audit and job completion atomically", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    expect(evidence.result.indicators).toEqual({
      sma20: "31.00000000",
      sma50: "31.00000000",
      trend: "EQUAL",
    });
    const result = await finishAnalysis(job, evidence);
    const decision = await db.query<{
      id: string;
      decision: string;
      result: unknown;
      inputs: unknown;
      analysis_job_id: string;
      correlation_id: string;
    }>(
      "select id,decision,result,inputs,analysis_job_id,correlation_id from public.decisions where id=$1",
      [result.rows[0].id],
    );
    expect(decision.rows[0].decision).toBe("HOLD");
    expect(decision.rows[0].result).toEqual(evidence.result);
    expect(decision.rows[0].inputs).toEqual(evidence.inputs);
    expect(decision.rows[0].analysis_job_id).toBe(job.job_id);
    const memory = await db.query<{ event_key: string; summary: string }>(
      "select event_key,summary from public.agent_memories",
    );
    expect(memory.rows).toEqual([
      {
        event_key: `analysis:${job.job_id}`,
        summary: evidence.result.reasoningSummary,
      },
    ]);
    const audit = await db.query<{ correlation_id: string; entity_id: string }>(
      "select correlation_id,entity_id from public.audit_logs where action='ANALYSIS_COMMITTED'",
    );
    expect(audit.rows).toEqual([
      {
        correlation_id: decision.rows[0].correlation_id,
        entity_id: result.rows[0].id,
      },
    ]);
    const state = await db.query<{
      status: string;
      next_scheduled: boolean;
      job_status: string;
      correlation_id: string;
    }>(
      "select a.status,a.next_analysis_at>now() as next_scheduled,j.status as job_status,j.correlation_id from public.agents a join public.job_runs j on j.agent_id=a.id where j.id=$1",
      [job.job_id],
    );
    expect(state.rows[0]).toEqual({
      status: "IDLE",
      next_scheduled: true,
      job_status: "SUCCEEDED",
      correlation_id: decision.rows[0].correlation_id,
    });
    for (const table of [
      "trade_proposals",
      "orders",
      "executions",
      "ledger_entries",
    ]) {
      expect(
        (await db.query(`select * from public.${table}`)).rows,
      ).toHaveLength(0);
    }
  });

  it("returns the same committed analysis exactly once and rejects changed retry evidence", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    const first = await finishAnalysis(job, evidence);
    const retry = await finishAnalysis(job, evidence);
    expect(retry.rows[0].id).toBe(first.rows[0].id);
    for (const table of ["decisions", "agent_memories"])
      expect(
        (await db.query(`select * from public.${table}`)).rows,
      ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select * from public.audit_logs where action='ANALYSIS_COMMITTED'",
        )
      ).rows,
    ).toHaveLength(1);
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify({
          ...evidence.result,
          reasoningSummary: "Changed result",
        }),
        JSON.stringify(evidence.inputs),
      ],
      "ATLAS_ANALYSIS_IDEMPOTENCY_CONFLICT",
    );
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify(evidence.result),
        JSON.stringify({
          ...evidence.inputs,
          quote: { ...evidence.inputs.quote, price: "100" },
        }),
      ],
      "ATLAS_ANALYSIS_IDEMPOTENCY_CONFLICT",
    );
  });

  it("fences a reclaimed analysis job and permits only the new worker to commit", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    await admin();
    await db.exec(
      "update public.agents set lease_expires_at=now()-interval '1 second'; update public.job_runs set lease_expires_at=now()-interval '1 second'",
    );
    await service();
    const retry = (
      await db.query<ClaimedJob>("select * from public.claim_due_agents($1)", [
        owner,
      ])
    ).rows[0];
    expect(retry.job_id).toBe(job.job_id);
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify(evidence.result),
        JSON.stringify(evidence.inputs),
      ],
      "ATLAS_LEASE_LOST",
    );
    expect(
      (await db.query("select * from public.decisions")).rows,
    ).toHaveLength(0);
    await finishAnalysis(retry, evidence);
    expect(
      (await db.query("select * from public.decisions")).rows,
    ).toHaveLength(1);
  });

  it("rejects an expired analysis lease before a replacement worker is even claimed", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    await admin();
    await db.exec(
      "update public.job_runs set lease_expires_at=clock_timestamp()-interval '1 second'",
    );
    await service();
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify(evidence.result),
        JSON.stringify(evidence.inputs),
      ],
      "ATLAS_LEASE_LOST",
    );
    expect(
      (await db.query("select * from public.decisions")).rows,
    ).toHaveLength(0);
  });

  it("cannot commit BUY, risk approval, string false, or an order suggestion through observation RPC", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    const invalidResults = [
      { ...evidence.result, decision: "BUY" },
      { ...evidence.result, risk: { approved: true } },
      { ...evidence.result, risk: { approved: "false" } },
      { ...evidence.result, suggestedQuantity: 1 },
      { ...evidence.result, suggestedOrderType: "LIMIT" },
      { ...evidence.result, suggestedLimitPrice: "30" },
      { ...evidence.result, strategyVersion: "unvalidated-strategy" },
    ];
    for (const result of invalidResults) {
      await rejected(
        "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
        [
          owner,
          job.job_id,
          job.lease_token,
          JSON.stringify(result),
          JSON.stringify(evidence.inputs),
        ],
        "ATLAS_INVALID_ANALYSIS",
      );
    }
    for (const table of [
      "decisions",
      "agent_memories",
      "trade_proposals",
      "orders",
    ])
      expect(
        (await db.query(`select * from public.${table}`)).rows,
      ).toHaveLength(0);
    expect(
      (await db.query<{ status: string }>("select status from public.job_runs"))
        .rows[0].status,
    ).toBe("RUNNING");
  });

  it("rejects mismatched evidence, a different assigned asset, and future market timestamps", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    const mismatched = {
      ...evidence.inputs,
      quote: { ...evidence.inputs.quote, ticker: "OTHER3" },
    };
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify(evidence.result),
        JSON.stringify(mismatched),
      ],
      "ATLAS_INVALID_ANALYSIS_EVIDENCE",
    );
    const otherAsset = analysisEvidence("OTHER3");
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify(otherAsset.result),
        JSON.stringify(otherAsset.inputs),
      ],
      "ATLAS_ANALYSIS_ASSET_MISMATCH",
    );
    const future = new Date(Date.now() + 86400000).toISOString();
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify({ ...evidence.result, dataTimestamp: future }),
        JSON.stringify({
          ...evidence.inputs,
          quote: { ...evidence.inputs.quote, dataTimestamp: future },
        }),
      ],
      "ATLAS_INVALID_ANALYSIS_TIME",
    );
    expect(
      (await db.query("select * from public.decisions")).rows,
    ).toHaveLength(0);
  });

  it("rolls the entire analysis transaction back if a later memory write fails", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    await db.query(
      "insert into public.agent_memories(owner_id,agent_id,event_key,summary,sources) values ($1,$2,$3,'Conflicting fixture','[]')",
      [owner, job.agent_id, `analysis:${job.job_id}`],
    );
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [
        owner,
        job.job_id,
        job.lease_token,
        JSON.stringify(evidence.result),
        JSON.stringify(evidence.inputs),
      ],
      "duplicate key",
    );
    expect(
      (await db.query("select * from public.decisions")).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select * from public.audit_logs where action='ANALYSIS_COMMITTED'",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await db.query<{ status: string }>("select status from public.job_runs"))
        .rows[0].status,
    ).toBe("RUNNING");
    expect(
      (await db.query<{ status: string }>("select status from public.agents"))
        .rows[0].status,
    ).toBe("ANALYZING");
  });

  it("denies finish RPC to an authenticated browser and denies a service request with the wrong owner", async () => {
    const job = await claimAnalysis();
    const evidence = analysisEvidence();
    const args = [
      owner,
      job.job_id,
      job.lease_token,
      JSON.stringify(evidence.result),
      JSON.stringify(evidence.inputs),
    ];
    await signedIn(owner);
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      args,
      "permission denied",
    );
    await service();
    await rejected(
      "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb)",
      [outsider, ...args.slice(1)],
      "ATLAS_OWNER_REQUIRED",
    );
    expect(
      (await db.query("select * from public.decisions")).rows,
    ).toHaveLength(0);
  });
});
