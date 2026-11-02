-- 01/11/2026: DASH (day trade) — its own tables, apart from the stocks office (docs/daytrade/ARQUITETURA.md:
-- "tabelas dt_* próprias, com owner_id, RLS em cada tabela exposta, menor privilégio"). Nothing here
-- touches the existing tables. The owner reads (AAL2); only the backend (service role) writes. The
-- ledger and the journal are append-only: nothing is ever updated or deleted there.
begin;

-- Settings in force (mode, limits, kill switch). LIVE is refused by the check until a later migration.
create table public.dt_settings (
  owner_id uuid primary key references auth.users(id),
  mode text not null default 'SIMULATED' check (mode in ('SIMULATED')),
  halted boolean not null default false,
  halt_reason text,
  limits jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- One trading session per day: opened and closed by the chief (or closed by the supervisor/kill switch).
create table public.dt_sessions (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  day date not null,
  status text not null default 'PLANNED' check (status in ('PLANNED','OPEN','PAUSED','CLOSED')),
  plan jsonb not null default '{}',
  opened_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  unique(owner_id, day)
);

-- Each desk's last heartbeat (what the supervisor checks on his rounds).
create table public.dt_heartbeats (
  owner_id uuid not null references auth.users(id),
  desk text not null check (desk in ('chief','supervisor','feed','price','news','strategy','backtest','risk','positions','execution','orders','ledger')),
  state text not null check (state in ('IDLE','WORKING','BLOCKED','ERROR')),
  detail text not null default '',
  at timestamptz not null default now(),
  primary key (owner_id, desk)
);

-- Signals from the strategy desk, and the proposals that go into the analysis room with its votes.
create table public.dt_signals (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  instrument text not null,
  side text not null check (side in ('BUY','SELL')),
  strategy_version text not null,
  entry numeric(28,10) not null,
  stop numeric(28,10) not null,
  target numeric(28,10),
  reason text not null,
  created_at timestamptz not null default now()
);
create table public.dt_proposals (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  signal_id bigint not null references public.dt_signals(id),
  quantity integer not null check (quantity > 0),
  max_loss numeric(28,10) not null,
  status text not null default 'IN_ROOM' check (status in ('IN_ROOM','APPROVED','REJECTED','EXPIRED')),
  reasons jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create table public.dt_room_votes (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  proposal_id bigint not null references public.dt_proposals(id),
  desk text not null,
  vote text not null check (vote in ('APPROVE','REJECT','ABSTAIN')),
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique(proposal_id, desk)
);

-- Orders and every state they go through (never just "done"); simulated ones are marked as such.
create table public.dt_orders (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  proposal_id bigint not null references public.dt_proposals(id),
  simulated boolean not null,
  instrument text not null,
  side text not null check (side in ('BUY','SELL')),
  quantity integer not null check (quantity > 0),
  order_type text not null check (order_type in ('LIMIT','MARKET')),
  price numeric(28,10),
  stop numeric(28,10) not null,
  state text not null default 'PROPOSED' check (state in ('PROPOSED','SENT','ACCEPTED','REJECTED','PARTIAL','FILLED','CANCELLED')),
  broker_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.dt_order_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  order_id bigint not null references public.dt_orders(id),
  state text not null,
  filled_quantity integer not null default 0,
  average_price numeric(28,10),
  broker_message text,
  at timestamptz not null default now()
);

-- Positions as confirmed by the broker (reconciled), and the ledger of every operation with costs.
create table public.dt_positions (
  owner_id uuid not null references auth.users(id),
  instrument text not null,
  quantity integer not null,
  average_price numeric(28,10) not null,
  confirmed_by_broker boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, instrument)
);
create table public.dt_ledger (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  order_id bigint references public.dt_orders(id),
  simulated boolean not null,
  instrument text not null,
  side text not null check (side in ('BUY','SELL')),
  quantity integer not null check (quantity > 0),
  price numeric(28,10) not null,
  fees numeric(28,10) not null default 0,
  at timestamptz not null default now()
);

-- What every desk did, in order (the cycle's journal).
create table public.dt_journal (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  desk text not null,
  state text not null,
  message text not null,
  at timestamptz not null default now()
);

-- Append-only: the ledger and the journal are never changed or erased.
create function public.dt_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'dt append-only: % is never updated or deleted', tg_table_name;
end $$;
create trigger dt_ledger_append_only before update or delete on public.dt_ledger for each row execute function public.dt_append_only();
create trigger dt_journal_append_only before update or delete on public.dt_journal for each row execute function public.dt_append_only();

-- Row-level security: the owner reads with AAL2; the backend writes with the service role.
do $$
declare t text;
begin
  foreach t in array array['dt_settings','dt_sessions','dt_heartbeats','dt_signals','dt_proposals','dt_room_votes','dt_orders','dt_order_events','dt_positions','dt_ledger','dt_journal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy owner_aal2_select on public.%I for select to authenticated using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()))', t);
  end loop;
end $$;
grant select, insert, update on public.dt_settings, public.dt_sessions, public.dt_heartbeats, public.dt_proposals, public.dt_orders, public.dt_positions to service_role;
grant select, insert on public.dt_signals, public.dt_room_votes, public.dt_order_events, public.dt_ledger, public.dt_journal to service_role;
revoke all on function public.dt_append_only() from public, anon, authenticated;

commit;
