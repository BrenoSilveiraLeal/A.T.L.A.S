-- Owner's rule (24/10/2026): a replaced agent is deleted, not kept anywhere ("ela simplesmente vai
-- ser deletada e substituída por outra"). remove_agent deletes the agent and every row that
-- depends on it (decisions, jobs, simulation proposals/orders/fills, vitals...), following the
-- foreign keys. It refuses an agent with real-money history (orders, executions, ledger, live
-- orders) or with shares still held, so nothing real is ever erased. The simulation ledger stays
-- balanced: the deleted fill entries are replaced by one consolidated entry per account.
-- An asset no other agent uses is removed with it. The retired agents are removed now.
begin;

create function atlas_private.purge_rows(p_table regclass, p_where text, p_depth integer default 0)
returns void language plpgsql security definer set search_path='' as $$
declare c record; v_child_cols text; v_parent_cols text;
begin
  if p_depth > 8 then raise exception 'ATLAS_PURGE_TOO_DEEP'; end if;
  insert into pg_temp.atlas_purge_touched values (p_table) on conflict do nothing;
  for c in select con.conrelid::regclass as child, con.conkey, con.confkey from pg_catalog.pg_constraint con
    where con.contype='f' and con.confrelid=p_table and con.conrelid<>p_table loop
    select string_agg(quote_ident(a.attname), ',' order by k.ord) into v_child_cols
      from unnest(c.conkey) with ordinality k(attnum,ord) join pg_catalog.pg_attribute a on a.attrelid=c.child and a.attnum=k.attnum;
    select string_agg(quote_ident(a.attname), ',' order by k.ord) into v_parent_cols
      from unnest(c.confkey) with ordinality k(attnum,ord) join pg_catalog.pg_attribute a on a.attrelid=p_table and a.attnum=k.attnum;
    perform atlas_private.purge_rows(c.child,
      format('(%s) in (select %s from %s where %s)', v_child_cols, v_parent_cols, p_table, p_where), p_depth+1);
  end loop;
  -- Immutability triggers would reject the delete; foreign keys stay enforced (internal triggers).
  execute format('alter table %s disable trigger user', p_table);
  execute format('delete from %s where %s', p_table, p_where);
end $$;

create function atlas_private.remove_agent(p_owner_id uuid, p_agent_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_agent public.agents; v_asset uuid; v_ticker text; v_tx uuid := gen_random_uuid(); v_t regclass;
  v_asset_removed boolean := false;
begin
  select * into v_agent from public.agents where id=p_agent_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
  if exists(select 1 from public.orders where agent_id=p_agent_id) or exists(select 1 from public.live_orders where agent_id=p_agent_id)
    or exists(select 1 from public.ledger_transactions where agent_id=p_agent_id) then
    raise exception 'ATLAS_AGENT_HAS_REAL_HISTORY'; end if;
  if exists(select 1 from public.paper_positions where agent_id=p_agent_id and quantity>0)
    or exists(select 1 from public.live_positions where agent_id=p_agent_id and quantity>0) then
    raise exception 'ATLAS_AGENT_HOLDS_SHARES'; end if;
  if exists(select 1 from public.paper_orders where agent_id=p_agent_id and status='OPEN') then
    raise exception 'ATLAS_AGENT_HAS_OPEN_ORDER'; end if;
  -- Earlier writes in this transaction leave deferred checks pending; ALTER TABLE needs none.
  set constraints all immediate;
  v_asset := v_agent.asset_id;
  select ticker into v_ticker from public.assets where id=v_asset;
  create temp table if not exists atlas_purge_touched(t regclass primary key) on commit drop;
  create temp table if not exists atlas_purge_ledger(account_kind text, total numeric) on commit drop;
  delete from pg_temp.atlas_purge_ledger;
  -- Whole ledger transactions of the agent's fills (each one is balanced) leave together and
  -- come back as one consolidated transaction, so every account keeps its balance.
  insert into pg_temp.atlas_purge_ledger select account_kind, sum(amount) from public.paper_ledger_entries
    where transaction_id in (select transaction_id from public.paper_ledger_entries
      where fill_id in (select id from public.paper_fills where agent_id=p_agent_id))
    group by account_kind having sum(amount)<>0;
  perform atlas_private.purge_rows('public.paper_ledger_entries'::regclass, format(
    'transaction_id in (select transaction_id from public.paper_ledger_entries where fill_id in (select id from public.paper_fills where agent_id=%L))', p_agent_id));
  perform atlas_private.purge_rows('public.agents'::regclass, format('id=%L', p_agent_id));
  if not exists(select 1 from public.agents where asset_id=v_asset)
    and not exists(select 1 from public.orders where asset_id=v_asset) and not exists(select 1 from public.live_orders where ticker=v_ticker) then
    perform atlas_private.purge_rows('public.assets'::regclass, format('id=%L', v_asset));
    v_asset_removed := true;
  end if;
  for v_t in select t from pg_temp.atlas_purge_touched loop execute format('alter table %s enable trigger user', v_t); end loop;
  delete from pg_temp.atlas_purge_touched;
  -- One statement: the balance check (now immediate) runs after all rows are in.
  insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
    select p_owner_id,v_tx,account_kind,total from pg_temp.atlas_purge_ledger;
  -- Check the balance now: pending trigger events would block a later ALTER TABLE.
  set constraints all immediate;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'OWNER','AGENT_REMOVED','agent',p_agent_id::text,
      jsonb_build_object('name',v_agent.name,'ticker',v_ticker,'assetRemoved',v_asset_removed));
  return jsonb_build_object('removed',v_agent.name,'ticker',v_ticker,'assetRemoved',v_asset_removed);
end $$;

create function public.remove_agent(p_owner_id uuid, p_agent_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform atlas_private.require_owner(p_owner_id);
  return atlas_private.remove_agent(p_owner_id, p_agent_id);
end $$;
revoke all on function atlas_private.purge_rows(regclass,text,integer) from public,anon,authenticated,service_role;
revoke all on function atlas_private.remove_agent(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.remove_agent(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.remove_agent(uuid,uuid) to service_role;

-- Tickers like B3SA3 have a digit in the issuer code: the live order checks only took letters.
alter table public.live_orders drop constraint live_orders_ticker_check;
alter table public.live_orders add constraint live_orders_ticker_check check(ticker ~ '^[A-Z][A-Z0-9]{3}[0-9]{1,2}$');
do $$ declare v_def text; v_new text; begin
  v_def := pg_get_functiondef('public.live_create_order(uuid,uuid,text,integer,numeric,text,uuid)'::regprocedure);
  v_new := replace(v_def, '''^[A-Z]{4}[0-9]{1,2}$''', '''^[A-Z][A-Z0-9]{3}[0-9]{1,2}$''');
  if v_new = v_def then raise exception 'live_create_order ticker patch did not match'; end if;
  execute v_new;
end $$;

-- The retired team (autopilot switched off by the owner): Lucas, Bia, Caio, Lia and Pedro.
-- The list is read first: an open cursor on agents would block the ALTER TABLE in the purge.
do $$ declare v_ids uuid[]; v_owners uuid[]; i integer; begin
  select array_agg(id order by name), array_agg(owner_id order by name) into v_ids, v_owners from public.agents where autopilot = false;
  for i in 1..coalesce(array_length(v_ids, 1), 0) loop
    perform atlas_private.remove_agent(v_owners[i], v_ids[i]);
  end loop;
end $$;

commit;
