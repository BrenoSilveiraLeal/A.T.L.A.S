-- Owner's decision (24/10/2026): the simulation restarts from zero to mirror the real plan
-- (R$ 200 per month split equally over the active team). Immutable history (fills, ledger,
-- events) is kept: the old book is closed with one balanced ledger transaction, positions are
-- written off at cost, and October's contribution is booked again with the equal split.
-- Also: each contribution now raises the order and exposure limits by the same amount, so the
-- deposits can actually be invested, and the per-agent loss limit is 40% (the owner's rule holds
-- through falls; VALE3 fell 23% while held in the 2023–2026 backtest).
begin;

create table public.paper_book_restarts (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  details jsonb not null default '{}' check(jsonb_typeof(details)='object')
);
alter table public.paper_book_restarts enable row level security;
revoke all on public.paper_book_restarts from public,anon,authenticated,service_role;
grant select on public.paper_book_restarts to authenticated,service_role;
create policy owner_aal2_select on public.paper_book_restarts for select to authenticated
  using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()));

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.apply_contribution(uuid,text,numeric,jsonb)'::regprocedure);
  v_new := replace(v_def, 'initial_cash=initial_cash+p_amount,updated_at',
    'initial_cash=initial_cash+p_amount,max_order_value=max_order_value+p_amount,max_exposure=max_exposure+p_amount,updated_at');
  if v_new = v_def then raise exception 'apply_contribution patch did not match'; end if;
  execute v_new;
end $$;

do $$
declare v_acc public.paper_accounts; v_tx uuid; v_kind record; v_month text := '2026-10'; v_amount numeric := 200;
  v_team int; v_share numeric; v_alloc jsonb; v_closed jsonb;
begin
  for v_acc in select * from public.paper_accounts for update loop
    -- 1) Cancel open virtual orders.
    update public.paper_orders set status='CANCELLED',closed_at=now() where owner_id=v_acc.owner_id and status='OPEN';
    -- 2) Close the old book: one balanced transaction that zeroes every ledger account.
    v_tx := gen_random_uuid();
    select coalesce(jsonb_object_agg(account_kind, total), '{}') into v_closed from (
      select account_kind, sum(amount) total from public.paper_ledger_entries where owner_id=v_acc.owner_id group by account_kind) b;
    for v_kind in select account_kind, sum(amount) total from public.paper_ledger_entries
      where owner_id=v_acc.owner_id group by account_kind having sum(amount) <> 0 loop
      insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
        values(v_acc.owner_id,v_tx,v_kind.account_kind,-v_kind.total);
    end loop;
    update public.paper_positions set quantity=0,average_cost=0,realized_pnl=0,updated_at=now() where owner_id=v_acc.owner_id;
    -- 3) Equal split of October over the active team; everybody else starts with nothing.
    select count(*) into v_team from public.agents where owner_id=v_acc.owner_id and enabled and autopilot and status not in ('DEAD','FIRED');
    v_share := case when v_team > 0 then floor(v_amount / v_team) else 0 end;
    update public.agents set budget = case when enabled and autopilot and status not in ('DEAD','FIRED') then v_share else 0 end,
      updated_at=now() where owner_id=v_acc.owner_id;
    select coalesce(jsonb_agg(jsonb_build_object('agentId',a.id,'name',a.name,'ticker',s.ticker,'amount',v_share,
      'reason','parte igual do mês; junta até ter R$ 100 para comprar') order by a.name), '[]') into v_alloc
      from public.agents a join public.assets s on s.id=a.asset_id
      where a.owner_id=v_acc.owner_id and a.enabled and a.autopilot and a.status not in ('DEAD','FIRED') and v_share > 0;
    update public.paper_accounts set cash=v_amount,reserved_cash=0,initial_cash=v_amount,max_order_value=v_amount,
      max_exposure=v_amount,max_daily_loss=least(max_daily_loss,v_amount),agent_max_loss_pct=40,updated_at=now()
      where owner_id=v_acc.owner_id;
    v_tx := gen_random_uuid();
    insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
      values(v_acc.owner_id,v_tx,'CASH',v_amount),(v_acc.owner_id,v_tx,'OPENING_EQUITY',-v_amount);
    insert into public.contributions(owner_id,month,amount,reserve,allocation)
      values(v_acc.owner_id,v_month,v_amount,v_amount-v_share*v_team,v_alloc)
      on conflict(owner_id,month) do update set amount=excluded.amount,reserve=excluded.reserve,allocation=excluded.allocation;
    update public.paper_agent_vitals v set budget=a.budget,realized_pnl=0,unrealized_pnl=0,life_pct=100,checked_at=now()
      from public.agents a where a.id=v.agent_id and v.owner_id=v_acc.owner_id and not v.eliminated;
    insert into public.paper_book_restarts(owner_id,details)
      values(v_acc.owner_id,jsonb_build_object('closedLedger',v_closed,'cash',v_amount,'share',v_share,'team',v_team,'simulation',true));
    insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
      values(v_acc.owner_id,'OWNER','PAPER_BOOK_RESTARTED','paper_account',v_acc.owner_id::text,
        jsonb_build_object('reason','simulação recomeça do zero com R$ 200 por mês divididos igualmente','closedLedger',v_closed));
  end loop;
end $$;

commit;
