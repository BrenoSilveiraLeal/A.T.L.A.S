-- Owner (25/10/2026): the money at Genial is one pot held by "the boss". The owner no longer
-- assigns money to agents; the application's boss rule decides how much an agent may use at the
-- moment its own rule says to buy, and sales return the money to the pot.
-- In the database every working agent may draw on the whole pot (budget = real_budget = all the
-- deposits); the limit that matters for real orders is the free money in the pot, checked here.
begin;

-- Real orders: an agent may use what is free in the whole pot (deposits + realized results − cost
-- of shares held − buy orders in flight), never more.
create or replace function atlas_private.live_agent_room(p_owner_id uuid,p_agent_id uuid) returns numeric
language sql stable set search_path='' as $$
  select coalesce((select ceiling from public.capital_plans where owner_id=p_owner_id),0)
    + coalesce((select sum(realized_pnl) from public.live_positions where owner_id=p_owner_id),0)
    - coalesce((select sum(cost) from public.live_positions where owner_id=p_owner_id),0)
    - coalesce((select sum(reserved_cash) from public.live_orders where owner_id=p_owner_id
        and side='BUY' and status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','UNKNOWN')),0)
$$;

-- Deposits go to the pot; every working agent can draw on it (allocation is kept only as a record).
create or replace function atlas_private.register_deposit(p_owner_id uuid, p_amount numeric, p_allocation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tx uuid := gen_random_uuid(); v_ceiling numeric;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount,2)
    or p_allocation is null or jsonb_typeof(p_allocation) <> 'array' then
    raise exception 'ATLAS_INVALID_DEPOSIT'; end if;
  perform 1 from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  insert into public.capital_plans(owner_id, ceiling) values(p_owner_id, p_amount)
    on conflict(owner_id) do update set ceiling=public.capital_plans.ceiling+p_amount, updated_at=now()
    returning ceiling into v_ceiling;
  update public.agents set budget=v_ceiling, real_budget=v_ceiling, updated_at=now()
    where owner_id=p_owner_id and status not in ('DEAD','FIRED');
  update public.paper_accounts set cash=cash+p_amount, initial_cash=initial_cash+p_amount,
    max_order_value=least(max_order_value+p_amount, initial_cash+p_amount), max_exposure=least(max_exposure+p_amount, initial_cash+p_amount),
    updated_at=now() where owner_id=p_owner_id;
  insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
    values(p_owner_id,v_tx,'CASH',p_amount),(p_owner_id,v_tx,'OPENING_EQUITY',-p_amount);
  insert into public.real_deposits(owner_id, amount, allocation) values(p_owner_id, p_amount, '[]'::jsonb);
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'OWNER','REAL_DEPOSIT_REGISTERED','capital',p_owner_id::text,
      jsonb_build_object('amount',p_amount::text,'pot',v_ceiling::text));
  return jsonb_build_object('amount',p_amount,'pot',v_ceiling);
end $$;

-- The R$ 50 already deposited becomes the pot for the whole team.
update public.agents a set budget=c.ceiling, real_budget=c.ceiling, updated_at=now()
  from public.capital_plans c where c.owner_id=a.owner_id and a.status not in ('DEAD','FIRED');

-- Marker for this change (guard for the migration runner).
create table public.boss_pool_marker (applied_at timestamptz not null default now());
alter table public.boss_pool_marker enable row level security;
revoke all on public.boss_pool_marker from public,anon,authenticated,service_role;
insert into public.boss_pool_marker default values;

commit;
