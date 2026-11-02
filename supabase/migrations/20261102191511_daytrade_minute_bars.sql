begin;

-- One-minute OHLCV bars formed by the local, read-only ProfitDLL gateway.
create table public.dt_market_bars (
  owner_id uuid not null references auth.users(id),
  instrument text not null check (instrument ~ '^[A-Z0-9$]{3,12}$'),
  provider text not null check (provider = 'PROFITDLL_DAYTRADE'),
  timeframe text not null check (timeframe = '1m'),
  bucket_at timestamptz not null,
  open numeric(28,10) not null check (open > 0),
  high numeric(28,10) not null check (high > 0),
  low numeric(28,10) not null check (low > 0),
  close numeric(28,10) not null check (close > 0),
  volume bigint not null check (volume >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, instrument, timeframe, bucket_at),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);
create index dt_market_bars_recent on public.dt_market_bars(owner_id, instrument, bucket_at desc);
alter table public.dt_market_bars enable row level security;
revoke all on public.dt_market_bars from public, anon, authenticated, service_role;
grant select on public.dt_market_bars to authenticated;
grant select, insert, update on public.dt_market_bars to service_role;
create policy owner_aal2_select on public.dt_market_bars for select to authenticated
  using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()));

commit;
