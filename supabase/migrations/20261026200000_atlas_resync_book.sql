-- 26/10/2026: the cloud decided a purchase (Davi, 1 AXIA3) while the Genial bridge was down, so the
-- agents' book showed a position and less cash than the real account. resync_book_to_real makes the
-- book equal to the real money again: shares = the real positions at Genial (live_positions), cash =
-- deposits + realized results − cost of the real shares. History is kept: the old book is closed
-- with one balanced ledger transaction. Applied now to undo the purchase that never happened.
begin;

create function atlas_private.resync_book_to_real(p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_tx uuid := gen_random_uuid(); v_closed jsonb; v_deposited numeric; v_cash numeric; v_positions int;
begin
  perform 1 from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  update public.paper_orders set status='CANCELLED',closed_at=now() where owner_id=p_owner_id and status='OPEN';
  select coalesce(jsonb_object_agg(account_kind, total), '{}') into v_closed from (
    select account_kind, sum(amount) total from public.paper_ledger_entries where owner_id=p_owner_id group by account_kind) b;
  insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
    select p_owner_id, v_tx, account_kind, -sum(amount) from public.paper_ledger_entries
    where owner_id=p_owner_id group by account_kind having sum(amount) <> 0;
  -- Shares: exactly the real ones.
  update public.paper_positions set quantity=0, average_cost=0, realized_pnl=0, updated_at=now() where owner_id=p_owner_id;
  insert into public.paper_positions(owner_id, agent_id, asset_id, quantity, average_cost, realized_pnl, updated_at)
    select l.owner_id, l.agent_id, a.id, l.quantity, case when l.quantity > 0 then round(l.cost / l.quantity, 8) else 0 end, l.realized_pnl, now()
    from public.live_positions l join public.assets a on a.owner_id=l.owner_id and a.ticker=l.ticker
    where l.owner_id=p_owner_id and l.quantity > 0
    on conflict(owner_id, agent_id, asset_id) do update set quantity=excluded.quantity, average_cost=excluded.average_cost,
      realized_pnl=excluded.realized_pnl, updated_at=now();
  get diagnostics v_positions = row_count;
  -- Cash: what is free at Genial as ATLAS counts it.
  select coalesce(ceiling,0) into v_deposited from public.capital_plans where owner_id=p_owner_id;
  v_cash := coalesce(v_deposited,0) + coalesce((select sum(realized_pnl) from public.live_positions where owner_id=p_owner_id),0)
    - coalesce((select sum(cost) from public.live_positions where owner_id=p_owner_id),0);
  v_tx := gen_random_uuid();
  update public.paper_accounts set cash=greatest(v_cash,0), reserved_cash=0, initial_cash=coalesce(v_deposited,0),
    max_order_value=greatest(coalesce(v_deposited,0),0.01), max_exposure=greatest(coalesce(v_deposited,0),0.01), updated_at=now()
    where owner_id=p_owner_id;
  if v_cash > 0 then
    insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
      values(p_owner_id,v_tx,'CASH',round(v_cash,2)),(p_owner_id,v_tx,'OPENING_EQUITY',-round(v_cash,2));
  end if;
  update public.paper_agent_vitals set realized_pnl=0, unrealized_pnl=0, life_pct=100, checked_at=now() where owner_id=p_owner_id and not eliminated;
  insert into public.paper_book_restarts(owner_id,details)
    values(p_owner_id, jsonb_build_object('reason','resync with the real money at Genial','closedLedger',v_closed,'cash',v_cash,'positions',v_positions));
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'SYSTEM','PAPER_BOOK_RESYNCED','paper_account',p_owner_id::text,jsonb_build_object('cash',v_cash::text,'positions',v_positions));
  return jsonb_build_object('cash', v_cash, 'positions', v_positions);
end $$;

create function public.resync_book_to_real(p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform atlas_private.require_owner(p_owner_id);
  return atlas_private.resync_book_to_real(p_owner_id);
end $$;
revoke all on function atlas_private.resync_book_to_real(uuid) from public,anon,authenticated,service_role;
revoke all on function public.resync_book_to_real(uuid) from public,anon,authenticated,service_role;
grant execute on function public.resync_book_to_real(uuid) to service_role;

do $$ declare v record; begin
  for v in select owner_id from public.paper_accounts loop perform atlas_private.resync_book_to_real(v.owner_id); end loop;
end $$;

commit;
