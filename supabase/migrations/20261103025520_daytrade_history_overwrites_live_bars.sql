begin;

-- A verified complete ProfitDLL history import is authoritative for that session.
-- Replace any minute previously stored from the live collector instead of silently
-- preserving an incomplete realtime candle under the same primary key.
create or replace function public.dt_import_market_history(
  p_owner_id uuid,
  p_instrument text,
  p_session_day date,
  p_trade_count integer,
  p_bars jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_row_count integer;
  v_unique_count integer;
  v_first timestamptz;
  v_last timestamptz;
  v_inserted boolean := false;
  v_status text := 'IMPORTED';
  v_existing public.dt_market_history_sessions%rowtype;
begin
  if p_owner_id is null or p_instrument is null or p_instrument !~ '^[A-Z0-9$]{3,12}$'
    or p_session_day is null or p_session_day >= v_today or p_session_day < v_today - 30
    or p_trade_count is null or p_trade_count not between 1 and 2000000
    or p_bars is null or pg_catalog.jsonb_typeof(p_bars) <> 'array'
    or pg_catalog.jsonb_array_length(p_bars) not between 1 and 1440 then
    raise exception 'invalid ProfitDLL history import';
  end if;

  select count(*), count(distinct b.bucket_at), min(b.bucket_at), max(b.bucket_at)
    into v_row_count, v_unique_count, v_first, v_last
  from pg_catalog.jsonb_to_recordset(p_bars) as b(
    bucket_at timestamptz, open numeric, high numeric, low numeric,
    close numeric, volume bigint, turnover numeric
  );
  if v_row_count is distinct from pg_catalog.jsonb_array_length(p_bars)
    or v_row_count <> v_unique_count or v_row_count < 1
    or v_first is null or v_last is null then
    raise exception 'invalid or duplicate historical bars';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_bars) as b(
      bucket_at timestamptz, open numeric, high numeric, low numeric,
      close numeric, volume bigint, turnover numeric
    )
    where b.bucket_at is null or b.open is null or b.high is null or b.low is null
      or b.close is null or b.volume is null or b.turnover is null
      or b.bucket_at <> pg_catalog.date_trunc('minute', b.bucket_at)
      or (b.bucket_at at time zone 'America/Sao_Paulo')::date <> p_session_day
      or pg_catalog.to_char(b.bucket_at at time zone 'America/Sao_Paulo', 'HH24:MI') < '09:00'
      or pg_catalog.to_char(b.bucket_at at time zone 'America/Sao_Paulo', 'HH24:MI') >= '18:35'
      or b.open <= 0 or b.high <= 0 or b.low <= 0 or b.close <= 0
      or b.volume <= 0 or b.turnover <= 0
      or b.open::text in ('NaN', 'Infinity', '-Infinity')
      or b.high::text in ('NaN', 'Infinity', '-Infinity')
      or b.low::text in ('NaN', 'Infinity', '-Infinity')
      or b.close::text in ('NaN', 'Infinity', '-Infinity')
      or b.turnover::text in ('NaN', 'Infinity', '-Infinity')
      or b.high < greatest(b.open, b.close, b.low)
      or b.low > least(b.open, b.close, b.high)
      or b.turnover < b.low * b.volume - greatest(0.01, b.high * b.volume * 0.000000001)
      or b.turnover > b.high * b.volume + greatest(0.01, b.high * b.volume * 0.000000001)
    ) then
    raise exception 'historical bar failed OHLCV, turnover, time, or finite-value validation';
  end if;

  insert into public.dt_market_history_sessions (
    owner_id, instrument, session_day, trades_count, source_bar_count, first_bar_at, last_bar_at
  ) values (p_owner_id, p_instrument, p_session_day, p_trade_count, v_row_count, v_first, v_last)
  on conflict (owner_id, instrument, session_day) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    select * into strict v_existing from public.dt_market_history_sessions
    where owner_id = p_owner_id and instrument = p_instrument and session_day = p_session_day;
    if v_existing.trades_count <> p_trade_count or v_existing.source_bar_count <> v_row_count
      or v_existing.first_bar_at <> v_first or v_existing.last_bar_at <> v_last then
      raise exception 'historical session already imported with different source totals';
    end if;
    v_status := 'ALREADY_IMPORTED';
  end if;

  insert into public.dt_market_bars (
    owner_id, instrument, provider, timeframe, bucket_at,
    open, high, low, close, volume, turnover, source_exchange_at, updated_at
  )
  select p_owner_id, p_instrument, 'PROFITDLL_HISTORY', '1m', b.bucket_at,
    b.open, b.high, b.low, b.close, b.volume, b.turnover,
    b.bucket_at - interval '1 microsecond', now()
  from pg_catalog.jsonb_to_recordset(p_bars) as b(
    bucket_at timestamptz, open numeric, high numeric, low numeric,
    close numeric, volume bigint, turnover numeric
  )
  on conflict (owner_id, instrument, timeframe, bucket_at) do update
  set provider = excluded.provider,
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      turnover = excluded.turnover,
      source_exchange_at = excluded.source_exchange_at,
      updated_at = now();

  return pg_catalog.jsonb_build_object(
    'status', v_status,
    'bars', v_row_count, 'trades', p_trade_count, 'sessionDay', p_session_day
  );
end;
$$;
revoke all on function public.dt_import_market_history(uuid, text, date, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.dt_import_market_history(uuid, text, date, integer, jsonb)
  to service_role;

commit;
