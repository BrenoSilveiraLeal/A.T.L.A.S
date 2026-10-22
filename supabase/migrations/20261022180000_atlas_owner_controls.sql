-- Owner controls: per-agent autopilot, the real-money ceiling ATLAS may use at the broker,
-- and withdrawal preparation. ATLAS never moves money: deposits and withdrawals happen in
-- the broker's own app; here they only change what agents are allowed to use.
begin;

-- Effective autopilot = paper account switch AND this per-agent switch.
alter table public.agents add column autopilot boolean not null default true;

create function public.set_agent_autopilot(p_owner_id uuid,p_agent_id uuid,p_enabled boolean)
returns public.agents language plpgsql security definer set search_path='' as $$
declare v_agent public.agents;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_enabled is null then raise exception 'ATLAS_INVALID_STATE'; end if;
  update public.agents set autopilot=p_enabled,updated_at=now() where id=p_agent_id and owner_id=p_owner_id returning * into v_agent;
  if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','AGENT_AUTOPILOT_CHANGED','agent',p_agent_id::text,jsonb_build_object('enabled',p_enabled));
  return v_agent;
end $$;

-- Owner-declared ceiling of real money ATLAS may commit at the broker. Zero blocks real buys.
create table public.capital_plans (
  owner_id uuid primary key references auth.users(id),
  ceiling numeric(20,2) not null default 0 check(ceiling >= 0 and ceiling <= 100000000),
  updated_at timestamptz not null default now()
);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  amount numeric(20,2) not null check(amount > 0 and amount <= 100000000),
  status text not null default 'PREPARING' check(status in ('PREPARING','READY','DONE','CANCELLED')),
  note text check(note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  closed_at timestamptz
);
create index withdrawal_requests_open on public.withdrawal_requests(owner_id) where status in ('PREPARING','READY');

do $$ declare t text; begin
  foreach t in array array['capital_plans','withdrawal_requests'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('create policy owner_aal2_select on public.%I for select to authenticated using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()))',t);
  end loop;
end $$;

create function public.set_capital_ceiling(p_owner_id uuid,p_ceiling numeric)
returns public.capital_plans language plpgsql security definer set search_path='' as $$
declare v_plan public.capital_plans;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_ceiling is null or p_ceiling < 0 or p_ceiling > 100000000 or p_ceiling <> round(p_ceiling,2) then
    raise exception 'ATLAS_INVALID_CAPITAL';
  end if;
  insert into public.capital_plans(owner_id,ceiling) values(p_owner_id,p_ceiling)
  on conflict(owner_id) do update set ceiling=excluded.ceiling,updated_at=now() returning * into v_plan;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','CAPITAL_CEILING_CHANGED','capital_plan',p_owner_id::text,jsonb_build_object('ceiling',p_ceiling::text));
  return v_plan;
end $$;

-- A withdrawal request immediately reserves the amount: agents can no longer use it.
-- READY means the broker shows enough free cash; DONE is set by the owner after the
-- transfer in the broker app. ATLAS itself never transfers money.
create function public.request_withdrawal(p_owner_id uuid,p_amount numeric,p_note text)
returns public.withdrawal_requests language plpgsql security definer set search_path='' as $$
declare v_request public.withdrawal_requests;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 or p_amount <> round(p_amount,2) then
    raise exception 'ATLAS_INVALID_WITHDRAWAL';
  end if;
  insert into public.withdrawal_requests(owner_id,amount,note) values(p_owner_id,p_amount,nullif(trim(coalesce(p_note,'')),''))
  returning * into v_request;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','WITHDRAWAL_REQUESTED','withdrawal',v_request.id::text,jsonb_build_object('amount',p_amount::text));
  return v_request;
end $$;

create function public.update_withdrawal(p_owner_id uuid,p_id uuid,p_status text)
returns public.withdrawal_requests language plpgsql security definer set search_path='' as $$
declare v_request public.withdrawal_requests;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_request from public.withdrawal_requests where id=p_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_WITHDRAWAL_NOT_FOUND'; end if;
  if not ((v_request.status='PREPARING' and p_status in ('READY','CANCELLED')) or
          (v_request.status='READY' and p_status in ('DONE','CANCELLED','PREPARING'))) then
    raise exception 'ATLAS_INVALID_WITHDRAWAL_TRANSITION';
  end if;
  update public.withdrawal_requests set status=p_status,
    ready_at=case when p_status='READY' then now() else ready_at end,
    closed_at=case when p_status in ('DONE','CANCELLED') then now() else null end
  where id=p_id returning * into v_request;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','WITHDRAWAL_'||p_status,'withdrawal',p_id::text,jsonb_build_object('amount',v_request.amount::text));
  return v_request;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.set_agent_autopilot(uuid,uuid,boolean)','public.set_capital_ceiling(uuid,numeric)',
    'public.request_withdrawal(uuid,numeric,text)','public.update_withdrawal(uuid,uuid,text)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
