begin;

-- Retain the quote timestamp used for each candle so out-of-order concurrent
-- HTTP handlers cannot replace a fresher partial candle with an older snapshot.
alter table public.dt_market_bars add column source_exchange_at timestamptz;
update public.dt_market_bars set source_exchange_at = bucket_at where source_exchange_at is null;
alter table public.dt_market_bars alter column source_exchange_at set not null;

drop function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint);

create function public.dt_accept_market_quote(
  p_owner_id uuid,
  p_instrument text,
  p_provider text,
  p_last numeric,
  p_bid numeric,
  p_ask numeric,
  p_exchange_at timestamptz,
  p_received_at timestamptz,
  p_sequence bigint,
  p_bars jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_accepted boolean;
begin
  insert into public.dt_market_quotes as current_quote (
    owner_id, instrument, provider, last, bid, ask, exchange_at, received_at, sequence
  ) values (
    p_owner_id, p_instrument, p_provider, p_last, p_bid, p_ask, p_exchange_at, p_received_at, p_sequence
  )
  on conflict (owner_id, instrument) do update set
    provider = excluded.provider,
    last = excluded.last,
    bid = excluded.bid,
    ask = excluded.ask,
    exchange_at = excluded.exchange_at,
    received_at = excluded.received_at,
    sequence = excluded.sequence
  where excluded.exchange_at > current_quote.exchange_at
     or (
       excluded.exchange_at = current_quote.exchange_at
       and excluded.sequence is not null
       and current_quote.sequence is not null
       and excluded.sequence > current_quote.sequence
     )
  returning true into v_accepted;

  if not coalesce(v_accepted, false) then
    return false;
  end if;

  insert into public.dt_market_bars (
    owner_id, instrument, provider, timeframe, bucket_at,
    open, high, low, close, volume, turnover, source_exchange_at, updated_at
  )
  select
    p_owner_id, p_instrument, p_provider, '1m', bars.bucket_at,
    bars.open, bars.high, bars.low, bars.close, bars.volume, bars.turnover,
    p_exchange_at, p_received_at
  from jsonb_to_recordset(coalesce(p_bars, '[]'::jsonb)) as bars(
    bucket_at timestamptz, open numeric, high numeric, low numeric,
    close numeric, volume bigint, turnover numeric
  )
  on conflict (owner_id, instrument, timeframe, bucket_at) do update set
    provider = excluded.provider,
    open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume,
    turnover = excluded.turnover,
    source_exchange_at = excluded.source_exchange_at,
    updated_at = excluded.updated_at
  where excluded.source_exchange_at > public.dt_market_bars.source_exchange_at;

  return true;
end;
$$;

revoke all on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  to service_role;

commit;
