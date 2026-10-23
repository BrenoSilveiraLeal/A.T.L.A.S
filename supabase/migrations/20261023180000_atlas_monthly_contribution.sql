-- Monthly contribution ("aporte mensal"). The owner sets how much goes in each month; the
-- IA gestora splits it among living agents (or keeps it in reserve) and, in the simulation,
-- the money enters the virtual account once per month as new capital (not as profit).
-- Real money still moves only by the owner's own transfer in the broker app.
begin;

alter table public.paper_events drop constraint paper_events_event_check;
alter table public.paper_events add constraint paper_events_event_check check(event in (
  'ACCOUNT_OPENED','PROPOSED','RISK_APPROVED','RISK_REJECTED','ORDER_OPENED','ORDER_FILLED',
  'ORDER_CANCELLED','ORDER_EXPIRED','PAUSED','RESUMED','AUTOPILOT_CHANGED','AGENT_ELIMINATED','CORPORATE_ACTION','CONTRIBUTION'));

create table public.contribution_plans (
  owner_id uuid primary key references auth.users(id),
  monthly_amount numeric(12,2) not null default 0 check(monthly_amount >= 0 and monthly_amount <= 100000),
  day smallint not null default 5 check(day between 1 and 28),
  updated_at timestamptz not null default now()
);

create table public.contributions (
  owner_id uuid not null references auth.users(id),
  month text not null check(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric(12,2) not null check(amount > 0 and amount <= 100000),
  reserve numeric(12,2) not null check(reserve >= 0),
  allocation jsonb not null check(jsonb_typeof(allocation) = 'array'),
  created_at timestamptz not null default now(),
  primary key(owner_id, month)
);

do $$ declare t text; begin
  foreach t in array array['contribution_plans','contributions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('create policy owner_aal2_select on public.%I for select to authenticated using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()))',t);
  end loop;
end $$;

create function public.set_contribution_plan(p_owner_id uuid,p_amount numeric,p_day integer)
returns public.contribution_plans language plpgsql security definer set search_path='' as $$
declare v_plan public.contribution_plans;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_amount is null or p_amount < 0 or p_amount > 100000 or p_amount <> round(p_amount,2) or p_day is null or p_day not between 1 and 28 then
    raise exception 'ATLAS_INVALID_CONTRIBUTION_PLAN'; end if;
  insert into public.contribution_plans(owner_id,monthly_amount,day) values(p_owner_id,p_amount,p_day)
    on conflict(owner_id) do update set monthly_amount=excluded.monthly_amount,day=excluded.day,updated_at=now()
    returning * into v_plan;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','CONTRIBUTION_PLAN_CHANGED','contribution_plan',p_owner_id::text,jsonb_build_object('amount',p_amount::text,'day',p_day));
  return v_plan;
end $$;

-- p_allocation: [{"agentId": uuid, "amount": "80.00"}]; the rest of p_amount is the reserve.
-- One contribution per month (idempotent); only living agents receive budget.
create function public.apply_contribution(p_owner_id uuid,p_month text,p_amount numeric,p_allocation jsonb)
returns public.contributions language plpgsql security definer set search_path='' as $$
declare v_row public.contributions; v_item jsonb; v_part numeric; v_sum numeric := 0; v_agent public.agents; v_tx uuid := gen_random_uuid();
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_row from public.contributions where owner_id=p_owner_id and month=p_month;
  if found then return v_row; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 or p_amount <> round(p_amount,2) or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or p_allocation is null or jsonb_typeof(p_allocation) <> 'array' or jsonb_array_length(p_allocation) > 100 then
    raise exception 'ATLAS_INVALID_CONTRIBUTION'; end if;
  perform 1 from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  for v_item in select value from jsonb_array_elements(p_allocation) loop
    v_part := (v_item->>'amount')::numeric;
    if v_part is null or v_part <= 0 or v_part <> round(v_part,2) then raise exception 'ATLAS_INVALID_CONTRIBUTION'; end if;
    select * into v_agent from public.agents where id=(v_item->>'agentId')::uuid and owner_id=p_owner_id for update;
    if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
    if v_agent.status in ('DEAD','FIRED') then raise exception 'ATLAS_AGENT_ELIMINATED'; end if;
    update public.agents set budget=budget+v_part,updated_at=now() where id=v_agent.id;
    v_sum := v_sum + v_part;
  end loop;
  if v_sum > p_amount then raise exception 'ATLAS_CONTRIBUTION_OVERALLOCATED'; end if;
  update public.paper_accounts set cash=cash+p_amount,initial_cash=initial_cash+p_amount,updated_at=now() where owner_id=p_owner_id;
  insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
  values(p_owner_id,v_tx,'CASH',p_amount),(p_owner_id,v_tx,'OPENING_EQUITY',-p_amount);
  insert into public.contributions(owner_id,month,amount,reserve,allocation)
  values(p_owner_id,p_month,p_amount,p_amount-v_sum,p_allocation) returning * into v_row;
  insert into public.paper_events(owner_id,event,details)
  values(p_owner_id,'CONTRIBUTION',jsonb_build_object('month',p_month,'amount',p_amount::text,'reserve',(p_amount-v_sum)::text,'simulation',true));
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'ATLAS','CONTRIBUTION_APPLIED','contribution',p_month,jsonb_build_object('amount',p_amount::text,'allocation',p_allocation));
  return v_row;
end $$;

revoke all on function public.set_contribution_plan(uuid,numeric,integer) from public,anon,authenticated,service_role;
revoke all on function public.apply_contribution(uuid,text,numeric,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.set_contribution_plan(uuid,numeric,integer) to service_role;
grant execute on function public.apply_contribution(uuid,text,numeric,jsonb) to service_role;
commit;
