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
    capital_budget: 120,
    margin_per_contract: 50,
    max_trades_per_day: 3,
    max_contracts: 1,
    max_open_positions: 1,
    last_entry: "16:00",
    flat_by: "18:00",
    ...overrides,
  };
}

const confirmedExecution = {
  capitalBudget: 120,
  marginPerContract: 50,
  brokeragePerContract: 0.1,
  exchangeFeesPerContract: 0,
  slippageTicks: 1,
  maxLossPerTrade: 10,
  maxLossPerDay: 20,
  maxExposure: 100,
  lastEntry: "16:00",
  flatBy: "18:00",
  sourceNote: "Broker fixture",
  confirmSource: true,
};

async function saveExecution(overrides: Partial<typeof confirmedExecution> = {}) {
  const config = { ...confirmedExecution, ...overrides };
  await db.query(
    `update public.dt_settings
       set execution_config=$2::jsonb, execution_source_note=$3, execution_confirmed_at=now()
     where owner_id=$1`,
    [owner, JSON.stringify(config), config.sourceNote],
  );
}

async function applyPaper(input: ReturnType<typeof event>) {
  const result = await db.query<{ result: PaperResult }>(
    "select public.dt_apply_paper_bar($1::jsonb) as result",
    [JSON.stringify(input)],
  );
  return result.rows[0].result;
}

async function acceptQuote(overrides: Record<string, unknown> = {}, bars: Record<string, unknown>[] = []) {
  const args = {
    p_owner_id: owner, p_instrument: "WINZ26", p_provider: "PROFITDLL_DAYTRADE",
    p_last: 100, p_bid: null, p_ask: null,
    p_exchange_at: "2026-11-02T09:30:30-03:00", p_received_at: "2026-11-02T09:30:31-03:00",
    p_sequence: 1, p_bars: JSON.stringify(bars), ...overrides,
  };
  const result = await db.query<{ accepted: boolean }>(
    `select public.dt_accept_market_quote($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::jsonb) as accepted`,
    [args.p_owner_id,args.p_instrument,args.p_provider,args.p_last,args.p_bid,args.p_ask,args.p_exchange_at,args.p_received_at,args.p_sequence,args.p_bars],
  );
  return result.rows[0].accepted;
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
  await saveExecution();
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
  it("keeps API-readable DASH tables explicitly granted and owner-protected while history markers stay service-only", async () => {
    const result = await db.query<{ table_name: string; rls_enabled: boolean; authenticated_select: boolean }>(`
      select table_name, c.relrowsecurity as rls_enabled,
        has_table_privilege('authenticated', c.oid, 'select') as authenticated_select
      from (values
        ('dt_market_quotes'), ('dt_market_bars'), ('dt_strategy_observations'),
        ('dt_settings'), ('dt_paper_state'), ('dt_paper_fills')
      ) as expected(table_name)
      join pg_class c on c.relname = expected.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      order by table_name
    `);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((row) => row.rls_enabled && row.authenticated_select)).toBe(true);

    const marker = await db.query<{ rls_enabled: boolean; authenticated_select: boolean; service_select: boolean }>(`
      select c.relrowsecurity as rls_enabled,
        has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
        has_table_privilege('service_role', c.oid, 'select') as service_select
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'dt_market_history_sessions'
    `);
    expect(marker.rows).toEqual([{ rls_enabled: true, authenticated_select: false, service_select: true }]);
  });

  it("allows service role to call only validated RPC boundaries, not their internal helpers", async () => {
    const result = await db.query<{
      function_name: string; security_definer: boolean; search_path_locked: boolean;
      anon_execute: boolean; authenticated_execute: boolean; service_execute: boolean;
    }>(`
      select p.proname as function_name, p.prosecdef as security_definer,
        coalesce(exists(select 1 from unnest(p.proconfig) setting where setting like 'search_path=%'), false) as search_path_locked,
        has_function_privilege('anon', p.oid, 'execute') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
        has_function_privilege('service_role', p.oid, 'execute') as service_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.oid in (
        'public.dt_apply_paper_bar(jsonb)'::regprocedure,
        'public.dt_apply_paper_bar_before_equity_gate(jsonb)'::regprocedure,
        'public.dt_apply_paper_bar_before_capital_budget(jsonb)'::regprocedure,
        'public.dt_apply_paper_bar_before_persisted_confirmation(jsonb)'::regprocedure,
        'public.dt_apply_paper_bar_before_input_validation(jsonb)'::regprocedure,
        'public.dt_apply_paper_bar_before_session_gate(jsonb)'::regprocedure,
        'public.dt_accept_market_quote(uuid,text,text,numeric,numeric,numeric,timestamptz,timestamptz,bigint,jsonb)'::regprocedure,
        'public.dt_accept_market_quote_before_bar_validation(uuid,text,text,numeric,numeric,numeric,timestamptz,timestamptz,bigint,jsonb)'::regprocedure
      )
    `);
    const lookup = new Map(result.rows.map((row) => [row.function_name, row]));
    const paper = lookup.get("dt_apply_paper_bar");
    const quote = lookup.get("dt_accept_market_quote");
    expect(paper).toMatchObject({ security_definer: true, search_path_locked: true, anon_execute: false, authenticated_execute: false, service_execute: true });
    expect(quote).toMatchObject({ security_definer: true, search_path_locked: true, anon_execute: false, authenticated_execute: false, service_execute: true });
    expect(result.rows.filter((row) => row !== paper && row !== quote).every((row) =>
      !row.anon_execute && !row.authenticated_execute && !row.service_execute)).toBe(true);
  });

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

  it("does not arm entries without a persisted owner confirmation but keeps the paper engine reachable", async () => {
    await applyPaper(event("2026-11-02T09:30:00-03:00", { signal: "WATCH_LONG", stop: 98 }));
    await applyPaper(event("2026-11-02T09:31:00-03:00"));
    await db.query("update public.dt_settings set execution_confirmed_at=null where owner_id=$1", [owner]);
    const exit = await applyPaper(event("2026-11-02T09:32:00-03:00", {
      open: 97, high: 99, low: 96, close: 98,
    }));
    expect(exit.action).toBe("STOP_EXIT");
    const next = await applyPaper(event("2026-11-02T09:33:00-03:00", {
      signal: "WATCH_LONG", stop: 96,
    }));
    expect(next.positionSide).toBe(0);
    const fills = await db.query<{ count: number }>("select count(*)::int as count from public.dt_paper_fills where action='ENTRY'");
    expect(fills.rows[0].count).toBe(1);
  });

  it("rejects stale event costs for new entries while closing an existing paper position on its saved cost basis", async () => {
    await applyPaper(event("2026-11-02T09:30:00-03:00", { signal: "WATCH_LONG", stop: 98 }));
    await applyPaper(event("2026-11-02T09:31:00-03:00"));
    const exit = await applyPaper(event("2026-11-02T09:32:00-03:00", {
      open: 97, high: 99, low: 96, close: 98, fee_per_side: 999,
    }));
    expect(exit.action).toBe("STOP_EXIT");
    const blocked = await applyPaper(event("2026-11-02T09:33:00-03:00", {
      signal: "WATCH_LONG", stop: 96, fee_per_side: 999,
    }));
    expect(blocked.positionSide).toBe(0);
    const fills = await db.query<{ action: string; fees: string }>(
      "select action, fees from public.dt_paper_fills order by id",
    );
    expect(fills.rows).toHaveLength(2);
    expect(Number(fills.rows[0].fees)).toBeCloseTo(0.1);
    expect(Number(fills.rows[1].fees)).toBeCloseTo(0.1);
  });

  it("blocks a simulated entry when the configured risk per trade is too small", async () => {
    await saveExecution({ maxLossPerTrade: 3.5 });
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

  it("reduces available DASH capital by realized paper losses before allowing another entry", async () => {
    const risk = { max_loss_per_trade: 110, max_loss_per_day: 200, margin_per_contract: 50 };
    await saveExecution({ maxLossPerTrade: 110, maxLossPerDay: 200 });
    const queued = await applyPaper(event("2026-11-02T09:30:00-03:00", {
      ...risk, signal: "WATCH_LONG", stop: 94, point_value: 10,
    }));
    expect(queued.action).toBe("ENTRY_QUEUED");
    const opened = await applyPaper(event("2026-11-02T09:31:00-03:00", { ...risk, point_value: 10 }));
    expect(opened.action).toBe("ENTRY_FILLED");

    const stopped = await applyPaper(event("2026-11-02T09:32:00-03:00", {
      ...risk, point_value: 10, low: 92, close: 94,
    }));
    expect(stopped.action).toBe("STOP_EXIT");
    expect(stopped.realizedPnlToday).toBeLessThan(-70);

    const blocked = await applyPaper(event("2026-11-02T09:33:00-03:00", {
      ...risk, point_value: 10, signal: "WATCH_LONG", stop: 94,
    }));
    expect(blocked.action).toBe("NO_ACTION");
    const entries = await db.query<{ count: number }>(
      "select count(*)::int as count from public.dt_paper_fills where action='ENTRY'",
    );
    expect(entries.rows[0].count).toBe(1);
  });

  it("enforces the owner's open-position limit across instruments", async () => {
    await db.query(
      `insert into public.dt_paper_state(owner_id,instrument,session_day,position_side,entry_price,stop_price)
       values ($1,'WDOZ26','2026-11-02',1,5000,4990)`,
      [owner],
    );
    const result = await applyPaper(event("2026-11-02T09:30:00-03:00", {
      signal: "WATCH_LONG", stop: 98, max_open_positions: 1,
    }));
    expect(result.action).toBe("NO_ACTION");
    const entries = await db.query<{ count: number }>(
      "select count(*)::int as count from public.dt_paper_fills where owner_id=$1 and action='ENTRY'",
      [owner],
    );
    expect(entries.rows[0].count).toBe(0);
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

  it("rejects an exposure greater than the capital reserved to DASH", async () => {
    const result = await applyPaper(event("2026-11-02T09:30:00-03:00", {
      signal: "WATCH_LONG", stop: 98, capital_budget: 90,
    }));
    expect(result.positionSide).toBe(0);
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

  it("enforces paper-only order, ledger, and position rows in the database", async () => {
    await db.exec("savepoint live_order_forbidden");
    const signal = await db.query<{ id: number }>(
      `insert into public.dt_signals(owner_id,instrument,side,strategy_version,entry,stop,reason)
       values ($1,'WINZ26','BUY','test-v1',100,95,'test') returning id`,
      [owner],
    );
    const proposal = await db.query<{ id: number }>(
      `insert into public.dt_proposals(owner_id,signal_id,quantity,max_loss)
       values ($1,$2,1,10) returning id`,
      [owner, signal.rows[0].id],
    );
    await expect(db.query(
      `insert into public.dt_orders(owner_id,proposal_id,simulated,instrument,side,quantity,order_type,stop)
       values ($1,$2,false,'WINZ26','BUY',1,'LIMIT',95)`,
      [owner, proposal.rows[0].id],
    )).rejects.toThrow("dt_orders_simulated_only");
    await db.exec("rollback to savepoint live_order_forbidden; release savepoint live_order_forbidden");

    await db.exec("savepoint live_rows_forbidden");
    await expect(db.query(
      `insert into public.dt_positions(owner_id,instrument,quantity,average_price,confirmed_by_broker)
       values ($1,'WINZ26',1,100,true)`,
      [owner],
    )).rejects.toThrow("dt_positions_paper_only");
    await db.exec("rollback to savepoint live_rows_forbidden; release savepoint live_rows_forbidden");

    await db.exec("savepoint live_ledger_forbidden");
    await expect(db.query(
      `insert into public.dt_ledger(owner_id,simulated,instrument,side,quantity,price)
       values ($1,false,'WINZ26','BUY',1,100)`,
      [owner],
    )).rejects.toThrow("dt_ledger_simulated_only");
    await db.exec("rollback to savepoint live_ledger_forbidden; release savepoint live_ledger_forbidden");
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

describe("DASH market-data database boundary", () => {
  it("atomically persists structurally valid quote bars", async () => {
    const accepted = await acceptQuote({}, [{
      bucket_at: "2026-11-02T09:30:00-03:00", open: 100, high: 101, low: 99,
      close: 100, volume: 2, turnover: 200,
    }]);
    expect(accepted).toBe(true);
    const bars = await db.query<{ count: number }>("select count(*)::int as count from public.dt_market_bars where owner_id=$1", [owner]);
    const quotes = await db.query<{ count: number }>("select count(*)::int as count from public.dt_market_quotes where owner_id=$1", [owner]);
    expect(bars.rows[0].count).toBe(1);
    expect(quotes.rows[0].count).toBe(1);
  });

  it("rejects malformed candles before persisting the quote", async () => {
    await db.exec("savepoint invalid_market_bar");
    await expect(acceptQuote({}, [{
      bucket_at: "2026-11-02T09:30:00-03:00", open: 100, high: 99, low: 98,
      close: 100, volume: 2, turnover: 200,
    }])).rejects.toThrow("invalid ProfitDLL quote bar OHLCV");
    await db.exec("rollback to savepoint invalid_market_bar; release savepoint invalid_market_bar");
    const quotes = await db.query<{ count: number }>("select count(*)::int as count from public.dt_market_quotes where owner_id=$1", [owner]);
    expect(quotes.rows[0].count).toBe(0);
  });

  it("does not expose quote persistence to anonymous callers", async () => {
    await db.exec("savepoint anonymous_quote_call");
    await db.exec("set local role anon");
    await expect(acceptQuote({}, [{
      bucket_at: "2026-11-02T09:30:00-03:00", open: 100, high: 101, low: 99,
      close: 100, volume: 2, turnover: 200,
    }])).rejects.toThrow(/permission denied/i);
    await db.exec("rollback to savepoint anonymous_quote_call; release savepoint anonymous_quote_call");
    const quotes = await db.query<{ count: number }>("select count(*)::int as count from public.dt_market_quotes where owner_id=$1", [owner]);
    expect(quotes.rows[0].count).toBe(0);
  });
});
