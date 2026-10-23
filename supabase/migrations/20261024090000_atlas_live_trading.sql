-- Real money at Genial (MT5 Swing), adapted to the broker's answers (23/10/2026):
-- * the terminal never shows the balance: ATLAS keeps its own cash per agent, bounded by the
--   owner's ceiling (capital_plans) and each agent's real budget; a broker rejection for lack
--   of money is recorded as REJECTED;
-- * fees are not in MT5: they come from the contract table (R$ 2,99 standard lot order,
--   R$ 0,99 fractional order, B3 ~0,03%);
-- * PETR4 and PETR4F are separate symbols: one order is one leg (multiple of 100 on the
--   standard symbol, or 1-99 on the F symbol);
-- * orders are IOC (fill now up to the limit, cancel the rest).
-- Entries follow the simulation's autopilot decisions. Nothing here talks to the broker: the
-- local executor does, and only when this switch, LIVE_TRADING_ENABLED and the gateway's own
-- ATLAS_MT5_ENABLE_EXECUTION are all on.
begin;

create table public.live_settings (
  owner_id uuid primary key references auth.users(id),
  enabled boolean not null default false,
  max_order numeric(12,2) not null default 300 check(max_order between 10 and 100000),
  daily_orders integer not null default 8 check(daily_orders between 1 and 100),
  enabled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.agents add column real_budget numeric(12,2) not null default 0 check(real_budget >= 0 and real_budget <= 100000000);

create table public.live_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  agent_id uuid not null,
  ticker text not null check(ticker ~ '^[A-Z]{4}[0-9]{1,2}$'),
  symbol text not null,
  side text not null check(side in ('BUY','SELL')),
  quantity integer not null check(quantity > 0),
  limit_price numeric(20,2) not null check(limit_price > 0),
  reserved_cash numeric(20,2) not null default 0 check(reserved_cash >= 0),
  filled_quantity integer not null default 0,
  broker_filled integer not null default 0,
  status text not null default 'PENDING' check(status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED','EXPIRED','UNKNOWN')),
  broker_order_id text unique,
  paper_order_id uuid unique,
  reason text not null check(length(reason) between 1 and 500),
  error text check(error is null or length(error) <= 300),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  check(filled_quantity >= 0 and filled_quantity <= quantity and broker_filled >= 0 and broker_filled <= quantity),
  check((symbol = ticker and quantity % 100 = 0) or (symbol = ticker || 'F' and quantity < 100))
);
create index live_orders_active on public.live_orders(owner_id, agent_id) where status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','UNKNOWN');

create table public.live_fills (
  execution_id text primary key check(length(execution_id) between 1 and 200),
  owner_id uuid not null references auth.users(id),
  order_id uuid not null references public.live_orders(id),
  agent_id uuid not null,
  ticker text not null,
  side text not null check(side in ('BUY','SELL')),
  quantity integer not null check(quantity > 0),
  price numeric(20,4) not null check(price > 0),
  fee numeric(12,2) not null check(fee >= 0),
  realized_pnl numeric(20,2) not null default 0,
  executed_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create trigger live_fills_immutable before update or delete on public.live_fills
  for each row execute function atlas_private.reject_mutation();

create table public.live_positions (
  owner_id uuid not null references auth.users(id),
  agent_id uuid not null,
  ticker text not null,
  quantity integer not null default 0 check(quantity >= 0),
  cost numeric(20,2) not null default 0 check(cost >= 0),
  realized_pnl numeric(20,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key(owner_id, agent_id, ticker),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  check(quantity > 0 or cost = 0)
);

create table public.live_sync (
  owner_id uuid primary key references auth.users(id),
  cursor text check(cursor is null or length(cursor) <= 1000),
  updated_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['live_settings','live_orders','live_fills','live_positions','live_sync'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
    execute format('create policy owner_aal2_select on public.%I for select to authenticated using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()))',t);
  end loop;
end $$;

-- Money an agent may still commit: its real budget plus realised results, minus what is
-- invested and what active buy orders reserve.
create function atlas_private.live_agent_room(p_owner_id uuid,p_agent_id uuid) returns numeric
language sql stable set search_path='' as $$
  select g.real_budget
    + coalesce((select sum(realized_pnl) from public.live_positions where owner_id=p_owner_id and agent_id=p_agent_id),0)
    - coalesce((select sum(cost) from public.live_positions where owner_id=p_owner_id and agent_id=p_agent_id),0)
    - coalesce((select sum(reserved_cash) from public.live_orders where owner_id=p_owner_id and agent_id=p_agent_id
        and side='BUY' and status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','UNKNOWN')),0)
  from public.agents g where g.id=p_agent_id and g.owner_id=p_owner_id
$$;

-- Owner switch. Turning on needs the typed confirmation, a ceiling and at least one funded agent;
-- it also releases the global kill switch. Turning off is always allowed.
create function public.set_live_settings(p_owner_id uuid,p_enabled boolean,p_max_order numeric,p_daily_orders integer,p_confirm text)
returns public.live_settings language plpgsql security definer set search_path='' as $$
declare v_row public.live_settings; v_ceiling numeric;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_enabled is null or p_max_order is null or p_max_order not between 10 and 100000 or p_max_order <> round(p_max_order,2)
     or p_daily_orders is null or p_daily_orders not between 1 and 100 then raise exception 'ATLAS_INVALID_LIVE_SETTINGS'; end if;
  if p_enabled then
    if p_confirm is distinct from 'LIGAR DINHEIRO REAL' then raise exception 'ATLAS_LIVE_CONFIRMATION_REQUIRED'; end if;
    select ceiling into v_ceiling from public.capital_plans where owner_id=p_owner_id;
    if coalesce(v_ceiling,0) <= 0 then raise exception 'ATLAS_LIVE_CEILING_REQUIRED'; end if;
    if not exists(select 1 from public.agents where owner_id=p_owner_id and real_budget > 0 and status not in ('DEAD','FIRED')) then
      raise exception 'ATLAS_LIVE_BUDGET_REQUIRED'; end if;
  end if;
  insert into public.live_settings(owner_id,enabled,max_order,daily_orders,enabled_at)
  values(p_owner_id,p_enabled,p_max_order,p_daily_orders,case when p_enabled then now() end)
  on conflict(owner_id) do update set enabled=excluded.enabled,max_order=excluded.max_order,daily_orders=excluded.daily_orders,
    enabled_at=case when excluded.enabled then coalesce(public.live_settings.enabled_at,now()) else null end,updated_at=now()
  returning * into v_row;
  update public.system_state set live_trading_enabled=p_enabled,
    global_kill_switch=case when p_enabled then false else global_kill_switch end,
    kill_switch_reason=case when p_enabled then 'Dinheiro real ligado pelo proprietário.' else kill_switch_reason end,updated_at=now()
  where owner_id=p_owner_id;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER',case when p_enabled then 'LIVE_ENABLED' else 'LIVE_DISABLED' end,'live_settings',p_owner_id::text,
    jsonb_build_object('maxOrder',p_max_order::text,'dailyOrders',p_daily_orders));
  return v_row;
end $$;

-- Real money assigned to one agent. All agents together stay within the ceiling minus money
-- being prepared for withdrawal.
create function public.set_agent_real_budget(p_owner_id uuid,p_agent_id uuid,p_amount numeric)
returns public.agents language plpgsql security definer set search_path='' as $$
declare v_agent public.agents; v_ceiling numeric; v_withdraw numeric; v_others numeric;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_amount is null or p_amount < 0 or p_amount > 100000000 or p_amount <> round(p_amount,2) then raise exception 'ATLAS_INVALID_REAL_BUDGET'; end if;
  select * into v_agent from public.agents where id=p_agent_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
  if p_amount > 0 and v_agent.status in ('DEAD','FIRED') then raise exception 'ATLAS_AGENT_ELIMINATED'; end if;
  select coalesce(ceiling,0) into v_ceiling from public.capital_plans where owner_id=p_owner_id;
  select coalesce(sum(amount),0) into v_withdraw from public.withdrawal_requests where owner_id=p_owner_id and status in ('PREPARING','READY');
  select coalesce(sum(real_budget),0) into v_others from public.agents where owner_id=p_owner_id and id<>p_agent_id;
  if v_others + p_amount > coalesce(v_ceiling,0) - v_withdraw then raise exception 'ATLAS_REAL_BUDGET_ABOVE_CEILING'; end if;
  update public.agents set real_budget=p_amount,updated_at=now() where id=p_agent_id returning * into v_agent;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','AGENT_REAL_BUDGET_CHANGED','agent',p_agent_id::text,jsonb_build_object('amount',p_amount::text));
  return v_agent;
end $$;

-- A real order, sized by the caller from the live quote; every limit is re-checked here.
create function public.live_create_order(p_owner_id uuid,p_agent_id uuid,p_side text,p_quantity integer,p_limit numeric,p_reason text,p_paper_order_id uuid)
returns public.live_orders language plpgsql security definer set search_path='' as $$
declare v_settings public.live_settings; v_state public.system_state; v_agent public.agents; v_ticker text; v_symbol text;
  v_value numeric; v_fee numeric; v_row public.live_orders; v_held integer; v_selling integer; v_ceiling numeric; v_exposure numeric;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_settings from public.live_settings where owner_id=p_owner_id for update;
  select * into v_state from public.system_state where owner_id=p_owner_id;
  if not found or v_settings.enabled is not true or v_state.live_trading_enabled is not true or v_state.global_kill_switch then
    raise exception 'ATLAS_LIVE_DISABLED'; end if;
  if p_paper_order_id is not null and exists(select 1 from public.live_orders where paper_order_id=p_paper_order_id) then
    raise exception 'ATLAS_LIVE_ALREADY_MIRRORED'; end if;
  if p_side not in ('BUY','SELL') or p_quantity is null or p_quantity <= 0 or p_limit is null or p_limit <= 0 or p_limit <> round(p_limit,2)
     or coalesce(length(trim(p_reason)),0) = 0 then raise exception 'ATLAS_INVALID_LIVE_ORDER'; end if;
  select * into v_agent from public.agents where id=p_agent_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
  if v_agent.status in ('DEAD','FIRED') or v_agent.autopilot is not true then raise exception 'ATLAS_LIVE_AGENT_INACTIVE'; end if;
  select a.ticker into v_ticker from public.assets a where a.id=v_agent.asset_id and a.owner_id=p_owner_id;
  if v_ticker !~ '^[A-Z]{4}[0-9]{1,2}$' then raise exception 'ATLAS_INVALID_LIVE_ORDER'; end if;
  v_symbol := case when p_quantity % 100 = 0 then v_ticker when p_quantity < 100 then v_ticker || 'F' end;
  if v_symbol is null then raise exception 'ATLAS_LIVE_SPLIT_REQUIRED'; end if;
  if exists(select 1 from public.live_orders where owner_id=p_owner_id and agent_id=p_agent_id
    and status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','UNKNOWN')) then raise exception 'ATLAS_LIVE_ORDER_ACTIVE'; end if;
  if (select count(*) from public.live_orders where owner_id=p_owner_id
      and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')) >= v_settings.daily_orders then
    raise exception 'ATLAS_LIVE_DAILY_LIMIT'; end if;
  v_value := p_quantity * p_limit;
  v_fee := atlas_private.paper_fee(3, 2.99, 0.99, v_value, p_quantity);
  if p_side = 'BUY' then
    if v_value > v_settings.max_order then raise exception 'ATLAS_LIVE_MAX_ORDER'; end if;
    if v_value + v_fee > atlas_private.live_agent_room(p_owner_id,p_agent_id) then raise exception 'ATLAS_LIVE_AGENT_BUDGET'; end if;
    select coalesce(ceiling,0) into v_ceiling from public.capital_plans where owner_id=p_owner_id;
    select coalesce((select sum(cost) from public.live_positions where owner_id=p_owner_id),0)
         + coalesce((select sum(reserved_cash) from public.live_orders where owner_id=p_owner_id and side='BUY'
             and status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','UNKNOWN')),0)
         + coalesce((select sum(amount) from public.withdrawal_requests where owner_id=p_owner_id and status in ('PREPARING','READY')),0)
      into v_exposure;
    if v_exposure + v_value + v_fee > coalesce(v_ceiling,0) then raise exception 'ATLAS_LIVE_CEILING'; end if;
  else
    select coalesce(quantity,0) into v_held from public.live_positions where owner_id=p_owner_id and agent_id=p_agent_id and ticker=v_ticker;
    select coalesce(sum(quantity-filled_quantity),0) into v_selling from public.live_orders where owner_id=p_owner_id and agent_id=p_agent_id
      and side='SELL' and status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','UNKNOWN');
    if coalesce(v_held,0) - v_selling < p_quantity then raise exception 'ATLAS_LIVE_NOT_ENOUGH_SHARES'; end if;
  end if;
  insert into public.live_orders(owner_id,agent_id,ticker,symbol,side,quantity,limit_price,reserved_cash,paper_order_id,reason)
  values(p_owner_id,p_agent_id,v_ticker,v_symbol,p_side,p_quantity,p_limit,case when p_side='BUY' then v_value+v_fee else 0 end,p_paper_order_id,left(p_reason,500))
  returning * into v_row;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'ATLAS','LIVE_ORDER_CREATED','live_order',v_row.id::text,
    jsonb_build_object('agentId',p_agent_id,'symbol',v_symbol,'side',p_side,'quantity',p_quantity,'limit',p_limit::text));
  return v_row;
end $$;

-- Status from the executor. PENDING becomes DISPATCHED before the broker call (crash-safe);
-- final states are immutable; the buy reservation is released once every reported fill is in.
create function public.live_mark_order(p_owner_id uuid,p_order_id uuid,p_status text,p_broker_order_id text,p_broker_filled integer,p_error text)
returns public.live_orders language plpgsql security definer set search_path='' as $$
declare v_row public.live_orders;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_row from public.live_orders where id=p_order_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_LIVE_ORDER_NOT_FOUND'; end if;
  if v_row.status in ('FILLED','CANCELLED','REJECTED','EXPIRED') then
    if p_status = v_row.status then return v_row; end if;
    raise exception 'ATLAS_LIVE_ORDER_FINAL';
  end if;
  if not (
    (v_row.status = 'PENDING' and p_status in ('DISPATCHED','REJECTED')) or
    (v_row.status in ('DISPATCHED','UNKNOWN') and p_status in ('OPEN','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED','EXPIRED','UNKNOWN')) or
    (v_row.status in ('OPEN','PARTIALLY_FILLED') and p_status in ('OPEN','PARTIALLY_FILLED','FILLED','CANCELLED','EXPIRED','UNKNOWN'))
  ) then raise exception 'ATLAS_LIVE_INVALID_TRANSITION'; end if;
  if v_row.broker_order_id is not null and p_broker_order_id is distinct from v_row.broker_order_id and p_broker_order_id is not null then
    raise exception 'ATLAS_LIVE_BROKER_ID_MISMATCH'; end if;
  if p_broker_filled is not null and (p_broker_filled < v_row.broker_filled or p_broker_filled > v_row.quantity) then
    raise exception 'ATLAS_LIVE_INVALID_FILLED'; end if;
  update public.live_orders set status=p_status,
    broker_order_id=coalesce(broker_order_id,p_broker_order_id),
    broker_filled=coalesce(p_broker_filled,broker_filled),
    error=coalesce(left(p_error,300),error),
    dispatched_at=case when p_status='DISPATCHED' then now() else dispatched_at end,
    reserved_cash=case when p_status in ('CANCELLED','REJECTED','EXPIRED','FILLED') and filled_quantity >= coalesce(p_broker_filled,broker_filled) then 0 else reserved_cash end,
    updated_at=now()
  where id=p_order_id returning * into v_row;
  return v_row;
end $$;

-- One broker deal. Idempotent by execution id; deals of orders ATLAS did not send are ignored.
-- Fees: the first fill of an order pays the fixed brokerage; every fill pays B3's ~0,03%.
create function public.live_record_fill(p_owner_id uuid,p_fill jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare v_order public.live_orders; v_existing public.live_fills; v_qty integer; v_price numeric; v_value numeric; v_fee numeric;
  v_pos public.live_positions; v_basis numeric := 0; v_pnl numeric := 0;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_existing from public.live_fills where execution_id=p_fill->>'executionId';
  if found then
    if v_existing.quantity <> (p_fill->>'quantity')::integer or v_existing.price <> (p_fill->>'price')::numeric then raise exception 'ATLAS_LIVE_FILL_CONFLICT'; end if;
    return 'DUPLICATE';
  end if;
  select * into v_order from public.live_orders where owner_id=p_owner_id and broker_order_id=p_fill->>'brokerOrderId' for update;
  if not found then return 'NOT_ATLAS'; end if;
  v_qty := (p_fill->>'quantity')::integer; v_price := (p_fill->>'price')::numeric;
  if v_qty is null or v_qty <= 0 or v_price is null or v_price <= 0 or v_order.filled_quantity + v_qty > v_order.quantity
     or (p_fill->>'side') is distinct from v_order.side then raise exception 'ATLAS_LIVE_INVALID_FILL'; end if;
  v_value := round(v_qty * v_price, 2);
  v_fee := ceil(v_value*3/10000*100)/100 + case when v_order.filled_quantity = 0 then (case when v_order.symbol = v_order.ticker then 2.99 else 0.99 end) else 0 end;
  insert into public.live_positions(owner_id,agent_id,ticker) values(p_owner_id,v_order.agent_id,v_order.ticker) on conflict do nothing;
  select * into v_pos from public.live_positions where owner_id=p_owner_id and agent_id=v_order.agent_id and ticker=v_order.ticker for update;
  if v_order.side = 'BUY' then
    update public.live_positions set quantity=quantity+v_qty,cost=cost+v_value+v_fee,updated_at=now()
      where owner_id=p_owner_id and agent_id=v_order.agent_id and ticker=v_order.ticker;
  else
    if v_pos.quantity < v_qty then raise exception 'ATLAS_LIVE_SHORT_FILL'; end if;
    v_basis := case when v_pos.quantity = v_qty then v_pos.cost else round(v_pos.cost * v_qty / v_pos.quantity, 2) end;
    v_pnl := v_value - v_fee - v_basis;
    update public.live_positions set quantity=quantity-v_qty,cost=cost-v_basis,realized_pnl=realized_pnl+v_pnl,updated_at=now()
      where owner_id=p_owner_id and agent_id=v_order.agent_id and ticker=v_order.ticker;
  end if;
  insert into public.live_fills(execution_id,owner_id,order_id,agent_id,ticker,side,quantity,price,fee,realized_pnl,executed_at)
  values(p_fill->>'executionId',p_owner_id,v_order.id,v_order.agent_id,v_order.ticker,v_order.side,v_qty,v_price,v_fee,v_pnl,(p_fill->>'executedAt')::timestamptz);
  update public.live_orders set filled_quantity=filled_quantity+v_qty,
    broker_filled=greatest(broker_filled,filled_quantity+v_qty),
    status=case when filled_quantity+v_qty = quantity then 'FILLED' when status in ('DISPATCHED','OPEN','UNKNOWN') then 'PARTIALLY_FILLED' else status end,
    reserved_cash=case when filled_quantity+v_qty = quantity or status in ('CANCELLED','REJECTED','EXPIRED') then 0
      when side='BUY' then greatest(0,reserved_cash-v_value-v_fee) else reserved_cash end,
    updated_at=now()
  where id=v_order.id;
  return 'RECORDED';
end $$;

-- Emergency stop from the executor (reconciliation mismatch, rejected for lack of money, ...).
create function public.live_halt(p_owner_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform atlas_private.require_owner(p_owner_id);
  update public.live_settings set enabled=false,enabled_at=null,updated_at=now() where owner_id=p_owner_id;
  update public.system_state set live_trading_enabled=false,global_kill_switch=true,kill_switch_reason=left(coalesce(p_reason,'Parada automática.'),300),updated_at=now()
    where owner_id=p_owner_id;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'ATLAS','LIVE_HALTED','live_settings',p_owner_id::text,jsonb_build_object('reason',p_reason));
end $$;

do $$ declare f text; begin
  foreach f in array array['public.set_live_settings(uuid,boolean,numeric,integer,text)','public.set_agent_real_budget(uuid,uuid,numeric)',
    'public.live_create_order(uuid,uuid,text,integer,numeric,text,uuid)','public.live_mark_order(uuid,uuid,text,text,integer,text)',
    'public.live_record_fill(uuid,jsonb)','public.live_halt(uuid,text)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
revoke all on function atlas_private.live_agent_room(uuid,uuid) from public,anon,authenticated,service_role;
commit;
