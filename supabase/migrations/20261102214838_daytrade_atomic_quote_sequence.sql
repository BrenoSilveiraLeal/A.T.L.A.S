begin;

-- Serialize the freshness check and quote write in one PostgreSQL upsert.
-- Concurrent gateway requests must never let an older quote replace a newer one.
create function public.dt_accept_market_quote(
  p_owner_id uuid,
  p_instrument text,
  p_provider text,
  p_last numeric,
  p_bid numeric,
  p_ask numeric,
  p_exchange_at timestamptz,
  p_received_at timestamptz,
  p_sequence bigint
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

  return coalesce(v_accepted, false);
end;
$$;

revoke all on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint)
  to service_role;

commit;
