-- Long daily price history for the agents' levels (52-week high/low, long averages).
-- Seeded from official B3 COTAHIST files and appended daily from the market feed.
-- Raw, as-traded prices; corporate events are applied when indicators are computed.
-- Rows are insert-only: an existing day is never overwritten (official data wins).
begin;

create table public.market_bars (
  ticker text not null check(ticker ~ '^[A-Z0-9]{3,12}$'),
  trade_date date not null,
  open numeric(20,4) not null check(open > 0),
  high numeric(20,4) not null check(high > 0),
  low numeric(20,4) not null check(low > 0 and low <= high),
  close numeric(20,4) not null check(close > 0),
  volume bigint not null default 0 check(volume >= 0),
  source text not null check(source in ('B3_COTAHIST','BRAPI')),
  inserted_at timestamptz not null default now(),
  primary key(ticker,trade_date),
  check(open between low and high and close between low and high)
);

alter table public.market_bars enable row level security;
revoke all on public.market_bars from public,anon,authenticated,service_role;
grant select on public.market_bars to authenticated;
grant select, insert on public.market_bars to service_role;
create policy owner_aal2_select on public.market_bars for select to authenticated
  using ((select atlas_private.is_atlas_owner()));
commit;
