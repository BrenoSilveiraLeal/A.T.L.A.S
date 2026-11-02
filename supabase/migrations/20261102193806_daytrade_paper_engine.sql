begin;

-- Forward paper trading is separate from broker positions and the financial ledger.
create table public.dt_paper_state (
  owner_id uuid not null references auth.users(id),
  instrument text not null check (instrument ~ '^[A-Z0-9$]{3,12}$'),
  session_day date not null,
  position_side smallint not null default 0 check (position_side in (-1,0,1)),
  entry_price numeric(28,10),
  stop_price numeric(28,10),
  point_value numeric(20,8),
  fee_per_side numeric(20,8),
  slippage_price numeric(20,8),
  pending_side smallint not null default 0 check (pending_side in (-1,0,1)),
  pending_stop numeric(28,10),
  exit_pending boolean not null default false,
  trades_today integer not null default 0 check (trades_today >= 0),
  realized_pnl_today numeric(28,10) not null default 0,
  last_bar_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(owner_id, instrument),
  check ((position_side = 0 and entry_price is null and stop_price is null) or (position_side <> 0 and entry_price > 0 and stop_price > 0)),
  check ((pending_side = 0 and pending_stop is null) or (pending_side <> 0 and pending_stop > 0))
);

create table public.dt_paper_fills (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  instrument text not null,
  strategy_version text not null,
  bar_at timestamptz not null,
  action text not null check (action in ('ENTRY','EXIT')),
  side text not null check (side in ('BUY','SELL')),
  quantity integer not null check (quantity = 1),
  price numeric(28,10) not null check (price > 0),
  fees numeric(20,8) not null check (fees >= 0),
  gross_pnl numeric(28,10),
  net_pnl numeric(28,10),
  reason text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, instrument, strategy_version, bar_at, action)
);
create index dt_paper_fills_recent on public.dt_paper_fills(owner_id, instrument, bar_at desc);

alter table public.dt_paper_state enable row level security;
alter table public.dt_paper_fills enable row level security;
revoke all on public.dt_paper_state, public.dt_paper_fills from public, anon, authenticated, service_role;
grant select on public.dt_paper_state, public.dt_paper_fills to authenticated;
grant select, insert, update on public.dt_paper_state to service_role;
grant select, insert on public.dt_paper_fills to service_role;
create policy owner_aal2_select on public.dt_paper_state for select to authenticated
  using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()));
create policy owner_aal2_select on public.dt_paper_fills for select to authenticated
  using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()));

-- This invoker RPC serializes each account/instrument and commits state plus fills atomically.
-- It has no broker calls, cannot change other DASH tables and is executable only by service_role.
create function public.dt_apply_paper_bar(p_event jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := (p_event->>'owner_id')::uuid;
  v_instrument text := p_event->>'instrument';
  v_version text := p_event->>'strategy_version';
  v_at timestamptz := (p_event->>'bar_at')::timestamptz;
  v_open numeric := (p_event->>'open')::numeric;
  v_high numeric := (p_event->>'high')::numeric;
  v_low numeric := (p_event->>'low')::numeric;
  v_close numeric := (p_event->>'close')::numeric;
  v_signal text := coalesce(p_event->>'signal','NO_SETUP');
  v_stop numeric := nullif(p_event->>'stop','')::numeric;
  v_enabled boolean := coalesce((p_event->>'enabled')::boolean,false);
  v_point numeric := nullif(p_event->>'point_value','')::numeric;
  v_tick numeric := nullif(p_event->>'tick_size','')::numeric;
  v_fee numeric := nullif(p_event->>'fee_per_side','')::numeric;
  v_slip_ticks numeric := nullif(p_event->>'slippage_ticks','')::numeric;
  v_max_loss_trade numeric := nullif(p_event->>'max_loss_per_trade','')::numeric;
  v_max_loss_day numeric := nullif(p_event->>'max_loss_per_day','')::numeric;
  v_max_exposure numeric := nullif(p_event->>'max_exposure','')::numeric;
  v_margin numeric := nullif(p_event->>'margin_per_contract','')::numeric;
  v_max_trades integer := nullif(p_event->>'max_trades_per_day','')::integer;
  v_max_contracts integer := nullif(p_event->>'max_contracts','')::integer;
  v_max_open_positions integer := nullif(p_event->>'max_open_positions','')::integer;
  v_last_entry text := p_event->>'last_entry';
  v_flat_by text := p_event->>'flat_by';
  v_day date;
  v_clock text;
  v_slip numeric;
  v_state public.dt_paper_state%rowtype;
  v_action text := 'NO_ACTION';
  v_exit numeric;
  v_gross numeric;
  v_net numeric;
  v_risk numeric;
  v_side_text text;
  v_gap boolean := false;
begin
  if v_owner is null or v_instrument is null or v_instrument !~ '^[A-Z0-9$]{3,12}$' or v_version is null or v_version <> 'opening-range-vwap-v1'
    or v_at is null or v_open is null or v_high is null or v_low is null or v_close is null or v_open <= 0 or v_low <= 0
    or v_high < greatest(v_open,v_close,v_low) or v_low > least(v_open,v_close,v_high)
    or v_close <= 0 or v_signal not in ('INSUFFICIENT_DATA','WAITING_FOR_OPENING_RANGE','NO_SETUP','WATCH_LONG','WATCH_SHORT')
    or (v_tick is not null and (abs(v_open/v_tick-round(v_open/v_tick))>0.000000001 or abs(v_high/v_tick-round(v_high/v_tick))>0.000000001 or abs(v_low/v_tick-round(v_low/v_tick))>0.000000001 or abs(v_close/v_tick-round(v_close/v_tick))>0.000000001)) then
    raise exception 'invalid paper bar input';
  end if;
  v_day := (v_at at time zone 'America/Sao_Paulo')::date;
  v_clock := to_char(v_at at time zone 'America/Sao_Paulo','HH24:MI');
  if v_tick is not null and v_slip_ticks is not null then v_slip := v_tick * v_slip_ticks; end if;

  insert into public.dt_paper_state(owner_id,instrument,session_day) values(v_owner,v_instrument,v_day)
    on conflict(owner_id,instrument) do nothing;
  select * into v_state from public.dt_paper_state where owner_id=v_owner and instrument=v_instrument for update;
  if v_state.last_bar_at is not null and v_at <= v_state.last_bar_at then
    return jsonb_build_object('action','DUPLICATE','positionSide',v_state.position_side,'realizedPnlToday',v_state.realized_pnl_today,'tradesToday',v_state.trades_today);
  end if;
  v_gap := v_state.last_bar_at is not null and v_at - v_state.last_bar_at > interval '60 seconds';

  -- A position may never cross a local trading day. Flatten at the first available open.
  if v_state.session_day <> v_day then
    if v_state.position_side <> 0 then
      v_exit := v_open - v_state.position_side * v_state.slippage_price;
      v_gross := v_state.position_side * (v_exit-v_state.entry_price) * v_state.point_value;
      v_net := v_gross - 2*v_state.fee_per_side;
      v_side_text := case when v_state.position_side=1 then 'SELL' else 'BUY' end;
      insert into public.dt_paper_fills(owner_id,instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason)
        values(v_owner,v_instrument,v_version,v_at,'EXIT',v_side_text,1,v_exit,v_state.fee_per_side,v_gross,v_net,'DAY_BOUNDARY_FLAT');
      v_state.realized_pnl_today := 0;
      v_action := 'DAY_BOUNDARY_FLAT';
    else v_state.realized_pnl_today := 0; end if;
    v_state.position_side := 0; v_state.entry_price := null; v_state.stop_price := null;
    v_state.pending_side := 0; v_state.pending_stop := null; v_state.exit_pending := false;
    v_state.trades_today := 0; v_state.session_day := v_day;
  end if;

  -- Missing minutes break the sample. Cancel entries and flatten any open paper position at
  -- the first available price with adverse slippage; never infer prices for missing candles.
  if v_gap then
    v_state.pending_side := 0; v_state.pending_stop := null; v_state.exit_pending := false;
    if v_state.position_side <> 0 then
      v_exit := v_open - v_state.position_side * v_state.slippage_price;
      v_gross := v_state.position_side * (v_exit-v_state.entry_price) * v_state.point_value;
      v_net := v_gross - 2*v_state.fee_per_side;
      v_side_text := case when v_state.position_side=1 then 'SELL' else 'BUY' end;
      insert into public.dt_paper_fills(owner_id,instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason)
        values(v_owner,v_instrument,v_version,v_at,'EXIT',v_side_text,1,v_exit,v_state.fee_per_side,v_gross,v_net,'DATA_GAP_FLAT');
      v_state.realized_pnl_today := v_state.realized_pnl_today + v_net;
      v_state.position_side := 0; v_state.entry_price := null; v_state.stop_price := null;
      v_state.point_value := null; v_state.fee_per_side := null; v_state.slippage_price := null;
      v_action := 'DATA_GAP_FLAT';
    else v_action := 'DATA_GAP_NO_ENTRY'; end if;
  end if;

  -- Stops always take priority over strategy exits. When a candle gaps through a stop, fill
  -- at the open plus adverse slippage; otherwise assume the stop price plus adverse slippage.
  if not v_gap and v_state.position_side <> 0 and
    ((v_state.position_side=1 and v_low <= v_state.stop_price) or (v_state.position_side=-1 and v_high >= v_state.stop_price)) then
    if v_state.position_side=1 then v_exit := least(v_open,v_state.stop_price)-v_state.slippage_price;
    else v_exit := greatest(v_open,v_state.stop_price)+v_state.slippage_price; end if;
    v_gross := v_state.position_side * (v_exit-v_state.entry_price) * v_state.point_value;
    v_net := v_gross - 2*v_state.fee_per_side;
    v_side_text := case when v_state.position_side=1 then 'SELL' else 'BUY' end;
    insert into public.dt_paper_fills(owner_id,instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason)
      values(v_owner,v_instrument,v_version,v_at,'EXIT',v_side_text,1,v_exit,v_state.fee_per_side,v_gross,v_net,'STOP');
    v_state.realized_pnl_today := v_state.realized_pnl_today + v_net;
    v_state.position_side := 0; v_state.entry_price := null; v_state.stop_price := null;
    v_state.point_value := null; v_state.fee_per_side := null; v_state.slippage_price := null; v_state.exit_pending := false;
    v_action := 'STOP_EXIT';
  elsif not v_gap and v_state.position_side <> 0 and v_state.exit_pending then
    v_exit := v_open - v_state.position_side * v_state.slippage_price;
    v_gross := v_state.position_side * (v_exit-v_state.entry_price) * v_state.point_value;
    v_net := v_gross - 2*v_state.fee_per_side;
    v_side_text := case when v_state.position_side=1 then 'SELL' else 'BUY' end;
    insert into public.dt_paper_fills(owner_id,instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason)
      values(v_owner,v_instrument,v_version,v_at,'EXIT',v_side_text,1,v_exit,v_state.fee_per_side,v_gross,v_net,case when v_state.exit_pending then 'SIGNAL_EXIT_NEXT_OPEN' else 'REVERSE_SIGNAL_NEXT_OPEN' end);
    v_state.realized_pnl_today := v_state.realized_pnl_today + v_net;
    v_state.position_side := 0; v_state.entry_price := null; v_state.stop_price := null;
    v_state.point_value := null; v_state.fee_per_side := null; v_state.slippage_price := null; v_state.exit_pending := false;
    v_action := 'SIGNAL_EXIT';
  elsif not v_gap and v_state.position_side <> 0 and v_flat_by is not null and v_clock >= v_flat_by then
    v_exit := v_close - v_state.position_side * v_state.slippage_price;
    v_gross := v_state.position_side * (v_exit-v_state.entry_price) * v_state.point_value;
    v_net := v_gross - 2*v_state.fee_per_side;
    v_side_text := case when v_state.position_side=1 then 'SELL' else 'BUY' end;
    insert into public.dt_paper_fills(owner_id,instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason)
      values(v_owner,v_instrument,v_version,v_at,'EXIT',v_side_text,1,v_exit,v_state.fee_per_side,v_gross,v_net,'SESSION_FLAT');
    v_state.realized_pnl_today := v_state.realized_pnl_today + v_net;
    v_state.position_side := 0; v_state.entry_price := null; v_state.stop_price := null;
    v_state.point_value := null; v_state.fee_per_side := null; v_state.slippage_price := null; v_state.exit_pending := false;
    v_action := 'SESSION_FLAT';
  elsif not v_gap and v_state.position_side <> 0 and
    ((v_state.position_side=1 and v_signal='WATCH_SHORT') or (v_state.position_side=-1 and v_signal='WATCH_LONG')) then
    v_state.exit_pending := true;
  end if;

  -- Fill an entry signalled on the previous completed bar at this bar's open, never at the
  -- signal bar's close. Enforce risk again using the actual simulated fill price.
  if not v_gap and v_state.position_side=0 and v_state.pending_side<>0 then
    if not v_enabled or v_clock >= v_last_entry or v_point is null or v_tick is null or v_fee is null or v_slip is null
      or v_max_loss_trade is null or v_max_loss_day is null or v_max_exposure is null or v_margin is null
      or v_max_trades is null or v_max_contracts is null or v_max_contracts<1 or v_max_open_positions is null or v_max_open_positions<1 or v_max_trades<=v_state.trades_today
      or v_state.realized_pnl_today <= -v_max_loss_day or v_margin > v_max_exposure then
      v_state.pending_side := 0; v_state.pending_stop := null; v_action := 'ENTRY_BLOCKED';
    else
      v_risk := abs((v_open + v_state.pending_side*(v_slip_ticks*v_tick))-v_state.pending_stop)*v_point
        + 2*v_fee + 2*v_slip_ticks*v_tick*v_point;
      if v_risk > v_max_loss_trade or
        (v_state.pending_side=1 and v_open + v_slip_ticks*v_tick <= v_state.pending_stop) or
        (v_state.pending_side=-1 and v_open - v_slip_ticks*v_tick >= v_state.pending_stop) then
        v_state.pending_side := 0; v_state.pending_stop := null; v_action := 'ENTRY_BLOCKED';
      else
        v_state.position_side := v_state.pending_side;
        v_state.entry_price := v_open + v_state.pending_side*(v_slip_ticks*v_tick);
        v_state.stop_price := v_state.pending_stop;
        v_state.point_value := v_point; v_state.fee_per_side := v_fee; v_state.slippage_price := v_slip_ticks*v_tick;
        v_state.pending_side := 0; v_state.pending_stop := null; v_state.trades_today := v_state.trades_today+1;
        v_side_text := case when v_state.position_side=1 then 'BUY' else 'SELL' end;
        insert into public.dt_paper_fills(owner_id,instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason)
          values(v_owner,v_instrument,v_version,v_at,'ENTRY',v_side_text,1,v_state.entry_price,v_fee,null,null,'NEXT_BAR_OPEN');
        v_action := 'ENTRY_FILLED';
        if (v_state.position_side=1 and v_low<=v_state.stop_price) or (v_state.position_side=-1 and v_high>=v_state.stop_price) then
          if v_state.position_side=1 then v_exit:=least(v_open,v_state.stop_price)-v_state.slippage_price;
          else v_exit:=greatest(v_open,v_state.stop_price)+v_state.slippage_price; end if;
          v_gross:=v_state.position_side*(v_exit-v_state.entry_price)*v_state.point_value; v_net:=v_gross-2*v_state.fee_per_side;
          v_side_text:=case when v_state.position_side=1 then 'SELL' else 'BUY' end;
          insert into public.dt_paper_fills(owner_id,instrument,strategy_version,bar_at,action,side,quantity,price,fees,gross_pnl,net_pnl,reason)
            values(v_owner,v_instrument,v_version,v_at,'EXIT',v_side_text,1,v_exit,v_state.fee_per_side,v_gross,v_net,'STOP_ON_ENTRY_BAR');
          v_state.realized_pnl_today:=v_state.realized_pnl_today+v_net; v_state.position_side:=0; v_state.entry_price:=null; v_state.stop_price:=null;
          v_state.point_value:=null; v_state.fee_per_side:=null; v_state.slippage_price:=null; v_action:='ENTRY_AND_STOP';
        end if;
      end if;
    end if;
  end if;

  -- A newly observed signal is queued for the next minute only. It is not an order.
  if not v_gap and v_enabled and v_state.position_side=0 and v_state.pending_side=0
    and v_action='NO_ACTION' and v_clock < v_last_entry and v_signal in ('WATCH_LONG','WATCH_SHORT') and v_stop is not null
    and v_state.trades_today < v_max_trades and v_state.realized_pnl_today > -v_max_loss_day then
    v_state.pending_side := case when v_signal='WATCH_LONG' then 1 else -1 end;
    v_state.pending_stop := v_stop;
    if v_action='NO_ACTION' then v_action:='ENTRY_QUEUED'; end if;
  end if;

  v_state.last_bar_at:=v_at; v_state.updated_at:=now();
  update public.dt_paper_state set session_day=v_state.session_day,position_side=v_state.position_side,entry_price=v_state.entry_price,
    stop_price=v_state.stop_price,point_value=v_state.point_value,fee_per_side=v_state.fee_per_side,slippage_price=v_state.slippage_price,
    pending_side=v_state.pending_side,pending_stop=v_state.pending_stop,exit_pending=v_state.exit_pending,trades_today=v_state.trades_today,
    realized_pnl_today=v_state.realized_pnl_today,last_bar_at=v_state.last_bar_at,updated_at=v_state.updated_at
    where owner_id=v_owner and instrument=v_instrument;
  return jsonb_build_object('action',v_action,'positionSide',v_state.position_side,'realizedPnlToday',v_state.realized_pnl_today,'tradesToday',v_state.trades_today,'lastBarAt',v_at);
end $$;

revoke all on function public.dt_apply_paper_bar(jsonb) from public, anon, authenticated;
grant execute on function public.dt_apply_paper_bar(jsonb) to service_role;

commit;
