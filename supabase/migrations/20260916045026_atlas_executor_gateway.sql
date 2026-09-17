-- The terminal is an execution gateway. Risk, OMS, reservations and accounting stay in ATLAS.
begin;

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check(status in
 ('CREATED','RISK_REVIEW','APPROVED','SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED',
  'PARTIALLY_FILLED','FILLED','CANCEL_REQUESTED','CANCELLED','REJECTED','EXPIRED','ERROR'));
alter table public.orders add column executor_stock_reserved public.atlas_decimal not null default 0 check(executor_stock_reserved>=0);

create table public.executor_order_states (
  order_id uuid primary key, owner_id uuid not null references auth.users(id),
  state jsonb not null check(jsonb_typeof(state)='object'),
  version integer not null check(version>=0), updated_at timestamptz not null default now(),
  foreign key(order_id,owner_id) references public.orders(id,owner_id),
  check(state->>'id'=order_id::text), check((state->>'version')::integer=version)
);
create table public.executor_commands (
  id uuid primary key, owner_id uuid not null references auth.users(id), order_id uuid not null,
  broker_account_id uuid not null, provider_id text not null, idempotency_key text not null,
  kind text not null check(kind in ('SUBMIT','CANCEL','MODIFY')),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  status text not null default 'PENDING' check(status in ('PENDING','DISPATCHED','ACKNOWLEDGED','UNKNOWN','REJECTED')),
  claim_token uuid, executor_id text, dispatched_at timestamptz, completed_at timestamptz,
  result jsonb, created_at timestamptz not null default now(),
  foreign key(order_id,owner_id) references public.orders(id,owner_id),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id),
  unique(broker_account_id,provider_id,idempotency_key),
  check((status='PENDING')=(claim_token is null)),
  check(payload->>'id'=id::text), check(payload->>'kind'=kind),
  check(payload->>'providerId'=provider_id), check(payload->>'idempotencyKey'=idempotency_key)
);
create unique index executor_one_unresolved_per_order on public.executor_commands(order_id)
  where status in ('PENDING','DISPATCHED','UNKNOWN');
create index executor_commands_due on public.executor_commands(owner_id,status,created_at);
create table public.executor_ledger_states (
  owner_id uuid not null references auth.users(id), broker_account_id uuid not null,
  agent_id uuid not null, asset_id uuid not null, state jsonb not null,
  version integer not null default 0 check(version>=0),
  cash_account_id uuid not null, invested_account_id uuid not null, clearing_account_id uuid not null,
  primary key(broker_account_id,agent_id,asset_id),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  foreign key(cash_account_id,owner_id) references public.ledger_accounts(id,owner_id),
  foreign key(invested_account_id,owner_id) references public.ledger_accounts(id,owner_id),
  foreign key(clearing_account_id,owner_id) references public.ledger_accounts(id,owner_id),
  check(jsonb_typeof(state)='object')
);
-- Raw immutable evidence survives a reducer/accounting failure; never manufacture a fill.
create table public.executor_observations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  broker_account_id uuid not null, event_key text not null, kind text not null,
  payload jsonb not null, received_at timestamptz not null default now(),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id),
  unique(broker_account_id,event_key), check(length(event_key) between 1 and 240),
  check(kind in ('EXECUTION','ACCOUNT','RECONCILIATION','GATEWAY_ERROR'))
);
create table public.executor_sync (
  broker_account_id uuid primary key, owner_id uuid not null references auth.users(id),
  cursor text check(length(cursor)<=1000), history_complete boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id)
);
create trigger executor_observations_immutable before update or delete on public.executor_observations
  for each row execute function atlas_private.reject_mutation();

do $$ declare t text; begin
  foreach t in array array['executor_order_states','executor_commands','executor_ledger_states','executor_observations','executor_sync'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('create policy owner_aal2_select on public.%I for select to authenticated using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()))',t);
  end loop;
end $$;

create function atlas_private.executor_command_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if new.id<>old.id or new.owner_id<>old.owner_id or new.order_id<>old.order_id or
    new.broker_account_id<>old.broker_account_id or new.provider_id<>old.provider_id or
    new.idempotency_key<>old.idempotency_key or new.kind<>old.kind or new.payload<>old.payload or
    (old.claim_token is not null and new.claim_token is distinct from old.claim_token) or
    (old.status<>'PENDING' and new.status='PENDING') then raise exception 'ATLAS_COMMAND_IMMUTABLE'; end if;
  return new;
end $$;
create trigger executor_command_immutable before update on public.executor_commands
  for each row execute function atlas_private.executor_command_immutable();

-- Match decimal.js ROUND_HALF_EVEN used by the OMS (Postgres round uses ties away from zero).
create function atlas_private.executor_round8(p_value numeric) returns numeric
language sql immutable strict set search_path='' as $$
  select case when abs(p_value*100000000-trunc(p_value*100000000))=0.5 and mod(abs(trunc(p_value*100000000)),2)=0
    then trunc(p_value*100000000)/100000000 else round(p_value,8) end;
$$;

-- Called only by the trusted backend after Central Risk and OMS have approved the exact terms.
create function public.enqueue_executor_command(p_owner_id uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.orders; b public.broker_accounts; p public.trade_proposals; s public.system_state;
  a public.assets; c public.executor_commands; v_state jsonb; v_proposal jsonb;
  v_cash public.ledger_accounts; v_required numeric; v_committed numeric; v_position public.positions;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into s from public.system_state where owner_id=p_owner_id for update;
  select * into strict o from public.orders where id=(p_command#>>'{order,id}')::uuid and owner_id=p_owner_id for update;
  select * into strict b from public.broker_accounts where id=o.broker_account_id and owner_id=p_owner_id;
  select * into c from public.executor_commands where broker_account_id=b.id and provider_id=p_command->>'providerId' and idempotency_key=p_command->>'idempotencyKey';
  if found then
    if c.payload<>p_command then raise exception 'ATLAS_IDEMPOTENCY_CONFLICT'; end if;
    return c.id;
  end if;
  if jsonb_typeof(p_command)<>'object' or p_command->>'kind' not in ('SUBMIT','CANCEL','MODIFY') or
     b.provider is distinct from p_command->>'providerId' or b.external_account_id is distinct from p_command->>'accountId' or
     p_command#>>'{order,accountId}' is distinct from b.external_account_id or
     p_command#>>'{order,clientOrderId}' is distinct from o.client_order_id or
     p_command#>>'{order,proposal,agentId}' is distinct from o.agent_id::text or
     p_command#>>'{riskContext,ownerMfaVerified}' is distinct from 'true' then raise exception 'ATLAS_COMMAND_IDENTITY_REQUIRED'; end if;
  select * into strict a from public.assets where id=o.asset_id and owner_id=p_owner_id;
  if p_command#>>'{order,proposal,symbol}' is distinct from a.ticker or
     p_command#>>'{order,proposal,side}' is distinct from o.side then raise exception 'ATLAS_COMMAND_TERMS_MISMATCH'; end if;
  select state into v_state from public.executor_order_states where order_id=o.id;
  if found and v_state<>p_command->'order' then raise exception 'ATLAS_ORDER_VERSION_CONFLICT'; end if;
  if p_command->>'kind'='SUBMIT' and (o.status<>'APPROVED' or o.broker_order_id is not null or
     p_command#>>'{order,state}' is distinct from 'APPROVED' or
     p_command->>'idempotencyKey' is distinct from o.client_order_id or
     (p_command#>>'{order,filledQuantity}')::numeric<>0 or o.filled_quantity<>0) then raise exception 'ATLAS_APPROVED_ORDER_REQUIRED'; end if;
  if p_command->>'kind'<>'SUBMIT' and (o.status not in ('SUBMITTED','PARTIALLY_FILLED') or (p_command->>'kind'<>'CANCEL' and o.reconciliation_required) or
     p_command#>>'{order,brokerOrderId}' is distinct from o.broker_order_id or v_state is null) then raise exception 'ATLAS_OPEN_RECONCILED_ORDER_REQUIRED'; end if;
  if p_command->>'kind'<>'CANCEL' then
    if not s.live_trading_enabled or s.global_kill_switch or b.connection_status<>'CONNECTED' or
       b.reconciled_at is null or b.reconciled_at<clock_timestamp()-interval '60 seconds' then raise exception 'ATLAS_EXECUTION_DISABLED'; end if;
    select * into strict p from public.trade_proposals where id=o.proposal_id and owner_id=p_owner_id;
    if not exists(select 1 from public.agents g join public.risk_profiles rp on rp.id=g.risk_profile_id and rp.owner_id=g.owner_id
      where g.id=o.agent_id and g.owner_id=p_owner_id and rp.configured and rp.version=p.risk_profile_version and rp.limits=p_command#>'{riskContext,limits}') then raise exception 'ATLAS_RISK_PROFILE_VERSION_REQUIRED'; end if;
    v_proposal:=case when p_command->>'kind'='MODIFY' then p_command->'replacementProposal' else p_command#>'{order,proposal}' end;
    if p.risk_status<>'APPROVED' or p.risk_result->>'approved' is distinct from 'true' or
       p.expires_at is null or p.expires_at<=clock_timestamp() or p.approved_at is null or
       v_proposal->>'id' is distinct from p.id::text or
       v_proposal->>'agentId' is distinct from p.agent_id::text or v_proposal->>'symbol' is distinct from a.ticker or
       v_proposal->>'side' is distinct from p.side or v_proposal->>'kind' is distinct from p.order_type or
       (v_proposal->>'quantity')::numeric is distinct from p.quantity or
       (v_proposal->>'limitPrice')::numeric is distinct from p.limit_price or
       (v_proposal->>'stopPrice')::numeric is distinct from p.stop_price then raise exception 'ATLAS_RISK_APPROVAL_REQUIRED'; end if;
    if p_command->>'kind'='SUBMIT' and (o.quantity<>p.quantity or o.order_type<>p.order_type or o.side<>p.side or
       o.limit_price is distinct from p.limit_price or o.stop_price is distinct from p.stop_price) then raise exception 'ATLAS_COMMAND_TERMS_MISMATCH'; end if;
    -- Treasury lock: an approval alone cannot spend funds already reserved by another agent/order.
    select * into strict v_cash from public.ledger_accounts where owner_id=p_owner_id and agent_id=o.agent_id and kind='AGENT_CASH' for update;
    if p.side='BUY' then
      v_required:=(p.risk_result->>'estimatedDebit')::numeric;
      if v_required is null or v_required<=0 then raise exception 'ATLAS_RISK_DEBIT_REQUIRED'; end if;
      select coalesce(sum(amount),0) into v_committed from public.order_reservations where account_id=v_cash.id and released_at is null and order_id<>o.id;
      if v_cash.balance-v_committed<v_required then raise exception 'ATLAS_INSUFFICIENT_UNRESERVED_CASH'; end if;
      insert into public.order_reservations(owner_id,order_id,account_id,amount) values(p_owner_id,o.id,v_cash.id,v_required)
        on conflict(order_id,account_id) do update set amount=greatest(public.order_reservations.amount,excluded.amount),released_at=null;
    else
      select * into strict v_position from public.positions where broker_account_id=b.id and agent_id=o.agent_id and asset_id=o.asset_id for update;
      if p_command->>'kind'='SUBMIT' then
        if v_position.quantity-v_position.reserved_quantity<p.quantity then raise exception 'ATLAS_INSUFFICIENT_UNRESERVED_STOCK'; end if;
        update public.positions set reserved_quantity=reserved_quantity+p.quantity where id=v_position.id;
        update public.orders set executor_stock_reserved=p.quantity where id=o.id;
      elsif p.quantity<>o.quantity then raise exception 'ATLAS_QUANTITY_MODIFICATION_UNSUPPORTED'; end if;
    end if;
  end if;
  if v_state is null then
    insert into public.executor_order_states(order_id,owner_id,state,version)
      values(o.id,p_owner_id,p_command->'order',(p_command#>>'{order,version}')::integer);
  end if;
  insert into public.executor_commands(id,owner_id,order_id,broker_account_id,provider_id,idempotency_key,kind,payload)
    values((p_command->>'id')::uuid,p_owner_id,o.id,b.id,b.provider,p_command->>'idempotencyKey',p_command->>'kind',p_command);
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,correlation_id,details)
    values(p_owner_id,'ATLAS_EXECUTOR','EXECUTOR_QUEUED','order',o.id::text,o.correlation_id,jsonb_build_object('commandId',p_command->>'id','kind',p_command->>'kind'));
  return (p_command->>'id')::uuid;
end $$;

create function public.claim_executor_command(p_owner_id uuid,p_command_id uuid,p_provider_id text,p_executor_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.executor_commands; o public.orders; s public.system_state; v_state jsonb; v_token uuid:=gen_random_uuid(); v_time timestamptz:=clock_timestamp();
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into s from public.system_state where owner_id=p_owner_id for update;
  select * into c from public.executor_commands where id=p_command_id and owner_id=p_owner_id and provider_id=p_provider_id for update;
  if not found or c.status<>'PENDING' then return null; end if;
  select * into strict o from public.orders where id=c.order_id and owner_id=p_owner_id for update;
  if c.kind<>'CANCEL' and (s.global_kill_switch or not s.live_trading_enabled or o.reconciliation_required) then return null; end if;
  select state into strict v_state from public.executor_order_states where order_id=o.id for update;
  if v_state<>c.payload->'order' then raise exception 'ATLAS_ORDER_VERSION_CONFLICT'; end if;
  if c.kind<>'CANCEL' and not exists(select 1 from public.trade_proposals where id=o.proposal_id and owner_id=p_owner_id
      and risk_status='APPROVED' and expires_at>v_time and risk_result->>'approved'='true') then return null; end if;
  if c.kind<>'CANCEL' then
    if not exists(select 1 from public.broker_accounts where id=o.broker_account_id and owner_id=p_owner_id and connection_status='CONNECTED' and reconciled_at>=v_time-interval '60 seconds') then return null; end if;
    if not exists(select 1 from public.trade_proposals p join public.agents g on g.id=p.agent_id and g.owner_id=p.owner_id
      join public.risk_profiles rp on rp.id=g.risk_profile_id and rp.owner_id=g.owner_id
      where p.id=o.proposal_id and rp.configured and rp.version=p.risk_profile_version and rp.limits=c.payload#>'{riskContext,limits}') then return null; end if;
    if o.side='BUY' and not exists(select 1 from public.order_reservations r join public.ledger_accounts l on l.id=r.account_id and l.owner_id=r.owner_id
      join public.trade_proposals p on p.id=o.proposal_id and p.owner_id=r.owner_id where r.order_id=o.id and r.owner_id=p_owner_id and r.released_at is null
      and r.amount>=(p.risk_result->>'estimatedDebit')::numeric and l.balance>=(select sum(amount) from public.order_reservations where account_id=l.id and released_at is null)) then return null; end if;
    if o.side='SELL' and not exists(select 1 from public.positions where broker_account_id=o.broker_account_id and agent_id=o.agent_id and asset_id=o.asset_id
      and reserved_quantity>=o.quantity-o.filled_quantity and quantity>=reserved_quantity) then return null; end if;
  end if;
  if c.kind='SUBMIT' and o.status<>'APPROVED' then return null; end if;
  if c.kind<>'SUBMIT' and o.status not in ('SUBMITTED','PARTIALLY_FILLED') then return null; end if;
  update public.executor_commands set status='DISPATCHED',claim_token=v_token,executor_id=p_executor_id,dispatched_at=v_time where id=c.id;
  update public.orders set status=case when c.kind='SUBMIT' then 'SUBMITTING' when c.kind='CANCEL' then 'CANCEL_REQUESTED' else status end,
    reconciliation_required=true,updated_at=v_time where id=o.id;
  insert into public.order_events(owner_id,order_id,event_key,event_type,payload,source)
    values(p_owner_id,o.id,'dispatch:'||c.id,'DISPATCHED',jsonb_build_object('commandId',c.id,'kind',c.kind),'ATLAS_EXECUTOR');
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,correlation_id,details)
    values(p_owner_id,'ATLAS_EXECUTOR','EXECUTOR_DISPATCHED','order',o.id::text,o.correlation_id,jsonb_build_object('commandId',c.id));
  return jsonb_build_object('command',c.payload,'claimToken',v_token,'claimedAt',v_time);
end $$;

create function public.complete_executor_command(p_owner_id uuid,p_completion jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.executor_commands; o public.orders; v_state public.executor_order_states; v_next jsonb:=p_completion->'order';
begin
  perform atlas_private.require_owner(p_owner_id);
  perform 1 from public.system_state where owner_id=p_owner_id for update;
  select * into strict o from public.orders where id=(v_next->>'id')::uuid and owner_id=p_owner_id for update;
  select * into c from public.executor_commands where id=(p_completion->>'commandId')::uuid and owner_id=p_owner_id and order_id=o.id for update;
  if not found or c.status='PENDING' or c.claim_token is distinct from (p_completion->>'claimToken')::uuid then return false; end if;
  if exists(select 1 from public.executor_commands where order_id=o.id and id<>c.id and created_at>=c.created_at
    and status in ('PENDING','DISPATCHED','UNKNOWN')) then return false; end if;
  select * into strict v_state from public.executor_order_states where order_id=o.id for update;
  if v_state.version<>(p_completion->>'expectedOrderVersion')::integer then return false; end if;
  if p_completion->>'status' not in ('ACKNOWLEDGED','UNKNOWN','REJECTED') or
    v_next->>'accountId' is distinct from v_state.state->>'accountId' or v_next->>'clientOrderId' is distinct from o.client_order_id or
    v_next#>>'{proposal,agentId}' is distinct from o.agent_id::text or
    (v_next->>'version')::integer<v_state.version or (v_next->>'version')::integer>v_state.version+3 or
    (v_next->>'filledQuantity')::numeric is distinct from o.filled_quantity or
    v_next->>'filledNotional' is distinct from v_state.state->>'filledNotional' or v_next->>'fees' is distinct from v_state.state->>'fees' or
    (o.broker_order_id is not null and v_next->>'brokerOrderId' is distinct from o.broker_order_id) or
    v_next->'executions' is distinct from v_state.state->'executions' then raise exception 'ATLAS_INVALID_COMMAND_COMPLETION'; end if;
  if v_next->>'state' is distinct from v_state.state->>'state' and (
    (v_next->>'version')::integer<=v_state.version or not (
      (v_state.state->>'state'='APPROVED' and v_next->>'state' in ('SUBMITTED','SUBMISSION_UNKNOWN','REJECTED','CANCELLED','EXPIRED')) or
      (v_state.state->>'state'='SUBMISSION_UNKNOWN' and v_next->>'state' in ('SUBMITTED','REJECTED','CANCELLED','EXPIRED')) or
      (v_state.state->>'state'='SUBMITTED' and v_next->>'state' in ('CANCEL_REQUESTED','CANCELLED','EXPIRED','REJECTED')) or
      (v_state.state->>'state' in ('PARTIALLY_FILLED','CANCEL_REQUESTED') and v_next->>'state' in ('CANCEL_REQUESTED','CANCELLED','EXPIRED'))
    )) then raise exception 'ATLAS_INVALID_ORDER_TRANSITION'; end if;
  if p_completion->>'status'='UNKNOWN' and p_completion->>'reconciliationRequired' is distinct from 'true' then raise exception 'ATLAS_RECONCILIATION_REQUIRED'; end if;
  if v_next->>'state' in ('SUBMITTED','PARTIALLY_FILLED','CANCEL_REQUESTED','FILLED') and v_next->>'brokerOrderId' is null then raise exception 'ATLAS_BROKER_ACK_REQUIRED'; end if;
  if c.status=p_completion->>'status' and v_state.state=v_next and o.reconciliation_required=(p_completion->>'reconciliationRequired')::boolean
    and c.result->'reasons'=p_completion->'reasons' then return true; end if;
  if c.kind<>'MODIFY' and v_next->'proposal' is distinct from v_state.state->'proposal' then raise exception 'ATLAS_COMMAND_TERMS_MISMATCH'; end if;
  if c.kind='MODIFY' and v_next->'proposal' is distinct from v_state.state->'proposal' and
     v_next->'proposal' is distinct from c.payload->'replacementProposal' then raise exception 'ATLAS_COMMAND_TERMS_MISMATCH'; end if;
  update public.executor_order_states set state=v_next,version=(v_next->>'version')::integer,updated_at=clock_timestamp() where order_id=o.id;
  update public.orders set status=v_next->>'state',broker_order_id=v_next->>'brokerOrderId',
    quantity=(v_next#>>'{proposal,quantity}')::numeric,limit_price=(v_next#>>'{proposal,limitPrice}')::numeric,stop_price=(v_next#>>'{proposal,stopPrice}')::numeric,
    reconciliation_required=coalesce((p_completion->>'reconciliationRequired')::boolean,true),
    submitted_at=case when v_next->>'brokerOrderId' is not null then coalesce(submitted_at,clock_timestamp()) else submitted_at end,updated_at=clock_timestamp() where id=o.id;
  update public.executor_commands set status=p_completion->>'status',result=p_completion,completed_at=clock_timestamp() where id=c.id;
  -- Keep reservations until independent order/fill/account reconciliation confirms the terminal outcome.
  insert into public.order_events(owner_id,order_id,event_key,event_type,payload,source)
    values(p_owner_id,o.id,'complete:'||c.id||':'||(v_next->>'version')||':'||(p_completion->>'status'),p_completion->>'status',p_completion,'ATLAS_EXECUTOR') on conflict do nothing;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,correlation_id,details)
    values(p_owner_id,'ATLAS_EXECUTOR','EXECUTOR_'||(p_completion->>'status'),'order',o.id::text,o.correlation_id,jsonb_build_object('commandId',c.id,'reasons',p_completion->'reasons'));
  return true;
end $$;

create function public.register_execution_gateway(p_owner_id uuid,p_provider text,p_account jsonb,p_capabilities jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform atlas_private.require_owner(p_owner_id);
  perform 1 from public.system_state where owner_id=p_owner_id for update;
  if coalesce(length(p_provider),0) not between 1 and 100 or coalesce(length(p_account->>'accountId'),0) not between 1 and 200 or
    p_account->>'currency' is distinct from 'BRL' or p_account->>'mode' not in ('REAL','OFFICIAL_SANDBOX') or
    p_capabilities->>'providerId' is distinct from p_provider then raise exception 'ATLAS_GATEWAY_IDENTITY_REQUIRED'; end if;
  select id into v_id from public.broker_accounts where owner_id=p_owner_id and provider=p_provider and external_account_id=p_account->>'accountId';
  if found then return v_id; end if;
  insert into public.broker_accounts(owner_id,provider,external_account_id,connection_status,capabilities)
    values(p_owner_id,p_provider,p_account->>'accountId','PENDING',p_capabilities) returning id into v_id;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'ATLAS_EXECUTOR','GATEWAY_OBSERVED','broker_account',v_id::text,jsonb_build_object('provider',p_provider,'mode',p_account->>'mode','status','PENDING'));
  return v_id;
end $$;

create function public.record_executor_observation(p_owner_id uuid,p_broker_account_id uuid,p_event_key text,p_kind text,p_payload jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_existing jsonb;
begin
  perform atlas_private.require_owner(p_owner_id);
  perform 1 from public.system_state where owner_id=p_owner_id for update;
  perform 1 from public.broker_accounts where id=p_broker_account_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_BROKER_ACCOUNT_REQUIRED'; end if;
  select payload into v_existing from public.executor_observations where broker_account_id=p_broker_account_id and event_key=p_event_key;
  if found then
    if v_existing=p_payload then return true; end if;
    update public.system_state set live_trading_enabled=false,global_kill_switch=true,kill_switch_reason='Conflito em evidência do gateway.',updated_at=clock_timestamp() where owner_id=p_owner_id;
    insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
      values(p_owner_id,'ATLAS_EXECUTOR','EXECUTOR_EVIDENCE_CONFLICT','broker_account',p_broker_account_id::text,jsonb_build_object('eventKey',p_event_key));
    return false;
  end if;
  insert into public.executor_observations(owner_id,broker_account_id,event_key,kind,payload) values(p_owner_id,p_broker_account_id,p_event_key,p_kind,p_payload);
  return true;
end $$;

create function public.stage_executor_executions(p_owner_id uuid,p_broker_account_id uuid,p_expected_cursor text,p_next_cursor text,p_executions jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.broker_accounts; v_sync public.executor_sync; fill jsonb;
begin
  perform atlas_private.require_owner(p_owner_id);
  perform 1 from public.system_state where owner_id=p_owner_id for update;
  select * into strict b from public.broker_accounts where id=p_broker_account_id and owner_id=p_owner_id for update;
  if jsonb_typeof(p_executions) is distinct from 'array' or jsonb_array_length(p_executions)>500 then raise exception 'ATLAS_EXECUTION_PAGE_LIMIT'; end if;
  insert into public.executor_sync(broker_account_id,owner_id) values(b.id,p_owner_id) on conflict do nothing;
  select * into strict v_sync from public.executor_sync where broker_account_id=b.id for update;
  if v_sync.cursor is distinct from p_expected_cursor then return false; end if;
  if p_next_cursor is not null and (p_next_cursor=p_expected_cursor or jsonb_array_length(p_executions)=0) then raise exception 'ATLAS_NON_PROGRESSING_CURSOR'; end if;
  for fill in select value from jsonb_array_elements(p_executions) loop
    if fill->>'accountId' is distinct from b.external_account_id or coalesce(length(fill->>'executionId'),0) not between 1 and 200 then raise exception 'ATLAS_EXECUTION_IDENTITY_MISMATCH'; end if;
    if not public.record_executor_observation(p_owner_id,b.id,'execution:'||(fill->>'executionId'),'EXECUTION',fill) then return false; end if;
  end loop;
  update public.executor_sync set cursor=p_next_cursor,history_complete=p_next_cursor is null,updated_at=clock_timestamp() where broker_account_id=b.id;
  return true;
end $$;

create function public.executor_execution_backlog(p_owner_id uuid,p_broker_account_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_pending jsonb; v_count bigint; v_unverified bigint;
begin
  perform atlas_private.require_owner(p_owner_id);
  select count(*),count(*) filter(where obs.payload->>'feesVerified'='false') into v_count,v_unverified
    from public.executor_observations obs where obs.owner_id=p_owner_id and obs.broker_account_id=p_broker_account_id and obs.kind='EXECUTION'
    and not exists(select 1 from public.executions e where e.broker_account_id=obs.broker_account_id and e.broker_execution_id=obs.payload->>'executionId');
  select coalesce(jsonb_agg(payload order by received_at,id),'[]') into v_pending from (
    select obs.payload,obs.received_at,obs.id from public.executor_observations obs where obs.owner_id=p_owner_id and obs.broker_account_id=p_broker_account_id and obs.kind='EXECUTION'
      and obs.payload->>'feesVerified' is distinct from 'false'
      and not exists(select 1 from public.executions e where e.broker_account_id=obs.broker_account_id and e.broker_execution_id=obs.payload->>'executionId')
      order by obs.received_at,obs.id limit 5
  ) pending;
  return jsonb_build_object('pending',v_pending,'pendingCount',v_count,'unverifiedFeesCount',v_unverified);
end $$;

-- Internal accounting is initialized only from already reconciled, matching ledger evidence.
-- This function does NOT fund an account and does not interpret MT5 margin as available cash.
create function public.initialize_executor_ledger(p_owner_id uuid,p_order_id uuid,p_state jsonb,p_cash_account_id uuid,p_invested_account_id uuid,p_clearing_account_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; b public.broker_accounts; a public.assets; cash public.ledger_accounts; invested public.ledger_accounts; pos public.positions;
begin
  perform atlas_private.require_owner(p_owner_id);
  perform 1 from public.system_state where owner_id=p_owner_id for update;
  select * into strict o from public.orders where id=p_order_id and owner_id=p_owner_id for update;
  select * into strict b from public.broker_accounts where id=o.broker_account_id and owner_id=p_owner_id;
  select * into strict a from public.assets where id=o.asset_id and owner_id=p_owner_id;
  perform 1 from public.ledger_accounts where id in(p_cash_account_id,p_invested_account_id,p_clearing_account_id) order by id for update;
  select * into strict cash from public.ledger_accounts where id=p_cash_account_id and owner_id=p_owner_id and agent_id=o.agent_id and kind='AGENT_CASH';
  select * into strict invested from public.ledger_accounts where id=p_invested_account_id and owner_id=p_owner_id and agent_id=o.agent_id and kind='INVESTED';
  perform 1 from public.ledger_accounts where id=p_clearing_account_id and owner_id=p_owner_id and kind='EXTERNAL_CLEARING';
  if not found or b.reconciled_at is null or b.reconciled_at<clock_timestamp()-interval '60 seconds' then raise exception 'ATLAS_RECONCILED_ACCOUNT_REQUIRED'; end if;
  select * into pos from public.positions where broker_account_id=b.id and agent_id=o.agent_id and asset_id=o.asset_id;
  if p_state->>'accountId' is distinct from b.external_account_id or p_state->>'agentId' is distinct from o.agent_id::text or
    p_state->>'symbol' is distinct from a.ticker or (p_state->>'cash')::numeric is distinct from cash.balance or
    (p_state->>'costBasis')::numeric is distinct from invested.balance or
    (p_state->>'quantity')::numeric is distinct from coalesce(pos.quantity,0) or
    (pos.id is not null and (pos.reconciled_at<clock_timestamp()-interval '60 seconds' or pos.realized_pnl is null)) or
    (p_state->>'realizedPnl')::numeric is distinct from coalesce(pos.realized_pnl,0) or
    (p_state->>'totalFees')::numeric is distinct from (select coalesce(sum(e.fees),0) from public.executions e join public.orders q on q.id=e.order_id
      where q.agent_id=o.agent_id and q.asset_id=o.asset_id and q.broker_account_id=b.id) or
    exists(select 1 from public.executions e join public.orders q on q.id=e.order_id where q.agent_id=o.agent_id and q.broker_account_id=b.id and e.fees is null)
    then raise exception 'ATLAS_LEDGER_EVIDENCE_MISMATCH'; end if;
  insert into public.executor_ledger_states(owner_id,broker_account_id,agent_id,asset_id,state,cash_account_id,invested_account_id,clearing_account_id)
    values(p_owner_id,b.id,o.agent_id,o.asset_id,p_state,p_cash_account_id,p_invested_account_id,p_clearing_account_id);
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'ATLAS_EXECUTOR','EXECUTOR_LEDGER_INITIALIZED','order',o.id::text,'{}');
end $$;

create function public.commit_executor_execution(p_owner_id uuid,p_commit jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare o public.orders; b public.broker_accounts; os public.executor_order_states; ls public.executor_ledger_states;
  fill jsonb:=p_commit->'execution'; next_order jsonb:=p_commit->'order'; next_account jsonb:=p_commit->'account'; existing public.executions;
  v_cash_delta numeric; v_basis_delta numeric; v_expected_basis numeric; v_pnl numeric; v_lines jsonb:='[]'; v_quantity numeric; v_transaction uuid; v_event public.executor_observations;
begin
  perform atlas_private.require_owner(p_owner_id);
  perform 1 from public.system_state where owner_id=p_owner_id for update;
  select * into strict o from public.orders where id=(next_order->>'id')::uuid and owner_id=p_owner_id for update;
  select * into strict b from public.broker_accounts where id=o.broker_account_id and owner_id=p_owner_id;
  select * into strict os from public.executor_order_states where order_id=o.id for update;
  if p_commit->>'providerId' is distinct from b.provider or fill->>'accountId' is distinct from b.external_account_id or
    fill->>'brokerOrderId' is distinct from o.broker_order_id or fill->>'side' is distinct from o.side or
    fill->>'symbol' is distinct from os.state#>>'{proposal,symbol}' then raise exception 'ATLAS_EXECUTION_IDENTITY_MISMATCH'; end if;
  if fill->>'feesVerified'='false' then raise exception 'ATLAS_EXECUTION_FEES_UNVERIFIED'; end if;
  select * into existing from public.executions where broker_account_id=b.id and broker_execution_id=fill->>'executionId';
  if found then
    if existing.order_id=o.id and existing.quantity=(fill->>'quantity')::numeric and existing.price=(fill->>'price')::numeric and
      existing.fees=(fill->>'fees')::numeric and existing.executed_at=(fill->>'executedAt')::timestamptz then return 'DUPLICATE'; end if;
    return 'CONFLICT';
  end if;
  select * into strict ls from public.executor_ledger_states where broker_account_id=b.id and agent_id=o.agent_id and asset_id=o.asset_id for update;
  if os.version<>(p_commit->>'expectedOrderVersion')::integer or ls.version<>(p_commit->>'expectedLedgerVersion')::integer then return 'CONFLICT'; end if;
  perform 1 from public.ledger_accounts where id in(ls.cash_account_id,ls.invested_account_id,ls.clearing_account_id) order by id for update;
  if (select balance from public.ledger_accounts where id=ls.cash_account_id) is distinct from (ls.state->>'cash')::numeric or
    (select balance from public.ledger_accounts where id=ls.invested_account_id) is distinct from (ls.state->>'costBasis')::numeric then raise exception 'ATLAS_EXECUTOR_LEDGER_DIVERGED'; end if;
  select * into v_event from public.executor_observations where broker_account_id=b.id and event_key='execution:'||(fill->>'executionId') and kind='EXECUTION';
  if not found or v_event.payload<>fill then raise exception 'ATLAS_PERSISTED_EXECUTION_REQUIRED'; end if;
  if p_commit->>'providerId' is distinct from b.provider or fill->>'accountId' is distinct from b.external_account_id or
    fill->>'brokerOrderId' is distinct from o.broker_order_id or fill->>'side' is distinct from o.side or
    fill->>'symbol' is distinct from os.state#>>'{proposal,symbol}' or next_account->>'accountId' is distinct from b.external_account_id or
    next_account->>'agentId' is distinct from o.agent_id::text or next_account->>'symbol' is distinct from fill->>'symbol' or
    next_order->>'brokerOrderId' is distinct from o.broker_order_id or next_order->>'accountId' is distinct from b.external_account_id or
    next_order->>'clientOrderId' is distinct from o.client_order_id or next_order->'proposal' is distinct from os.state->'proposal' then raise exception 'ATLAS_EXECUTION_IDENTITY_MISMATCH'; end if;
  v_quantity:=(fill->>'quantity')::numeric;
  if v_quantity<=0 or trunc(v_quantity)<>v_quantity or (fill->>'price')::numeric<=0 or (fill->>'fees')::numeric is null or (fill->>'fees')::numeric<0 or
    (next_order->>'filledQuantity')::numeric<>o.filled_quantity+v_quantity or o.filled_quantity+v_quantity>o.quantity or
    (next_order->>'version')::integer<>os.version+1 or
    next_order->'executions' is distinct from ((os.state->'executions')||jsonb_build_array(fill)) or
    (fill->>'executedAt')::timestamptz>(p_commit->>'at')::timestamptz or
    (fill->>'executedAt')::timestamptz<(os.state#>>'{proposal,createdAt}')::timestamptz or
    o.status in ('CREATED','RISK_REVIEW','APPROVED','REJECTED','FILLED') then raise exception 'ATLAS_INVALID_EXECUTION'; end if;
  v_cash_delta:=case when o.side='BUY' then -v_quantity*(fill->>'price')::numeric-(fill->>'fees')::numeric else v_quantity*(fill->>'price')::numeric-(fill->>'fees')::numeric end;
  if (next_account->>'cash')::numeric<>(ls.state->>'cash')::numeric+v_cash_delta or
    (next_account->>'quantity')::numeric<>(ls.state->>'quantity')::numeric+(case when o.side='BUY' then v_quantity else -v_quantity end) then raise exception 'ATLAS_EXECUTION_ACCOUNTING_MISMATCH'; end if;
  v_basis_delta:=(next_account->>'costBasis')::numeric-(ls.state->>'costBasis')::numeric;
  if o.side='BUY' then v_expected_basis:=-v_cash_delta; v_pnl:=0;
  else
    if (ls.state->>'quantity')::numeric<v_quantity then raise exception 'ATLAS_SHORT_FILL_RECONCILIATION_REQUIRED'; end if;
    v_expected_basis:=case when (ls.state->>'quantity')::numeric=v_quantity then -(ls.state->>'costBasis')::numeric
      else -atlas_private.executor_round8((ls.state->>'costBasis')::numeric*v_quantity/(ls.state->>'quantity')::numeric) end;
    v_pnl:=v_cash_delta+v_expected_basis;
  end if;
  if v_basis_delta is distinct from v_expected_basis then raise exception 'ATLAS_EXECUTION_BASIS_MISMATCH'; end if;
  if (next_account->>'realizedPnl')::numeric is distinct from (ls.state->>'realizedPnl')::numeric+v_pnl or
    (next_account->>'totalFees')::numeric is distinct from (ls.state->>'totalFees')::numeric+(fill->>'fees')::numeric or
    (next_order->>'fees')::numeric is distinct from (os.state->>'fees')::numeric+(fill->>'fees')::numeric or
    (next_order->>'filledNotional')::numeric is distinct from (os.state->>'filledNotional')::numeric+v_quantity*(fill->>'price')::numeric then raise exception 'ATLAS_EXECUTION_ACCOUNTING_MISMATCH'; end if;
  if (o.filled_quantity+v_quantity=o.quantity and next_order->>'state'<>'FILLED') or
    (o.filled_quantity+v_quantity<o.quantity and next_order->>'state'<>case when os.state->>'state' in ('CANCEL_REQUESTED','CANCELLED','EXPIRED') then os.state->>'state' else 'PARTIALLY_FILLED' end) then raise exception 'ATLAS_INVALID_ORDER_TRANSITION'; end if;
  if v_cash_delta<>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',ls.cash_account_id,'amount',v_cash_delta::text)); end if;
  if v_basis_delta<>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',ls.invested_account_id,'amount',v_basis_delta::text)); end if;
  if v_cash_delta+v_basis_delta<>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('accountId',ls.clearing_account_id,'amount',(-(v_cash_delta+v_basis_delta))::text)); end if;
  -- The existing balanced ledger is reused in this same transaction, including its no-negative-balance checks.
  v_transaction:=public.post_ledger_transaction(p_owner_id,'fill:'||b.id||':'||(fill->>'executionId'),'FILL',v_lines,b.provider,
    p_commit#>>'{entry,reason}',b.external_account_id||':'||(fill->>'executionId'),o.agent_id,o.id,p_commit->'entry');
  insert into public.executions(owner_id,order_id,broker_account_id,broker_execution_id,quantity,price,fees,executed_at)
    values(p_owner_id,o.id,b.id,fill->>'executionId',v_quantity,(fill->>'price')::numeric,(fill->>'fees')::numeric,(fill->>'executedAt')::timestamptz);
  update public.executor_order_states set state=next_order,version=os.version+1,updated_at=clock_timestamp() where order_id=o.id;
  update public.executor_ledger_states set state=next_account,version=ls.version+1 where broker_account_id=b.id and agent_id=o.agent_id and asset_id=o.asset_id;
  update public.orders set status=next_order->>'state',filled_quantity=(next_order->>'filledQuantity')::numeric,
    executor_stock_reserved=case when o.side='SELL' then greatest(0,executor_stock_reserved-v_quantity) else executor_stock_reserved end,
    reconciliation_required=true,updated_at=clock_timestamp() where id=o.id;
  -- executor_ledger_states is the new local position. positions remains the last independently reconciled custody view.
  if o.side='SELL' then update public.positions set reserved_quantity=greatest(0,reserved_quantity-v_quantity)
    where broker_account_id=b.id and agent_id=o.agent_id and asset_id=o.asset_id; end if;
  update public.broker_accounts set reconciled_at=null where id=b.id;
  update public.system_state set broker_reconciled_at=null where owner_id=p_owner_id;
  -- Fill evidence is local accounting; do not claim an independently reconciled custody position.
  insert into public.order_events(owner_id,order_id,event_key,event_type,payload,source)
    values(p_owner_id,o.id,'fill:'||(fill->>'executionId'),'EXECUTION',jsonb_build_object('execution',fill,'ledgerTransactionId',v_transaction),b.provider);
  if jsonb_array_length(p_commit->'breaches')>0 then
    update public.system_state set global_kill_switch=true,live_trading_enabled=false,kill_switch_reason='Divergência na execução; reconciliação exigida.',updated_at=clock_timestamp() where owner_id=p_owner_id;
  end if;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,correlation_id,details)
    values(p_owner_id,'ATLAS_EXECUTOR','EXECUTION_ACCOUNTED','order',o.id::text,o.correlation_id,jsonb_build_object('executionId',fill->>'executionId','breaches',p_commit->'breaches'));
  return 'COMMITTED';
end $$;

create function public.executor_reconciliation_snapshot(p_owner_id uuid,p_broker_account_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.broker_accounts; v_cash numeric; v_positions jsonb; v_complete boolean;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into strict b from public.broker_accounts where id=p_broker_account_id and owner_id=p_owner_id;
  select coalesce(sum(balance),0) into v_cash from public.ledger_accounts where owner_id=p_owner_id and kind in ('BROKER_CASH','AGENT_CASH','RESERVE');
  select coalesce(jsonb_agg(jsonb_build_object('symbol',ticker,'quantity',quantity) order by ticker),'[]') into v_positions from (
    select ticker,sum(quantity) as quantity from (
      select a.ticker,(ls.state->>'quantity')::numeric as quantity from public.executor_ledger_states ls join public.assets a on a.id=ls.asset_id and a.owner_id=ls.owner_id
        where ls.owner_id=p_owner_id and ls.broker_account_id=b.id
      union all
      select a.ticker,p.quantity from public.positions p join public.assets a on a.id=p.asset_id and a.owner_id=p.owner_id
        where p.owner_id=p_owner_id and p.broker_account_id=b.id and not exists(select 1 from public.executor_ledger_states ls where ls.broker_account_id=p.broker_account_id and ls.agent_id=p.agent_id and ls.asset_id=p.asset_id)
    ) expected group by ticker having sum(quantity)>0
  ) p;
  v_complete:=(select count(*)=1 from public.broker_accounts where owner_id=p_owner_id) and b.capabilities->>'completeAccountReconciliation'='true'
    and exists(select 1 from public.ledger_accounts where owner_id=p_owner_id and kind='BROKER_CASH');
  return jsonb_build_object('accountId',b.external_account_id,'observedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cash',trim(trailing '.' from trim(trailing '0' from v_cash::numeric(28,8)::text)),'positions',v_positions,'complete',v_complete);
end $$;

create function public.finish_executor_reconciliation(p_owner_id uuid,p_broker_account_id uuid,p_result jsonb,p_local jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.broker_accounts; v_current jsonb; o public.orders; v_evidence jsonb; v_at timestamptz:=clock_timestamp();
begin
  perform atlas_private.require_owner(p_owner_id);
  -- Same lock order as admission. Evidence cannot release a reservation across a concurrent fill.
  perform 1 from public.system_state where owner_id=p_owner_id for update;
  select * into strict b from public.broker_accounts where id=p_broker_account_id and owner_id=p_owner_id for update;
  perform 1 from public.orders where broker_account_id=b.id order by id for update;
  perform 1 from public.ledger_accounts where owner_id=p_owner_id order by id for update;
  v_current:=public.executor_reconciliation_snapshot(p_owner_id,p_broker_account_id);
  if v_current-'observedAt' is distinct from p_local-'observedAt' then return false; end if;
  if (p_result->>'checkedAt')::timestamptz>v_at or (p_result->>'checkedAt')::timestamptz<v_at-interval '30 seconds' then return false; end if;
  select payload into v_evidence from public.executor_observations where owner_id=p_owner_id and broker_account_id=b.id and kind='RECONCILIATION'
    and payload->'result'=p_result and received_at>=v_at-interval '60 seconds' order by received_at desc limit 1;
  if not found then raise exception 'ATLAS_PERSISTED_RECONCILIATION_REQUIRED'; end if;
  if p_result->>'matches' is distinct from 'true' or p_result->'discrepancies' is distinct from '[]'::jsonb or p_local->>'complete' is distinct from 'true' then
    update public.system_state set live_trading_enabled=false,global_kill_switch=true,broker_reconciled_at=null,
      kill_switch_reason='Reconciliação do gateway divergente.',updated_at=v_at where owner_id=p_owner_id;
    update public.broker_accounts set reconciled_at=null where id=b.id;
    return false;
  end if;
  update public.broker_accounts set reconciled_at=v_at where id=b.id;
  update public.system_state set broker_reconciled_at=v_at where owner_id=p_owner_id;
  insert into public.positions(owner_id,broker_account_id,asset_id,agent_id,quantity,reserved_quantity,average_price,realized_pnl,reconciled_at)
    select p_owner_id,b.id,ls.asset_id,ls.agent_id,(ls.state->>'quantity')::numeric,0,
      case when (ls.state->>'quantity')::numeric=0 then 0 else (ls.state->>'costBasis')::numeric/(ls.state->>'quantity')::numeric end,
      (ls.state->>'realizedPnl')::numeric,v_at from public.executor_ledger_states ls where ls.owner_id=p_owner_id and ls.broker_account_id=b.id
    on conflict(broker_account_id,asset_id,agent_id) do update set quantity=excluded.quantity,average_price=excluded.average_price,realized_pnl=excluded.realized_pnl,reconciled_at=excluded.reconciled_at;
  update public.positions set reconciled_at=v_at where broker_account_id=b.id and owner_id=p_owner_id;
  for o in select * from public.orders where broker_account_id=b.id and owner_id=p_owner_id and status in ('FILLED','CANCELLED','EXPIRED','REJECTED') loop
    if exists(select 1 from public.executor_commands where order_id=o.id and status in ('PENDING','DISPATCHED','UNKNOWN')) then continue; end if;
    if o.side='SELL' then update public.positions set reserved_quantity=greatest(0,reserved_quantity-o.executor_stock_reserved)
      where broker_account_id=b.id and agent_id=o.agent_id and asset_id=o.asset_id;
      update public.orders set executor_stock_reserved=0 where id=o.id;
    end if;
    update public.order_reservations set released_at=coalesce(released_at,v_at) where order_id=o.id;
    update public.orders set reconciliation_required=false,reconciled_at=v_at where id=o.id;
  end loop;
  update public.orders set reconciliation_required=false,reconciled_at=v_at where broker_account_id=b.id and owner_id=p_owner_id
    and status in ('SUBMITTED','PARTIALLY_FILLED') and not exists(select 1 from public.executor_commands where order_id=public.orders.id and status in ('PENDING','DISPATCHED','UNKNOWN'));
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'ATLAS_EXECUTOR','EXECUTOR_RECONCILED','broker_account',b.id::text,jsonb_build_object('checkedAt',p_result->>'checkedAt'));
  return true;
end $$;

-- Explicit grants: no browser, even the owner, can approve/send orders or forge fills.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('enqueue_executor_command','claim_executor_command','complete_executor_command',
      'record_executor_observation','initialize_executor_ledger','commit_executor_execution','executor_reconciliation_snapshot','finish_executor_reconciliation',
      'stage_executor_executions','executor_execution_backlog','register_execution_gateway') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
revoke all on function atlas_private.executor_command_immutable() from public,anon,authenticated,service_role;
revoke all on function atlas_private.executor_round8(numeric) from public,anon,authenticated,service_role;
commit;
