import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

const owner = "10000000-0000-4000-8000-000000000001";
const outsider = "10000000-0000-4000-8000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
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
  await db.query("insert into auth.users(id) values($1),($2)", [
    owner,
    outsider,
  ]);
  await db.query("insert into public.system_state(owner_id) values($1)", [
    owner,
  ]);
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});

async function cache(
  ticker: string,
  age = "8 days",
  kind = "READ_CACHE_V1",
  id = owner,
) {
  await db.query(
    `insert into public.market_data_cache(owner_id,provider,ticker,data_kind,quality,source_url,payload,retrieved_at)
    values($1,'brapi',$2,$3,'DELAYED','https://example.test/cache','{}',now()-$4::interval)`,
    [id, ticker, kind, age],
  );
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
async function prune(limit = 500) {
  return (
    await db.query<{ deleted: number }>(
      "select public.prune_market_data_cache($1,$2) deleted",
      [owner, limit],
    )
  ).rows[0].deleted;
}

it("prunes old disposable owner caches only and retains the audit trail", async () => {
  await cache("OLD");
  await cache("FRESH", "6 days 23 hours");
  await cache("EVIDENCE", "90 days", "QUOTE");
  await cache("OTHER_OWNER", "90 days", "READ_CACHE_V1", outsider);
  await db.query(
    `insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details,created_at)
    values($1,'SYSTEM','FIXTURE_HISTORY','test','test','{}',now()-interval '90 days')`,
    [owner],
  );
  await db.exec("set local role service_role");
  expect(await prune()).toBe(1);
  expect(
    (
      await db.query<{ ticker: string }>(
        "select ticker from public.market_data_cache order by ticker",
      )
    ).rows.map((r) => r.ticker),
  ).toEqual(["EVIDENCE", "FRESH", "OTHER_OWNER"]);
  const audit = await db.query<{
    action: string;
    details: { deleted?: number };
  }>("select action,details from public.audit_logs order by created_at");
  expect(audit.rows.map((r) => r.action)).toEqual([
    "FIXTURE_HISTORY",
    "READ_CACHE_PRUNED",
  ]);
  expect(audit.rows[1].details.deleted).toBe(1);
  expect(await prune()).toBe(0);
  expect((await db.query("select * from public.audit_logs")).rows).toHaveLength(
    2,
  );
});

it("bounds each cleanup batch and deletes the oldest eligible row first", async () => {
  await cache("OLD", "8 days");
  await cache("OLDEST", "9 days");
  await db.exec("set local role service_role");
  expect(await prune(1)).toBe(1);
  expect(
    (
      await db.query<{ ticker: string }>(
        "select ticker from public.market_data_cache",
      )
    ).rows,
  ).toEqual([{ ticker: "OLD" }]);
});

it("rejects invalid batch limits and foreign owners without deleting data", async () => {
  await cache("OLD");
  await db.exec("set local role service_role");
  for (const limit of [null, 0, -1, 1001]) {
    await rejected(
      "select public.prune_market_data_cache($1,$2)",
      [owner, limit],
      "CACHE_RETENTION_INVALID_LIMIT",
    );
  }
  await rejected(
    "select public.prune_market_data_cache($1)",
    [outsider],
    "ATLAS_OWNER_REQUIRED",
  );
  expect(
    (await db.query("select id from public.market_data_cache")).rows,
  ).toHaveLength(1);
});

it.each(["anon", "authenticated"])(
  "denies cleanup to the %s role",
  async (role) => {
    await db.exec(`set local role ${role}`);
    await rejected(
      "select public.prune_market_data_cache($1)",
      [owner],
      "permission denied",
    );
  },
);

it("denies broad direct service deletion while still allowing singleton cache refresh", async () => {
  await cache("QUOTE:TEST3");
  await db.exec("set local role service_role");
  await rejected(
    "delete from public.market_data_cache",
    [],
    "permission denied",
  );
  await db.query(
    `insert into public.market_data_cache(owner_id,provider,ticker,data_kind,quality,source_url,payload,retrieved_at,provider_timestamp)
    values($1,'brapi','QUOTE:TEST3','READ_CACHE_V1','DELAYED','https://example.test/cache','{"new":true}',now(),null)
    on conflict(owner_id,provider,ticker,data_kind,provider_timestamp) do update
      set payload=excluded.payload,retrieved_at=excluded.retrieved_at`,
    [owner],
  );
  const result = await db.query<{ payload: unknown }>(
    "select payload from public.market_data_cache",
  );
  expect(result.rows).toEqual([{ payload: { new: true } }]);
  expect(await prune()).toBe(0);
});
