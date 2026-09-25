-- Paper Trading is a separate, virtual book. Nothing here references broker accounts,
-- real orders, executor commands or the real ledger.
begin;

create table public.paper_accounts (
  owner_id uuid primary key references auth.users(id),
  initial_cash numeric(20,2) not null check(initial_cash between 100 and 100000000),
  cash numeric(20,2) not null check(cash >= 0),
  reserved_cash numeric(20,2) not null default 0 check(reserved_cash >= 0 and reserved_cash <= cash),
  max_order_value numeric(20,2) not null check(max_order_value > 0),
  max_exposure numeric(20,2) not null check(max_exposure > 0),
  max_daily_loss numeric(20,2) not null check(max_daily_loss > 0),
  fee_bps integer not null default 3 check(fee_bps between 0 and 100),
  slippage_bps integer not null default 5 check(slippage_bps between 0 and 100),
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(max_order_value <= initial_cash and max_exposure <= initial_cash)
);
create table public.paper_positions (
  owner_id uuid not null references auth.users(id),
  agent_id uuid not null,
  asset_id uuid not null,
  quantity integer not null default 0 check(quantity >= 0),
  average_cost numeric(20,8) not null default 0 check(average_cost >= 0),
  realized_pnl numeric(20,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key(owner_id,agent_id,asset_id),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  check(quantity > 0 or average_cost = 0)
);
create table public.paper_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  agent_id uuid not null,
  asset_id uuid not null,
  side text not null check(side in ('BUY','SELL')),
  quantity integer not null check(quantity > 0 and quantity <= 1000000),
  limit_price numeric(20,2) not null check(limit_price > 0),
  reference_price numeric(20,2) not null check(reference_price > 0),
  quote_source text not null check(quote_source like 'https://%'),
  quote_timestamp timestamptz not null,
  history_source text not null check(history_source like 'https://%'),
  history_retrieved_at timestamptz not null,
  strategy_version text not null,
  reasoning_summary text not null,
  indicators jsonb not null default '{}' check(jsonb_typeof(indicators)='object'),
  status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','EXPIRED')),
  risk_result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '1 day'),
  idempotency_key uuid not null,
  unique(owner_id,idempotency_key), unique(id,owner_id),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id)
);
create table public.paper_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  proposal_id uuid not null unique,
  agent_id uuid not null,
  asset_id uuid not null,
  side text not null check(side in ('BUY','SELL')),
  quantity integer not null check(quantity > 0),
  limit_price numeric(20,2) not null check(limit_price > 0),
  reserved_cash numeric(20,2) not null default 0 check(reserved_cash >= 0),
  status text not null default 'OPEN' check(status in ('OPEN','FILLED','CANCELLED','EXPIRED')),
  placed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  closed_at timestamptz,
  unique(id,owner_id),
  foreign key(proposal_id,owner_id) references public.paper_proposals(id,owner_id),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id)
);
create index paper_orders_open on public.paper_orders(owner_id,asset_id,placed_at) where status='OPEN';
create table public.paper_fills (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  order_id uuid not null unique,
  agent_id uuid not null,
  asset_id uuid not null,
  side text not null check(side in ('BUY','SELL')),
  quantity integer not null check(quantity > 0),
  reference_price numeric(20,2) not null,
  fill_price numeric(20,2) not null,
  fee numeric(20,2) not null check(fee >= 0),
  realized_pnl numeric(20,2) not null default 0,
  quote_source text not null,
  quote_timestamp timestamptz not null,
  filled_at timestamptz not null default now(),
  cash_after numeric(20,2) not null,
  position_after integer not null,
  simulated boolean not null default true check(simulated),
  foreign key(order_id,owner_id) references public.paper_orders(id,owner_id)
);
create table public.paper_ledger_entries (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  transaction_id uuid not null,
  fill_id uuid,
  account_kind text not null check(account_kind in ('CASH','INVENTORY','FEES','REALIZED_PNL','OPENING_EQUITY')),
  amount numeric(20,2) not null check(amount <> 0),
  created_at timestamptz not null default now(),
  foreign key(fill_id) references public.paper_fills(id)
);
create table public.paper_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  proposal_id uuid,
  order_id uuid,
  event text not null check(event in ('ACCOUNT_OPENED','PROPOSED','RISK_APPROVED','RISK_REJECTED','ORDER_OPENED','ORDER_FILLED','ORDER_CANCELLED','ORDER_EXPIRED','PAUSED','RESUMED')),
  details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['paper_accounts','paper_positions','paper_proposals','paper_orders','paper_fills','paper_ledger_entries','paper_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('create policy owner_aal2_select on public.%I for select to authenticated using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()))',t);
  end loop;
end $$;

create trigger paper_fills_immutable before update or delete on public.paper_fills
  for each row execute function atlas_private.reject_mutation();
create trigger paper_ledger_immutable before update or delete on public.paper_ledger_entries
  for each row execute function atlas_private.reject_mutation();
create trigger paper_events_immutable before update or delete on public.paper_events
  for each row execute function atlas_private.reject_mutation();

create function atlas_private.paper_ledger_balanced() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (select coalesce(sum(amount),0) from public.paper_ledger_entries where transaction_id=new.transaction_id) <> 0 then
    raise exception 'ATLAS_PAPER_LEDGER_UNBALANCED' using errcode='23514';
  end if;
  return new;
end $$;
create constraint trigger paper_ledger_balanced after insert on public.paper_ledger_entries
  deferrable initially deferred for each row execute function atlas_private.paper_ledger_balanced();

create function public.paper_open_account(p_owner_id uuid,p_initial_cash numeric,p_max_order numeric,p_max_exposure numeric,p_max_daily_loss numeric)
returns public.paper_accounts language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts; v_tx uuid := gen_random_uuid();
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_initial_cash is null or p_initial_cash not between 100 and 100000000 or
    p_max_order is null or p_max_order <= 0 or p_max_order > p_initial_cash or
    p_max_exposure is null or p_max_exposure <= 0 or p_max_exposure > p_initial_cash or
    p_max_daily_loss is null or p_max_daily_loss <= 0 or p_max_daily_loss > p_initial_cash or
    p_initial_cash <> round(p_initial_cash,2) or p_max_order <> round(p_max_order,2) or
    p_max_exposure <> round(p_max_exposure,2) or p_max_daily_loss <> round(p_max_daily_loss,2) then
    raise exception 'ATLAS_PAPER_INVALID_LIMITS';
  end if;
  insert into public.paper_accounts(owner_id,initial_cash,cash,max_order_value,max_exposure,max_daily_loss)
  values(p_owner_id,p_initial_cash,p_initial_cash,p_max_order,p_max_exposure,p_max_daily_loss)
  returning * into v_account;
  insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
  values(p_owner_id,v_tx,'CASH',p_initial_cash),(p_owner_id,v_tx,'OPENING_EQUITY',-p_initial_cash);
  insert into public.paper_events(owner_id,event,details)
  values(p_owner_id,'ACCOUNT_OPENED',jsonb_build_object('initialCash',p_initial_cash,'maxOrder',p_max_order,'maxExposure',p_max_exposure,'maxDailyLoss',p_max_daily_loss,'simulation',true));
  return v_account;
end $$;

create function public.paper_create_proposal(
  p_owner_id uuid,p_agent_id uuid,p_side text,p_quantity integer,p_limit_price numeric,
  p_reference_price numeric,p_quote_source text,p_quote_timestamp timestamptz,
  p_history_source text,p_history_retrieved_at timestamptz,p_strategy_version text,
  p_reasoning text,p_indicators jsonb,p_idempotency_key uuid
) returns public.paper_proposals language plpgsql security definer set search_path='' as $$
declare v_agent public.agents; v_asset public.assets; v_proposal public.paper_proposals;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_proposal from public.paper_proposals where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
  if found then return v_proposal; end if;
  select * into v_agent from public.agents where owner_id=p_owner_id and id=p_agent_id;
  if not found or not v_agent.enabled or v_agent.status in ('PAUSED','FIRED','DEAD') then raise exception 'ATLAS_PAPER_AGENT_INACTIVE'; end if;
  select * into v_asset from public.assets where owner_id=p_owner_id and id=v_agent.asset_id and active;
  if not found or v_asset.exchange <> 'B3' or v_asset.currency <> 'BRL' then raise exception 'ATLAS_PAPER_ASSET_INVALID'; end if;
  if p_side not in ('BUY','SELL') or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 or
    p_quantity % v_asset.lot_size <> 0 or p_limit_price is null or p_limit_price <= 0 or
    p_limit_price <> round(p_limit_price,2) or mod(p_limit_price,v_asset.tick_size) <> 0 or
    p_reference_price is null or p_reference_price <= 0 or p_reference_price <> round(p_reference_price,2) or
    p_quote_source not like 'https://%' or length(p_quote_source) > 2000 or
    p_history_source not like 'https://%' or length(p_history_source) > 2000 or
    p_quote_timestamp is null or p_quote_timestamp > now() or p_quote_timestamp < now()-interval '72 hours' or
    p_history_retrieved_at is null or p_history_retrieved_at > now() or p_history_retrieved_at < now()-interval '24 hours' or
    p_strategy_version is null or length(p_strategy_version) not between 1 and 100 or
    p_reasoning is null or length(p_reasoning) not between 10 and 1000 or
    p_indicators is null or jsonb_typeof(p_indicators) <> 'object' or p_idempotency_key is null then
    raise exception 'ATLAS_PAPER_INVALID_PROPOSAL';
  end if;
  insert into public.paper_proposals(owner_id,agent_id,asset_id,side,quantity,limit_price,reference_price,
    quote_source,quote_timestamp,history_source,history_retrieved_at,strategy_version,reasoning_summary,indicators,idempotency_key)
  values(p_owner_id,p_agent_id,v_asset.id,p_side,p_quantity,p_limit_price,p_reference_price,
    p_quote_source,p_quote_timestamp,p_history_source,p_history_retrieved_at,p_strategy_version,p_reasoning,p_indicators,p_idempotency_key)
  returning * into v_proposal;
  insert into public.paper_events(owner_id,proposal_id,event,details) values
    (p_owner_id,v_proposal.id,'PROPOSED',jsonb_build_object('quoteTimestamp',p_quote_timestamp,'quoteSource',p_quote_source,'strategyVersion',p_strategy_version,'simulation',true));
  return v_proposal;
end $$;

create function public.paper_review_proposal(p_owner_id uuid,p_proposal_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts; v_proposal public.paper_proposals; v_agent public.agents;
  v_position public.paper_positions; v_order public.paper_orders; v_reasons text[] := array[]::text[];
  v_reserved numeric; v_pending_buy numeric; v_exposure numeric; v_reserved_sell integer;
  v_daily_loss numeric; v_reserve numeric; v_value numeric; v_limit numeric;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_account from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  select * into v_proposal from public.paper_proposals where owner_id=p_owner_id and id=p_proposal_id for update;
  if not found then raise exception 'ATLAS_PAPER_PROPOSAL_NOT_FOUND'; end if;
  if v_proposal.status <> 'PENDING' then
    select * into v_order from public.paper_orders where proposal_id=v_proposal.id;
    return jsonb_build_object('status',v_proposal.status,'orderId',v_order.id,'risk',v_proposal.risk_result);
  end if;
  if not coalesce(p_approve,false) then
    update public.paper_proposals set status='REJECTED',risk_result=jsonb_build_object('approved',false,'reasons',jsonb_build_array('OWNER_REJECTED')) where id=v_proposal.id;
    insert into public.paper_events(owner_id,proposal_id,event,details) values(p_owner_id,v_proposal.id,'RISK_REJECTED',jsonb_build_object('reason','OWNER_REJECTED'));
    return jsonb_build_object('status','REJECTED','risk',jsonb_build_object('approved',false,'reasons',jsonb_build_array('OWNER_REJECTED')));
  end if;
  select * into v_agent from public.agents where owner_id=p_owner_id and id=v_proposal.agent_id;
  select * into v_position from public.paper_positions where owner_id=p_owner_id and agent_id=v_proposal.agent_id and asset_id=v_proposal.asset_id;
  select coalesce(sum(reserved_cash),0) into v_reserved from public.paper_orders where owner_id=p_owner_id and status='OPEN';
  select coalesce(sum(reserved_cash),0) into v_pending_buy from public.paper_orders where owner_id=p_owner_id and status='OPEN' and agent_id=v_proposal.agent_id;
  select coalesce(sum(quantity * average_cost),0) into v_exposure from public.paper_positions where owner_id=p_owner_id;
  select coalesce(sum(quantity),0) into v_reserved_sell from public.paper_orders where owner_id=p_owner_id and status='OPEN' and side='SELL' and agent_id=v_proposal.agent_id and asset_id=v_proposal.asset_id;
  select greatest(0,-coalesce(sum(realized_pnl),0)) into v_daily_loss from public.paper_fills
    where owner_id=p_owner_id and filled_at >= date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_value := v_proposal.quantity*v_proposal.limit_price;
  v_reserve := v_value + ceil(v_value*v_account.fee_bps/10000*100)/100;
  if v_account.paused then v_reasons:=array_append(v_reasons,'PAPER_PAUSED'); end if;
  if v_proposal.expires_at <= now() then v_reasons:=array_append(v_reasons,'PROPOSAL_EXPIRED'); end if;
  if v_proposal.quote_timestamp > now() or v_proposal.quote_timestamp < now()-interval '72 hours' then v_reasons:=array_append(v_reasons,'STALE_QUOTE'); end if;
  if v_proposal.history_retrieved_at < now()-interval '24 hours' then v_reasons:=array_append(v_reasons,'STALE_HISTORY'); end if;
  if not v_agent.enabled or v_agent.status in ('PAUSED','FIRED','DEAD') then v_reasons:=array_append(v_reasons,'AGENT_INACTIVE'); end if;
  if v_value > v_account.max_order_value then v_reasons:=array_append(v_reasons,'ORDER_VALUE_LIMIT'); end if;
  if v_daily_loss >= v_account.max_daily_loss then v_reasons:=array_append(v_reasons,'DAILY_LOSS_LIMIT'); end if;
  if v_proposal.side='BUY' then
    if v_reserve > v_account.cash-v_reserved then v_reasons:=array_append(v_reasons,'INSUFFICIENT_VIRTUAL_CASH'); end if;
    if v_value+v_pending_buy+coalesce(v_position.quantity*v_position.average_cost,0) > v_agent.budget then v_reasons:=array_append(v_reasons,'AGENT_BUDGET_LIMIT'); end if;
    if v_exposure+v_reserved+v_reserve > v_account.max_exposure then v_reasons:=array_append(v_reasons,'PORTFOLIO_EXPOSURE_LIMIT'); end if;
  elsif v_proposal.quantity > coalesce(v_position.quantity,0)-v_reserved_sell then
    v_reasons:=array_append(v_reasons,'SHORT_SELLING_FORBIDDEN');
  end if;
  if array_length(v_reasons,1) is not null then
    update public.paper_proposals set status='REJECTED',risk_result=jsonb_build_object('approved',false,'reasons',to_jsonb(v_reasons),'evaluatedAt',now()) where id=v_proposal.id;
    insert into public.paper_events(owner_id,proposal_id,event,details) values(p_owner_id,v_proposal.id,'RISK_REJECTED',jsonb_build_object('reasons',to_jsonb(v_reasons)));
    return jsonb_build_object('status','REJECTED','risk',jsonb_build_object('approved',false,'reasons',to_jsonb(v_reasons)));
  end if;
  update public.paper_proposals set status='APPROVED',risk_result=jsonb_build_object('approved',true,'reasons',jsonb_build_array(),'evaluatedAt',now()) where id=v_proposal.id;
  insert into public.paper_orders(owner_id,proposal_id,agent_id,asset_id,side,quantity,limit_price,reserved_cash)
  values(p_owner_id,v_proposal.id,v_proposal.agent_id,v_proposal.asset_id,v_proposal.side,v_proposal.quantity,v_proposal.limit_price,
    case when v_proposal.side='BUY' then v_reserve else 0 end) returning * into v_order;
  if v_proposal.side='BUY' then update public.paper_accounts set reserved_cash=reserved_cash+v_reserve,updated_at=now() where owner_id=p_owner_id; end if;
  insert into public.paper_events(owner_id,proposal_id,order_id,event,details) values
    (p_owner_id,v_proposal.id,null,'RISK_APPROVED',jsonb_build_object('value',v_value,'reservedCash',case when v_proposal.side='BUY' then v_reserve else 0 end,'simulation',true)),
    (p_owner_id,v_proposal.id,v_order.id,'ORDER_OPENED',jsonb_build_object('limitPrice',v_order.limit_price,'simulation',true));
  return jsonb_build_object('status','OPEN','orderId',v_order.id,'risk',jsonb_build_object('approved',true,'reasons',jsonb_build_array()));
end $$;

create function public.paper_settle_quote(p_owner_id uuid,p_asset_id uuid,p_price numeric,p_source text,p_quote_timestamp timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts; v_order public.paper_orders; v_position public.paper_positions;
  v_asset public.assets; v_fill public.paper_fills; v_price numeric; v_fee numeric; v_value numeric;
  v_basis numeric; v_pnl numeric; v_tx uuid; v_filled integer:=0; v_expired integer:=0;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_account from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  select * into v_asset from public.assets where owner_id=p_owner_id and id=p_asset_id and active;
  if not found then raise exception 'ATLAS_PAPER_ASSET_INVALID'; end if;
  if p_price is null or p_price <= 0 or p_price <> round(p_price,2) or p_source not like 'https://%' or
    p_quote_timestamp is null or p_quote_timestamp > now() or p_quote_timestamp < now()-interval '72 hours' then
    raise exception 'ATLAS_PAPER_QUOTE_INVALID';
  end if;
  for v_order in select * from public.paper_orders where owner_id=p_owner_id and asset_id=p_asset_id and status='OPEN' order by placed_at,id for update loop
    if v_order.expires_at <= now() then
      update public.paper_orders set status='EXPIRED',closed_at=now() where id=v_order.id;
      update public.paper_accounts set reserved_cash=reserved_cash-v_order.reserved_cash,updated_at=now() where owner_id=p_owner_id;
      insert into public.paper_events(owner_id,proposal_id,order_id,event,details) values(p_owner_id,v_order.proposal_id,v_order.id,'ORDER_EXPIRED','{}');
      v_expired:=v_expired+1;
      continue;
    end if;
    if v_account.paused or p_quote_timestamp <= v_order.placed_at then continue; end if;
    v_price := round(p_price*(1+case when v_order.side='BUY' then 1 else -1 end*v_account.slippage_bps/10000.0),2);
    if v_price <= 0 or (v_order.side='BUY' and v_price > v_order.limit_price) or
      (v_order.side='SELL' and v_price < v_order.limit_price) then continue; end if;
    v_value:=v_order.quantity*v_price;
    v_fee:=ceil(v_value*v_account.fee_bps/10000*100)/100;
    insert into public.paper_positions(owner_id,agent_id,asset_id) values(p_owner_id,v_order.agent_id,v_order.asset_id)
      on conflict do nothing;
    select * into v_position from public.paper_positions where owner_id=p_owner_id and agent_id=v_order.agent_id and asset_id=v_order.asset_id for update;
    v_basis:=round(v_position.quantity*v_position.average_cost,2);
    v_pnl:=0;
    if v_order.side='BUY' then
      if v_value+v_fee > v_order.reserved_cash or v_value+v_fee > v_account.cash then raise exception 'ATLAS_PAPER_RESERVATION_MISMATCH'; end if;
      update public.paper_positions set quantity=quantity+v_order.quantity,
        average_cost=round((v_basis+v_value)/(quantity+v_order.quantity),8),updated_at=now()
        where owner_id=p_owner_id and agent_id=v_order.agent_id and asset_id=v_order.asset_id;
      update public.paper_accounts set cash=cash-v_value-v_fee,reserved_cash=reserved_cash-v_order.reserved_cash,updated_at=now() where owner_id=p_owner_id returning * into v_account;
    else
      if v_position.quantity < v_order.quantity then raise exception 'ATLAS_PAPER_POSITION_MISMATCH'; end if;
      v_basis:=round(v_order.quantity*v_position.average_cost,2);
      v_pnl:=v_value-v_fee-v_basis;
      update public.paper_positions set quantity=quantity-v_order.quantity,
        average_cost=case when quantity=v_order.quantity then 0 else average_cost end,
        realized_pnl=realized_pnl+v_pnl,updated_at=now()
        where owner_id=p_owner_id and agent_id=v_order.agent_id and asset_id=v_order.asset_id;
      update public.paper_accounts set cash=cash+v_value-v_fee,updated_at=now() where owner_id=p_owner_id returning * into v_account;
    end if;
    update public.paper_orders set status='FILLED',closed_at=now() where id=v_order.id;
    insert into public.paper_fills(owner_id,order_id,agent_id,asset_id,side,quantity,reference_price,fill_price,fee,
      realized_pnl,quote_source,quote_timestamp,cash_after,position_after)
    values(p_owner_id,v_order.id,v_order.agent_id,v_order.asset_id,v_order.side,v_order.quantity,p_price,v_price,v_fee,
      v_pnl,p_source,p_quote_timestamp,v_account.cash,
      case when v_order.side='BUY' then v_position.quantity+v_order.quantity else v_position.quantity-v_order.quantity end)
    returning * into v_fill;
    v_tx:=gen_random_uuid();
    if v_order.side='BUY' then
      insert into public.paper_ledger_entries(owner_id,transaction_id,fill_id,account_kind,amount) values
        (p_owner_id,v_tx,v_fill.id,'CASH',-(v_value+v_fee)),(p_owner_id,v_tx,v_fill.id,'INVENTORY',v_value);
      if v_fee > 0 then insert into public.paper_ledger_entries(owner_id,transaction_id,fill_id,account_kind,amount) values(p_owner_id,v_tx,v_fill.id,'FEES',v_fee); end if;
    else
      insert into public.paper_ledger_entries(owner_id,transaction_id,fill_id,account_kind,amount) values
        (p_owner_id,v_tx,v_fill.id,'CASH',v_value-v_fee),(p_owner_id,v_tx,v_fill.id,'INVENTORY',-v_basis);
      if v_fee > 0 then insert into public.paper_ledger_entries(owner_id,transaction_id,fill_id,account_kind,amount) values(p_owner_id,v_tx,v_fill.id,'FEES',v_fee); end if;
      -- The ledger P&L leg is gross; positions/fills retain net realized P&L.
      if v_pnl+v_fee <> 0 then insert into public.paper_ledger_entries(owner_id,transaction_id,fill_id,account_kind,amount) values(p_owner_id,v_tx,v_fill.id,'REALIZED_PNL',-(v_pnl+v_fee)); end if;
    end if;
    insert into public.paper_events(owner_id,proposal_id,order_id,event,details) values
      (p_owner_id,v_order.proposal_id,v_order.id,'ORDER_FILLED',jsonb_build_object('fillId',v_fill.id,'source',p_source,'quoteTimestamp',p_quote_timestamp,'simulation',true));
    v_filled:=v_filled+1;
  end loop;
  return jsonb_build_object('filled',v_filled,'expired',v_expired,'simulation',true);
end $$;

create function public.paper_cancel_order(p_owner_id uuid,p_order_id uuid)
returns public.paper_orders language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts; v_order public.paper_orders;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_account from public.paper_accounts where owner_id=p_owner_id for update;
  select * into v_order from public.paper_orders where owner_id=p_owner_id and id=p_order_id for update;
  if not found then raise exception 'ATLAS_PAPER_ORDER_NOT_FOUND'; end if;
  if v_order.status='OPEN' then
    update public.paper_orders set status='CANCELLED',closed_at=now() where id=v_order.id returning * into v_order;
    update public.paper_accounts set reserved_cash=reserved_cash-v_order.reserved_cash,updated_at=now() where owner_id=p_owner_id;
    insert into public.paper_events(owner_id,proposal_id,order_id,event,details) values(p_owner_id,v_order.proposal_id,v_order.id,'ORDER_CANCELLED','{}');
  end if;
  return v_order;
end $$;

create function public.paper_set_paused(p_owner_id uuid,p_paused boolean)
returns public.paper_accounts language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts; v_order public.paper_orders;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_account from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  if p_paused is null then raise exception 'ATLAS_PAPER_INVALID_STATE'; end if;
  update public.paper_accounts set paused=p_paused,updated_at=now() where owner_id=p_owner_id returning * into v_account;
  if p_paused then
    for v_order in select * from public.paper_orders where owner_id=p_owner_id and status='OPEN' for update loop
      update public.paper_orders set status='CANCELLED',closed_at=now() where id=v_order.id;
      update public.paper_accounts set reserved_cash=reserved_cash-v_order.reserved_cash where owner_id=p_owner_id;
      insert into public.paper_events(owner_id,proposal_id,order_id,event,details) values(p_owner_id,v_order.proposal_id,v_order.id,'ORDER_CANCELLED',jsonb_build_object('reason','PAPER_PAUSED'));
    end loop;
  end if;
  insert into public.paper_events(owner_id,event,details) values(p_owner_id,case when p_paused then 'PAUSED' else 'RESUMED' end,'{}');
  select * into v_account from public.paper_accounts where owner_id=p_owner_id;
  return v_account;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'paper_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
revoke all on function atlas_private.paper_ledger_balanced() from public,anon,authenticated,service_role;
commit;
