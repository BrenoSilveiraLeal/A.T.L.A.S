-- Owner (24/10/2026): "não é para ter simulação, é só coisa real". The agents' book (paper_*)
-- now mirrors the real money at Genial: it starts from what the owner actually deposited and
-- each agent's decision budget equals its real budget. The autopilot keeps deciding on this book
-- and the live executor sends the same orders to Genial. There is no simulated monthly
-- contribution any more: register_deposit records each real deposit (raises the real-money
-- ceiling, the agents' real and decision budgets and the book's cash together).
-- First real deposit: R$ 50, all to Ana (ITUB4), as the owner chose for the first test.
begin;

-- The book may now hold less than R$ 100 (a R$ 50 test).
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.paper_accounts'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%initial_cash%' loop
    execute format('alter table public.paper_accounts drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.paper_accounts add constraint paper_accounts_initial_cash_check check(initial_cash between 0 and 100000000);
alter table public.paper_accounts add constraint paper_accounts_limits_check check(max_order_value <= greatest(initial_cash, 0.01) and max_exposure <= greatest(initial_cash, 0.01));

create table public.real_deposits (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  amount numeric(20,2) not null check(amount > 0 and amount <= 1000000),
  allocation jsonb not null check(jsonb_typeof(allocation)='array'),
  created_at timestamptz not null default now()
);
alter table public.real_deposits enable row level security;
revoke all on public.real_deposits from public,anon,authenticated,service_role;
grant select on public.real_deposits to authenticated,service_role;
create policy owner_aal2_select on public.real_deposits for select to authenticated
  using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()));

-- allocation: [{"agentId": uuid, "amount": number}] summing to at most the amount (the rest stays
-- with the owner, outside the agents' budgets).
create function atlas_private.register_deposit(p_owner_id uuid, p_amount numeric, p_allocation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_part numeric; v_sum numeric := 0; v_agent public.agents; v_tx uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount,2)
    or p_allocation is null or jsonb_typeof(p_allocation) <> 'array' or jsonb_array_length(p_allocation) > 50 then
    raise exception 'ATLAS_INVALID_DEPOSIT'; end if;
  perform 1 from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  for v_item in select value from jsonb_array_elements(p_allocation) loop
    v_part := round((v_item->>'amount')::numeric, 2);
    if v_part is null or v_part < 0 then raise exception 'ATLAS_INVALID_DEPOSIT'; end if;
    select * into v_agent from public.agents where id=(v_item->>'agentId')::uuid and owner_id=p_owner_id for update;
    if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
    if v_agent.status in ('DEAD','FIRED') then raise exception 'ATLAS_AGENT_ELIMINATED'; end if;
    update public.agents set budget=budget+v_part, real_budget=real_budget+v_part, updated_at=now() where id=v_agent.id;
    v_sum := v_sum + v_part;
  end loop;
  if v_sum > p_amount then raise exception 'ATLAS_DEPOSIT_OVERALLOCATED'; end if;
  insert into public.capital_plans(owner_id, ceiling) values(p_owner_id, p_amount)
    on conflict(owner_id) do update set ceiling=public.capital_plans.ceiling+p_amount, updated_at=now();
  update public.paper_accounts set cash=cash+p_amount, initial_cash=initial_cash+p_amount,
    max_order_value=least(max_order_value+p_amount, initial_cash+p_amount), max_exposure=least(max_exposure+p_amount, initial_cash+p_amount),
    updated_at=now() where owner_id=p_owner_id;
  insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
    values(p_owner_id,v_tx,'CASH',p_amount),(p_owner_id,v_tx,'OPENING_EQUITY',-p_amount);
  insert into public.real_deposits(owner_id, amount, allocation) values(p_owner_id, p_amount, p_allocation);
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'OWNER','REAL_DEPOSIT_REGISTERED','capital',p_owner_id::text,
      jsonb_build_object('amount',p_amount::text,'allocation',p_allocation));
  return jsonb_build_object('amount',p_amount,'allocated',v_sum);
end $$;

create function public.register_deposit(p_owner_id uuid, p_amount numeric, p_allocation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform atlas_private.require_owner(p_owner_id);
  return atlas_private.register_deposit(p_owner_id, p_amount, p_allocation);
end $$;
revoke all on function atlas_private.register_deposit(uuid,numeric,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.register_deposit(uuid,numeric,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.register_deposit(uuid,numeric,jsonb) to service_role;

-- Start the book from zero (history kept: one balanced closing transaction), then book the
-- owner's first real deposit.
do $$
declare v_acc public.paper_accounts; v_tx uuid; v_kind record; v_closed jsonb; v_ana uuid;
begin
  for v_acc in select * from public.paper_accounts for update loop
    update public.paper_orders set status='CANCELLED',closed_at=now() where owner_id=v_acc.owner_id and status='OPEN';
    select coalesce(jsonb_object_agg(account_kind, total), '{}') into v_closed from (
      select account_kind, sum(amount) total from public.paper_ledger_entries where owner_id=v_acc.owner_id group by account_kind) b;
    v_tx := gen_random_uuid();
    insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
      select v_acc.owner_id, v_tx, account_kind, -sum(amount) from public.paper_ledger_entries
      where owner_id=v_acc.owner_id group by account_kind having sum(amount) <> 0;
    update public.paper_positions set quantity=0,average_cost=0,realized_pnl=0,updated_at=now() where owner_id=v_acc.owner_id;
    update public.agents set budget=0, real_budget=0, updated_at=now() where owner_id=v_acc.owner_id;
    update public.paper_accounts set cash=0,reserved_cash=0,initial_cash=0,max_order_value=0.01,max_exposure=0.01,
      max_daily_loss=50,updated_at=now() where owner_id=v_acc.owner_id;
    insert into public.capital_plans(owner_id, ceiling) values(v_acc.owner_id, 0)
      on conflict(owner_id) do update set ceiling=0, updated_at=now();
    update public.paper_agent_vitals set budget=0,realized_pnl=0,unrealized_pnl=0,life_pct=100,checked_at=now()
      where owner_id=v_acc.owner_id and not eliminated;
    insert into public.paper_book_restarts(owner_id,details)
      values(v_acc.owner_id,jsonb_build_object('closedLedger',v_closed,'reason','real money only','simulation',false));
    select a.id into v_ana from public.agents a join public.assets s on s.id=a.asset_id
      where a.owner_id=v_acc.owner_id and s.ticker='ITUB4' and a.status not in ('DEAD','FIRED') limit 1;
    if v_ana is null then raise exception 'ITUB4 agent not found'; end if;
    perform atlas_private.register_deposit(v_acc.owner_id, 50, jsonb_build_array(jsonb_build_object('agentId', v_ana, 'amount', 50)));
  end loop;
end $$;

commit;
