-- Paper autopilot and agent survival. Still a separate virtual book: nothing here touches
-- broker accounts, real orders, executor commands or the real ledger.
-- Autopilot proposals go through the same paper_review_proposal risk checks as manual ones.
begin;

alter table public.paper_accounts
  add column autopilot boolean not null default false,
  add column agent_max_loss_pct numeric(5,2) not null default 20
    check(agent_max_loss_pct > 0 and agent_max_loss_pct <= 100);

alter table public.paper_events drop constraint paper_events_event_check;
alter table public.paper_events add constraint paper_events_event_check check(event in (
  'ACCOUNT_OPENED','PROPOSED','RISK_APPROVED','RISK_REJECTED','ORDER_OPENED','ORDER_FILLED',
  'ORDER_CANCELLED','ORDER_EXPIRED','PAUSED','RESUMED','AUTOPILOT_CHANGED','AGENT_ELIMINATED'));

-- Latest virtual "life" of each agent. Life is the share of the agent's allowed loss
-- (budget × agent_max_loss_pct) not yet consumed; gains never push it above 100.
create table public.paper_agent_vitals (
  owner_id uuid not null references auth.users(id),
  agent_id uuid not null,
  budget numeric(20,2) not null check(budget >= 0),
  realized_pnl numeric(20,2) not null,
  unrealized_pnl numeric(20,2) not null,
  mark_price numeric(20,2) not null check(mark_price > 0),
  mark_source text not null check(mark_source like 'https://%'),
  mark_timestamp timestamptz not null,
  life_pct numeric(5,2) not null check(life_pct between 0 and 100),
  eliminated boolean not null default false,
  checked_at timestamptz not null default now(),
  primary key(owner_id,agent_id),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id)
);
alter table public.paper_agent_vitals enable row level security;
revoke all on public.paper_agent_vitals from public,anon,authenticated,service_role;
grant select on public.paper_agent_vitals to authenticated,service_role;
create policy owner_aal2_select on public.paper_agent_vitals for select to authenticated
  using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()));

create function public.paper_set_autopilot(p_owner_id uuid,p_enabled boolean,p_agent_max_loss_pct numeric)
returns public.paper_accounts language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_account from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  if p_enabled is null or p_agent_max_loss_pct is null or p_agent_max_loss_pct <= 0 or
    p_agent_max_loss_pct > 100 or p_agent_max_loss_pct <> round(p_agent_max_loss_pct,2) then
    raise exception 'ATLAS_PAPER_INVALID_LIMITS';
  end if;
  update public.paper_accounts set autopilot=p_enabled,agent_max_loss_pct=p_agent_max_loss_pct,updated_at=now()
    where owner_id=p_owner_id returning * into v_account;
  insert into public.paper_events(owner_id,event,details) values(p_owner_id,'AUTOPILOT_CHANGED',
    jsonb_build_object('enabled',p_enabled,'agentMaxLossPct',p_agent_max_loss_pct,'simulation',true));
  return v_account;
end $$;

-- Marks one agent with an observed quote, records its life and eliminates it (status DEAD,
-- analysis disabled, open virtual orders cancelled) once its loss reaches the allowed share.
-- DEAD is permanent: update_agent_enabled already refuses to re-enable a retired agent.
-- Positions stay in the virtual book; nothing is liquidated automatically.
create function public.paper_mark_agent(p_owner_id uuid,p_agent_id uuid,p_price numeric,p_source text,p_quote_timestamp timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts; v_agent public.agents; v_order public.paper_orders;
  v_realized numeric; v_unrealized numeric; v_pnl numeric; v_allowed numeric; v_life numeric;
  v_dead boolean := false;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_account from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  select * into v_agent from public.agents where owner_id=p_owner_id and id=p_agent_id for update;
  if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
  if p_price is null or p_price <= 0 or p_price <> round(p_price,2) or p_source not like 'https://%' or
    p_quote_timestamp is null or p_quote_timestamp > now() or p_quote_timestamp < now()-interval '72 hours' then
    raise exception 'ATLAS_PAPER_QUOTE_INVALID';
  end if;
  select coalesce(sum(realized_pnl),0) into v_realized from public.paper_positions
    where owner_id=p_owner_id and agent_id=p_agent_id;
  select coalesce(sum(round(quantity*(p_price-average_cost),2)),0) into v_unrealized from public.paper_positions
    where owner_id=p_owner_id and agent_id=p_agent_id and asset_id=v_agent.asset_id and quantity > 0;
  v_pnl := v_realized + v_unrealized;
  v_allowed := round(v_agent.budget*v_account.agent_max_loss_pct/100,2);
  v_life := case when v_pnl >= 0 or v_allowed <= 0 then 100
    else greatest(0,round(100 - (-v_pnl)/v_allowed*100,2)) end;
  if v_allowed > 0 and -v_pnl >= v_allowed and v_agent.status not in ('FIRED','DEAD') then
    v_dead := true;
    update public.agents set enabled=false,status='DEAD',lease_token=null,lease_expires_at=null,updated_at=now()
      where id=p_agent_id;
    for v_order in select * from public.paper_orders where owner_id=p_owner_id and agent_id=p_agent_id and status='OPEN' for update loop
      update public.paper_orders set status='CANCELLED',closed_at=now() where id=v_order.id;
      update public.paper_accounts set reserved_cash=reserved_cash-v_order.reserved_cash,updated_at=now() where owner_id=p_owner_id;
      insert into public.paper_events(owner_id,proposal_id,order_id,event,details)
        values(p_owner_id,v_order.proposal_id,v_order.id,'ORDER_CANCELLED',jsonb_build_object('reason','AGENT_ELIMINATED'));
    end loop;
    insert into public.paper_events(owner_id,event,details) values(p_owner_id,'AGENT_ELIMINATED',
      jsonb_build_object('agentId',p_agent_id,'pnl',v_pnl,'allowedLoss',v_allowed,'markPrice',p_price,
        'quoteTimestamp',p_quote_timestamp,'simulation',true));
    insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
      values(p_owner_id,'SYSTEM','AGENT_ELIMINATED_BY_PAPER_LOSS','agent',p_agent_id::text,
        jsonb_build_object('pnl',v_pnl::text,'allowedLoss',v_allowed::text,'simulation',true));
  end if;
  insert into public.paper_agent_vitals(owner_id,agent_id,budget,realized_pnl,unrealized_pnl,mark_price,mark_source,
    mark_timestamp,life_pct,eliminated,checked_at)
  values(p_owner_id,p_agent_id,v_agent.budget,v_realized,v_unrealized,p_price,p_source,p_quote_timestamp,v_life,
    v_dead or v_agent.status='DEAD',now())
  on conflict(owner_id,agent_id) do update set budget=excluded.budget,realized_pnl=excluded.realized_pnl,
    unrealized_pnl=excluded.unrealized_pnl,mark_price=excluded.mark_price,mark_source=excluded.mark_source,
    mark_timestamp=excluded.mark_timestamp,life_pct=excluded.life_pct,
    eliminated=public.paper_agent_vitals.eliminated or excluded.eliminated,checked_at=excluded.checked_at;
  return jsonb_build_object('lifePct',v_life,'pnl',v_pnl,'eliminated',v_dead,'simulation',true);
end $$;

revoke all on function public.paper_set_autopilot(uuid,boolean,numeric) from public,anon,authenticated,service_role;
grant execute on function public.paper_set_autopilot(uuid,boolean,numeric) to service_role;
revoke all on function public.paper_mark_agent(uuid,uuid,numeric,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.paper_mark_agent(uuid,uuid,numeric,text,timestamptz) to service_role;
commit;
