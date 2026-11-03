begin;

-- Repeat structural OHLCV validation inside the transactional persistence boundary.
-- Contract tick alignment and session hours remain checked by the authenticated API,
-- which owns the verified public contract metadata.
alter function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  rename to dt_accept_market_quote_before_bar_validation;
revoke all on function public.dt_accept_market_quote_before_bar_validation(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.dt_accept_market_quote_before_bar_validation(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  to service_role;

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
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_rows integer;
  v_unique integer;
  v_exchange_minute timestamptz;
begin
  if p_owner_id is null or p_instrument is null or p_instrument !~ '^[A-Z0-9$]{3,12}$'
    or p_provider is distinct from 'PROFITDLL_DAYTRADE'
    or p_last is null or p_last <= 0 or p_last::text in ('NaN','Infinity','-Infinity')
    or (p_bid is not null and (p_bid <= 0 or p_bid::text in ('NaN','Infinity','-Infinity')))
    or (p_ask is not null and (p_ask <= 0 or p_ask::text in ('NaN','Infinity','-Infinity')))
    or (p_bid is not null and p_ask is not null and p_bid > p_ask)
    or p_exchange_at is null or p_received_at is null or p_received_at < p_exchange_at
    or p_sequence is null or p_sequence < 0
    or p_bars is null or pg_catalog.jsonb_typeof(p_bars) <> 'array'
    or pg_catalog.jsonb_array_length(p_bars) > 11 then
    raise exception 'invalid ProfitDLL quote or bars';
  end if;

  v_exchange_minute := pg_catalog.date_trunc('minute', p_exchange_at);
  select count(*)::integer, count(distinct b.bucket_at)::integer
    into v_rows, v_unique
    from pg_catalog.jsonb_to_recordset(p_bars) as b(
      bucket_at timestamptz, open numeric, high numeric, low numeric,
      close numeric, volume bigint, turnover numeric
    );
  if v_rows <> v_unique then
    raise exception 'duplicate ProfitDLL quote bars';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_bars) as b(
      bucket_at timestamptz, open numeric, high numeric, low numeric,
      close numeric, volume bigint, turnover numeric
    )
    where b.bucket_at is null or b.open is null or b.high is null or b.low is null
      or b.close is null or b.volume is null
      or b.bucket_at <> pg_catalog.date_trunc('minute', b.bucket_at)
      or b.bucket_at > v_exchange_minute
      or b.bucket_at < v_exchange_minute - interval '2 minutes'
      or b.open <= 0 or b.high <= 0 or b.low <= 0 or b.close <= 0 or b.volume <= 0
      or b.open::text in ('NaN','Infinity','-Infinity')
      or b.high::text in ('NaN','Infinity','-Infinity')
      or b.low::text in ('NaN','Infinity','-Infinity')
      or b.close::text in ('NaN','Infinity','-Infinity')
      or b.high < greatest(b.open,b.close,b.low)
      or b.low > least(b.open,b.close,b.high)
      or (b.turnover is not null and (
        b.turnover <= 0 or b.turnover::text in ('NaN','Infinity','-Infinity')
        or b.turnover < b.low*b.volume - greatest(0.01,b.high*b.volume*0.000000001)
        or b.turnover > b.high*b.volume + greatest(0.01,b.high*b.volume*0.000000001)
      ))
  ) then
    raise exception 'invalid ProfitDLL quote bar OHLCV, turnover, or timestamp';
  end if;

  return public.dt_accept_market_quote_before_bar_validation(
    p_owner_id,p_instrument,p_provider,p_last,p_bid,p_ask,p_exchange_at,p_received_at,p_sequence,p_bars
  );
end $$;

revoke all on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  to service_role;

commit;
