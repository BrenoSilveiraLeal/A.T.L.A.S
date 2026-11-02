begin;

-- Idempotent, owner-visible audit of the strategy desk's minute-by-minute research output.
-- This table stores observations only; it does not authorize or stage orders.
create table public.dt_strategy_observations (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  instrument text not null check (instrument ~ '^[A-Z0-9$]{3,12}$'),
  strategy_version text not null,
  bar_at timestamptz not null,
  state text not null check (state in ('INSUFFICIENT_DATA','WAITING_FOR_OPENING_RANGE','NO_SETUP','WATCH_LONG','WATCH_SHORT')),
  entry numeric(28,10),
  stop numeric(28,10),
  explanation text not null,
  blocked_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(blocked_reasons) = 'array'),
  created_at timestamptz not null default now(),
  unique(owner_id, instrument, strategy_version, bar_at),
  check (entry is null or entry > 0),
  check (stop is null or stop > 0)
);
create index dt_strategy_observations_recent on public.dt_strategy_observations(owner_id, instrument, bar_at desc);
alter table public.dt_strategy_observations enable row level security;
revoke all on public.dt_strategy_observations from public, anon, authenticated, service_role;
grant select on public.dt_strategy_observations to authenticated;
grant select, insert on public.dt_strategy_observations to service_role;
create policy owner_aal2_select on public.dt_strategy_observations for select to authenticated
  using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()));

commit;
