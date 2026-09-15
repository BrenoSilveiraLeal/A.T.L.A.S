-- The read cache is disposable. Analysis evidence and all financial/audit history
-- are stored separately and are never selected by this maintenance function.
create index market_read_cache_retention_idx
  on public.market_data_cache(owner_id,retrieved_at,id)
  where data_kind = 'READ_CACHE_V1';

create function public.prune_market_data_cache(p_owner_id uuid,p_limit integer default 500)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_cutoff timestamptz := clock_timestamp() - interval '7 days';
  v_deleted integer;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'CACHE_RETENTION_INVALID_LIMIT' using errcode = '22023';
  end if;
  with candidates as (
    select id from public.market_data_cache
    where owner_id = p_owner_id and data_kind = 'READ_CACHE_V1'
      and retrieved_at < v_cutoff
    order by retrieved_at,id
    limit p_limit
    for update skip locked
  )
  delete from public.market_data_cache cache using candidates
    where cache.id = candidates.id;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'SYSTEM','READ_CACHE_PRUNED','market_data_cache','READ_CACHE_V1',
      jsonb_build_object('deleted',v_deleted,'olderThan',v_cutoff,'retentionDays',7));
  end if;
  return v_deleted;
end;
$$;

-- Only the authenticated server worker can invoke maintenance. Direct delete is
-- removed so an accidental broad service-role delete cannot bypass the bounds.
revoke delete on public.market_data_cache from service_role;
revoke all on function public.prune_market_data_cache(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.prune_market_data_cache(uuid,integer) to service_role;
