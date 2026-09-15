-- Read-only account-scoped portfolio evidence. No balances or positions are seeded.
begin;

create index portfolio_history_account_time_idx on public.portfolio_snapshots
  (owner_id, broker_account_id, source_timestamp desc, created_at desc, id)
  where reconciled and discrepancies = '[]'::jsonb;

create function public.get_portfolio_history(
  p_owner_id uuid,
  p_broker_account_id uuid default null,
  p_limit integer default 200
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_account_id uuid;
  v_accounts jsonb;
  v_snapshots jsonb;
  v_positions jsonb;
  v_history_count integer;
  v_position_count integer;
  v_now timestamptz := statement_timestamp();
begin
  if p_owner_id is null or not exists (
    select 1 from public.system_state where id and owner_id = p_owner_id
  ) then
    raise exception 'ATLAS_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'INVALID_HISTORY_LIMIT' using errcode = '22023';
  end if;
  if p_broker_account_id is not null and not exists (
    select 1 from public.broker_accounts
    where id = p_broker_account_id and owner_id = p_owner_id
  ) then
    raise exception 'PORTFOLIO_ACCOUNT_NOT_FOUND' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'provider', provider)
    order by created_at desc, id), '[]'::jsonb)
  into v_accounts from public.broker_accounts where owner_id = p_owner_id;
  select id into v_account_id from public.broker_accounts
  where owner_id = p_owner_id and (p_broker_account_id is null or id = p_broker_account_id)
  order by created_at desc, id limit 1;

  -- A corrected record supersedes an earlier record at the same source instant.
  -- No generated dates, forward fills, cross-account sums or inferred returns.
  with eligible as (
    select distinct on (source_timestamp) s.*
    from public.portfolio_snapshots s
    where owner_id = p_owner_id and broker_account_id = v_account_id
      and reconciled and discrepancies = '[]'::jsonb
      and isfinite(source_timestamp) and isfinite(created_at)
      and source_timestamp <= created_at and created_at <= v_now
    order by source_timestamp desc, created_at desc, id desc
    limit p_limit + 1
  ), selected as (
    select * from eligible order by source_timestamp desc limit p_limit
  )
  select (select count(*)::integer from eligible),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'brokerAccountId', broker_account_id,
      'cash', cash::text, 'equity', equity::text, 'invested', invested::text,
      'realizedPnl', realized_pnl::text, 'unrealizedPnl', unrealized_pnl::text,
      'reconciled', reconciled, 'discrepancies', discrepancies,
      'sourceTimestamp', source_timestamp, 'createdAt', created_at
    ) order by source_timestamp), '[]'::jsonb)
  into v_history_count, v_snapshots from selected;

  with eligible as (
    select p.*, a.ticker, a.exchange, a.currency, g.name as agent_name,
      g.asset_id as agent_asset_id
    from public.positions p
    join public.assets a on a.id = p.asset_id and a.owner_id = p.owner_id
    left join public.agents g on g.id = p.agent_id and g.owner_id = p.owner_id
      and g.asset_id = p.asset_id
    where p.owner_id = p_owner_id and p.broker_account_id = v_account_id
      and isfinite(p.reconciled_at) and p.reconciled_at <= v_now
      and (p.agent_id is null or g.id is not null)
    order by a.ticker, p.id limit 501
  ), selected as (
    select * from eligible order by ticker, id limit 500
  )
  select (select count(*)::integer from eligible),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'brokerAccountId', broker_account_id, 'assetId', asset_id,
      'ticker', ticker, 'exchange', exchange, 'currency', currency,
      'agentId', agent_id, 'agentName', agent_name, 'agentAssetId', agent_asset_id,
      'quantity', quantity::text, 'reservedQuantity', reserved_quantity::text,
      'averagePrice', average_price::text, 'realizedPnl', realized_pnl::text,
      'reconciledAt', reconciled_at
    ) order by ticker, id), '[]'::jsonb)
  into v_position_count, v_positions from selected;

  return jsonb_build_object(
    'brokerAccounts', v_accounts, 'brokerAccountId', v_account_id,
    'snapshots', v_snapshots, 'positions', v_positions,
    'historyTruncated', v_history_count > p_limit,
    'positionsTruncated', v_position_count > 500
  );
end $$;

revoke all on function public.get_portfolio_history(uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_portfolio_history(uuid,uuid,integer) to service_role;
comment on function public.get_portfolio_history(uuid,uuid,integer) is
  'Backend only after owner AAL2 authorization. Read-only SECURITY INVOKER, one broker account per response, exact decimal strings.';

commit;
