import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parsePortfolioHistory, type PortfolioHistory } from "@/lib/portfolio";

const owner = "10000000-0000-4000-8000-000000000001";
const outsider = "10000000-0000-4000-8000-000000000002";
const accountA = "20000000-0000-4000-8000-000000000001";
const accountB = "20000000-0000-4000-8000-000000000002";
const foreignAccount = "20000000-0000-4000-8000-000000000003";
const asset = "30000000-0000-4000-8000-000000000001";
const otherAsset = "30000000-0000-4000-8000-000000000002";
const agent = "40000000-0000-4000-8000-000000000001";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
    create function auth.uid() returns uuid language sql stable as 'select (auth.jwt()->>''sub'')::uuid';
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
  `);
  const path = resolve("supabase/migrations");
  for (const file of readdirSync(path).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(resolve(path, file), "utf8"));
  }
}, 60000);
beforeEach(async () => {
  await db.exec("begin");
  await db.query("insert into auth.users values ($1),($2)", [owner, outsider]);
  await db.query("insert into public.system_state(owner_id) values ($1)", [owner]);
  await db.query(`insert into public.broker_accounts(id,owner_id,provider,external_account_id,created_at) values
    ($1,$4,'Broker fixture A','private-account-A','2020-01-01Z'),
    ($2,$4,'Broker fixture B','private-account-B','2021-01-01Z'),
    ($3,$5,'Other owner fixture','private-account-C','2022-01-01Z')`, [accountA, accountB, foreignAccount, owner, outsider]);
  await db.query("insert into public.assets(id,owner_id,ticker,company_name) values ($1,$3,'TEST3','Company fixture'),($2,$3,'OTHR3','Other fixture')", [asset, otherAsset, owner]);
  await db.query("insert into public.agents(id,owner_id,asset_id,name) values ($1,$2,$3,'Agent fixture')", [agent, owner, asset]);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

async function snapshot(account = accountA, ownerId = owner, cash = "9007199254740992.0100000000") {
  await db.query(`insert into public.portfolio_snapshots(owner_id,broker_account_id,cash,equity,reconciled,source_timestamp)
    values ($1,$2,$3,$3,true,statement_timestamp()-interval '1 day')`, [ownerId, account, cash]);
}
async function read(account: string | null = accountA, ownerId = owner, limit = 200) {
  await db.exec("set local role service_role");
  const result = await db.query<{ data: PortfolioHistory }>("select public.get_portfolio_history($1,$2,$3) as data", [ownerId, account, limit]);
  return result.rows[0].data;
}
async function rejected(sql: string, args: unknown[], text: string) {
  await db.exec("savepoint expected_failure");
  try { await expect(db.query(sql, args)).rejects.toThrow(text); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}

describe("portfolio history PostgreSQL contract", () => {
  it("reads exact monetary strings from one owner/account and does not reveal external account identifiers", async () => {
    await snapshot(); await snapshot(accountB, owner, "222"); await snapshot(foreignAccount, outsider, "333");
    const raw = await read();
    const result = parsePortfolioHistory(raw);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].cash).toBe("9007199254740992.0100000000");
    expect(result.snapshots[0].invested).toBeNull();
    expect(result.brokerAccounts).toHaveLength(2);
    expect(JSON.stringify(raw)).not.toContain("private-account");
    expect(JSON.stringify(raw)).not.toContain(foreignAccount);
  });
  it("defaults to a deterministic own account, without combining histories", async () => {
    await snapshot(); await snapshot(accountB, owner, "222");
    const result = await read(null);
    expect(result.brokerAccountId).toBe(accountB);
    expect(result.snapshots.map((row) => row.cash)).toEqual(["222.0000000000"]);
  });
  it("excludes future, unconfirmed, discrepant and non-finite timestamp evidence", async () => {
    await snapshot();
    await db.query(`insert into public.portfolio_snapshots(owner_id,broker_account_id,cash,reconciled,discrepancies,source_timestamp,created_at) values
      ($1,$2,1,false,'[]',now()-interval '2 days',now()),
      ($1,$2,2,true,'[{"field":"cash"}]',now()-interval '3 days',now()),
      ($1,$2,3,true,'[]',now()+interval '1 day',now()),
      ($1,$2,4,true,'[]',now(),now()+interval '1 day'),
      ($1,$2,5,true,'[]','infinity','infinity'),
      ($1,$2,6,true,'[]','-infinity',now())`, [owner, accountA]);
    const result = await read();
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].cash).toBe("9007199254740992.0100000000");
  });
  it("bounds source history at 200 observations, ordered by origin, without filling dates", async () => {
    await db.query(`insert into public.portfolio_snapshots(owner_id,broker_account_id,cash,equity,reconciled,source_timestamp)
      select $1,$2,n,n,true,now()-n*interval '2 days' from generate_series(1,205) n`, [owner, accountA]);
    const result = await read();
    expect(result.historyTruncated).toBe(true);
    expect(result.snapshots).toHaveLength(200);
    expect(result.snapshots[0].cash).toBe("200.0000000000");
    expect(result.snapshots.at(-1)?.cash).toBe("1.0000000000");
    expect(Date.parse(result.snapshots[1].sourceTimestamp) - Date.parse(result.snapshots[0].sourceTimestamp)).toBe(2 * 86400000);
  });
  it("joins the actual ticker and agent only when asset, account and ownership agree", async () => {
    await db.query(`insert into public.positions(owner_id,broker_account_id,asset_id,agent_id,quantity,average_price,reconciled_at) values
      ($1,$2,$4,$6,10,123.0123456789,now()-interval '1 minute'),
      ($1,$2,$5,$6,11,2,now()-interval '1 minute'),
      ($1,$3,$4,$6,12,3,now()-interval '1 minute'),
      ($1,$2,$4,null,13,null,now()-interval '1 minute'),
      ($1,$2,$5,null,14,4,now()+interval '1 minute')`, [owner, accountA, accountB, asset, otherAsset, agent]);
    const data = parsePortfolioHistory(await read());
    expect(data.positions).toHaveLength(2);
    expect(data.positions.find((row) => row.agentId === agent)).toMatchObject({
      ticker: "TEST3", agentName: "Agent fixture", assetId: asset, agentAssetId: asset,
      quantity: "10.0000000000", averagePrice: "123.0123456789",
    });
    expect(data.positions.find((row) => row.agentId === null)?.agentName).toBeNull();
  });
  it("refuses unknown owners, foreign accounts and unbounded limits", async () => {
    await db.exec("set local role service_role");
    await rejected("select public.get_portfolio_history($1)", [outsider], "ATLAS_OWNER_REQUIRED");
    await rejected("select public.get_portfolio_history($1,$2)", [owner, foreignAccount], "PORTFOLIO_ACCOUNT_NOT_FOUND");
    for (const limit of [0, 201, null]) await rejected("select public.get_portfolio_history($1,$2,$3)", [owner, accountA, limit], "INVALID_HISTORY_LIMIT");
  });
  it("retains owner+AAL2 RLS and denies browser roles direct RPC execution", async () => {
    await snapshot();
    for (const [id, aal, visible] of [[owner, "aal2", 1], [owner, "aal1", 0], [outsider, "aal2", 0]] as const) {
      await db.exec("set local role postgres");
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, aal })]);
      await db.exec("set local role authenticated");
      expect((await db.query("select id from public.portfolio_snapshots")).rows).toHaveLength(visible);
      await rejected("select public.get_portfolio_history($1)", [owner], "permission denied");
    }
    await db.exec("set local role anon");
    await rejected("select public.get_portfolio_history($1)", [owner], "permission denied");
  });
  it("uses invoker privileges and permits no new financial writes", async () => {
    const meta = await db.query<{ prosecdef: boolean; proconfig: string[] }>("select prosecdef,proconfig from pg_proc where proname='get_portfolio_history'");
    expect(meta.rows[0].prosecdef).toBe(false);
    expect(meta.rows[0].proconfig).toEqual(['search_path=""']);
    await db.exec("set local role service_role");
    await rejected("insert into public.portfolio_snapshots(owner_id,broker_account_id,cash,source_timestamp) values ($1,$2,100,now())", [owner, accountA], "permission denied");
  });
});
