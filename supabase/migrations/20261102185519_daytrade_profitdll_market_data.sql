begin;

-- Latest read-only ProfitDLL quote per contract. The owner can read via the existing AAL2 policy;
-- only the backend service role writes through the authenticated gateway API.
create table public.dt_market_quotes (
  owner_id uuid not null references auth.users(id),
  instrument text not null check (instrument ~ '^[A-Z0-9$]{3,12}$'),
  provider text not null check (provider = 'PROFITDLL_DAYTRADE'),
  last numeric(28,10) not null check (last > 0),
  bid numeric(28,10) check (bid is null or bid > 0),
  ask numeric(28,10) check (ask is null or ask > 0),
  exchange_at timestamptz not null,
  received_at timestamptz not null,
  sequence bigint check (sequence is null or sequence >= 0),
  primary key (owner_id, instrument),
  check (bid is null or ask is null or bid <= ask),
  check (received_at >= exchange_at)
);
alter table public.dt_market_quotes enable row level security;
revoke all on public.dt_market_quotes from public, anon, authenticated, service_role;
grant select on public.dt_market_quotes to authenticated;
grant select, insert, update on public.dt_market_quotes to service_role;
create policy owner_aal2_select on public.dt_market_quotes for select to authenticated
  using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()));

commit;
