import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const owner = "10000000-0000-4000-8000-000000000001";
let db: PGlite;

type PaperResult = {
  action: string;
  positionSide: number;
  realizedPnlToday: number;
  tradesToday: number;
};

function event(barAt: string, overrides: Record<string, unknown> = {}) {
  return {
    owner_id: owner,
    instrument: "WINZ26",
    strategy_version: "opening-range-vwap-v1",
    bar_at: barAt,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    signal: "NO_SETUP",
    stop: null,
    enabled: true,
    point_value: 1,
    tick_size: 1,
    fee_per_side: 0.1,
    slippage_ticks: 1,
    max_loss_per_trade: 10,
    max_loss_per_day: 20,
    max_exposure: 100,
    margin_per_contract: 50,
    max_trades_per_day: 3,
    max_contracts: 1,
    max_open_positions: 1,
    last_entry: "16:00",
    flat_by: "18:00",
    ...overrides,
  };
}

async function applyPaper(input: ReturnType<typeof event>) {
  const result = await db.query<{ result: PaperResult }>(
    "select public.dt_apply_paper_bar($1::jsonb) as result",
    [JSON.stringify(input)],
  );
  return result.rows[0].result;
}

async function priorSessionDay() {
  const result = await db.query<{ day: string }>(
    "select ((now() at time zone 'America/Sao_Paulo')::date - 1)::text as day",
  );
  return result.rows[0].day;
}

function historyBars(day: string, minutes: number[]) {
  return minutes.map((minute, index) => ({
    bucket_at: `${day}T09:${String(minute).padStart(2, "0")}:00-03:00`,
    open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index,
    volume: 10, turnover: (101 + index) * 10,
  }));
}

async function importHistory(day: string, bars: ReturnType<typeof historyBars>, tradeCount = 20) {
  const result = await db.query<{ result: { status: string; bars: number } }>(
    "select public.dt_import_market_history($1,$2,$3::date,$4,$5::jsonb) as result",
    [owner, "WINZ26", day, tradeCount, JSON.stringify(bars)],
  );
  return result.rows[0].result;
}

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
    create function auth.uid() returns uuid language sql stable as 'select (auth.jwt()->>''sub'')::uuid';
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
  `);
  const directory = resolve("supabase/migrations");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    const migration = readFileSync(resolve(directory, file), "utf8").replace(/^\uFEFF/, "");
    await db.exec(migration);
  }
}, 60000);

beforeEach(async () => {
  await db.exec("begin");
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.system_state(owner_id) values ($1)", [owner]);
  await db.query("insert into public.dt_settings(owner_id,mode,halted) values ($1,'SIMULATED',false)", [owner]);
  await db.query(
    `insert into public.dt_sessions(owner_id,day,status,plan) values
      ($1,'2026-11-02','OPEN',$2::jsonb)`,
    [owner, JSON.stringify({ instrument: "WINZ26", open: "09:00", close: "18:25" })],
  );
  await db.exec("set local role service_role");
});

afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });

describe("DASH paper database boundary", () => {
  it("fills only on the next bar, deduplicates retries, and still exits when halted", async () => {
    const first = await applyPaper(event("2026-11-02T09:30:00-03:00", {
      signal: "WATCH_LONG", stop: 98,
    }));
    expect(first.action).toBe("ENTRY_QUEUED");
    expect(first.positionSide).toBe(0);

    const fill = await applyPaper(event("2026-11-02T09:31:00-03:00"));
    expect(fill.action).toBe("ENTRY_FILLED");
    expect(fill.positionSide).toBe(1);

    const retry = await applyPaper(event("2026-11-02T09:31:00-03:00"));
    expect(retry.action).toBe("DUPLICATE");
    const retriedFills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills");
    expect(retriedFills.rows[0].count).toBe(1);

    await db.query("update public.dt_settings set halted=true where owner_id=$1", [owner]);
    const exit = await applyPaper(event("2026-11-02T09:32:00-03:00", {
      open: 97, high: 99, low: 96, close: 98,
    }));
    expect(exit.action).toBe("STOP_EXIT");
    expect(exit.positionSide).toBe(0);
    expect(exit.realizedPnlToday).toBeLessThan(0);

    const fills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills");
    const paperLedger = await db.query<{ count: number }>("select count(*)::int as count from public.dt_ledger where simulated=true");
    const liveOrders = await db.query<{ count: number }>("select count(*)::int as count from public.live_orders");
    expect(fills.rows[0].count).toBe(2);
    expect(paperLedger.rows[0].count).toBe(2);
    expect(liveOrders.rows[0].count).toBe(0);
  });

  it("blocks a simulated entry when the configured risk per trade is too small", async () => {
    const first = await applyPaper(event("2026-11-02T09:30:00-03:00", {
      signal: "WATCH_LONG", stop: 98, max_loss_per_trade: 3.5,
    }));
    expect(first.action).toBe("ENTRY_QUEUED");

    const fill = await applyPaper(event("2026-11-02T09:31:00-03:00", {
      max_loss_per_trade: 3.5,
    }));
    expect(fill.action).toBe("ENTRY_BLOCKED");
    expect(fill.positionSide).toBe(0);
    const fills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills");
    expect(fills.rows[0].count).toBe(0);
  });

  it("blocks new paper entries after adverse fills breach the persisted daily loss limit", async () => {
    await applyPaper(event("2026-11-02T09:30:00-03:00", { signal: "WATCH_LONG", stop: 98 }));
    await applyPaper(event("2026-11-02T09:31:00-03:00"));
    const stopped = await applyPaper(event("2026-11-02T09:32:00-03:00", {
      open: 80, high: 81, low: 79, close: 80,
    }));
    expect(stopped.action).toBe("STOP_EXIT");
    expect(stopped.realizedPnlToday).toBeLessThan(-20);

    const nextSignal = await applyPaper(event("2026-11-02T09:33:00-03:00", {
      signal: "WATCH_LONG", stop: 78,
    }));
    expect(nextSignal.action).toBe("NO_ACTION");
    expect(nextSignal.positionSide).toBe(0);
    const fills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills");
    expect(fills.rows[0].count).toBe(2);
  });

  it("rejects corrupted contract value at the database risk boundary", async () => {
    await db.exec("savepoint expected_invalid_risk");
    await expect(applyPaper(event("2026-11-02T09:30:00-03:00", {
      signal: "WATCH_LONG", stop: 98, point_value: -1,
    }))).rejects.toThrow("invalid paper risk configuration");
    await db.exec("rollback to savepoint expected_invalid_risk; release savepoint expected_invalid_risk");
    const fills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills");
    expect(fills.rows[0].count).toBe(0);
  });

  it("does not expose the paper RPC to anonymous callers", async () => {
    await db.exec("savepoint anonymous_paper_call");
    await db.exec("set local role anon");
    await expect(applyPaper(event("2026-11-02T09:30:00-03:00", {
      signal: "WATCH_LONG", stop: 98,
    }))).rejects.toThrow(/permission denied/i);
    await db.exec("rollback to savepoint anonymous_paper_call; release savepoint anonymous_paper_call");
    const fills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills");
    expect(fills.rows[0].count).toBe(0);
  });

  it("blocks new simulated entries unless the persisted exchange session is open", async () => {
    await db.query("update public.dt_sessions set status='PAUSED' where owner_id=$1", [owner]);
    const result = await applyPaper(event("2026-11-02T09:30:00-03:00", {
      signal: "WATCH_LONG", stop: 98,
    }));
    expect(result.action).not.toBe("ENTRY_QUEUED");
    expect(result.positionSide).toBe(0);
    const fills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills");
    expect(fills.rows[0].count).toBe(0);
  });

  it("records an overnight paper close against the new day without mislabeling it as a data gap", async () => {
    await db.query(
      `insert into public.dt_sessions(owner_id,day,status,plan) values
        ($1,'2026-10-27','OPEN',$2::jsonb),
        ($1,'2026-10-28','OPEN',$2::jsonb)`,
      [owner, JSON.stringify({ instrument: "WINZ26", open: "09:00", close: "18:25" })],
    );
    await applyPaper(event("2026-10-27T09:30:00-03:00", { signal: "WATCH_LONG", stop: 98 }));
    await applyPaper(event("2026-10-27T09:31:00-03:00"));

    const close = await applyPaper(event("2026-10-28T09:00:00-03:00"));
    expect(close.action).toBe("DAY_BOUNDARY_FLAT");
    expect(close.positionSide).toBe(0);
    expect(close.realizedPnlToday).toBeCloseTo(-2.2);

    const fills = await db.query<{ reason: string; net_pnl: string }>(
      "select reason,net_pnl from public.dt_paper_fills where action='EXIT'",
    );
    expect(fills.rows[0].reason).toBe("DAY_BOUNDARY_FLAT");
    expect(Number(fills.rows[0].net_pnl)).toBeCloseTo(-2.2);
  });

  it("replaces a completed historical session atomically and removes stale live or historical minutes", async () => {
    const day = await priorSessionDay();
    const original = historyBars(day, [30, 31, 32]);
    const replacement = historyBars(day, [30, 31]);
    await db.query(
      `insert into public.dt_market_bars
        (owner_id,instrument,provider,timeframe,bucket_at,open,high,low,close,volume,turnover,source_exchange_at)
       values ($1,'WINZ26','PROFITDLL_DAYTRADE','1m',$2::timestamptz,100,102,99,101,10,1010,$2::timestamptz)`,
      [owner, original[2].bucket_at],
    );

    expect((await importHistory(day, original)).status).toBe("IMPORTED");
    expect((await importHistory(day, replacement)).status).toBe("IMPORTED");

    const rows = await db.query<{ provider: string; bucket_at: string; count: number }>(
      `select provider, min(bucket_at)::text as bucket_at, count(*)::int as count
       from public.dt_market_bars where owner_id=$1 and instrument='WINZ26'
       group by provider order by provider`,
      [owner],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].provider).toBe("PROFITDLL_HISTORY");
    expect(rows.rows[0].count).toBe(2);
    const marker = await db.query<{ trades_count: number; source_bar_count: number }>(
      "select trades_count,source_bar_count from public.dt_market_history_sessions where owner_id=$1 and instrument='WINZ26' and session_day=$2::date",
      [owner, day],
    );
    expect(marker.rows[0]).toEqual({ trades_count: 20, source_bar_count: 2 });
  });

  it("rejects invalid historical turnover without writing bars or a completion marker", async () => {
    const day = await priorSessionDay();
    const malformed = historyBars(day, [30]);
    malformed[0].turnover = 999_999;
    await db.exec("savepoint expected_invalid_history");
    await expect(importHistory(day, malformed, 10)).rejects.toThrow(/historical bar failed/i);
    await db.exec("rollback to savepoint expected_invalid_history; release savepoint expected_invalid_history");

    const bars = await db.query<{ count: number }>(
      "select count(*)::int as count from public.dt_market_bars where owner_id=$1 and instrument='WINZ26'",
      [owner],
    );
    const markers = await db.query<{ count: number }>(
      "select count(*)::int as count from public.dt_market_history_sessions where owner_id=$1 and instrument='WINZ26'",
      [owner],
    );
    expect(bars.rows[0].count).toBe(0);
    expect(markers.rows[0].count).toBe(0);
  });
});
