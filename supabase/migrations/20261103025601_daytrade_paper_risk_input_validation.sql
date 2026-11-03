begin;

-- Revalidate the complete simulated risk envelope inside Postgres. The API validates
-- configuration too, but this transaction is the authoritative boundary before a paper fill.
alter function public.dt_apply_paper_bar(jsonb) rename to dt_apply_paper_bar_before_input_validation;
revoke all on function public.dt_apply_paper_bar_before_input_validation(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar_before_input_validation(jsonb) to service_role;

create function public.dt_apply_paper_bar(p_event jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_enabled boolean := coalesce((p_event->>'enabled')::boolean,false);
  v_point numeric;
  v_tick numeric;
  v_fee numeric;
  v_slippage numeric;
  v_loss_trade numeric;
  v_loss_day numeric;
  v_exposure numeric;
  v_margin numeric;
  v_max_trades integer;
  v_max_contracts integer;
  v_max_positions integer;
  v_last_entry text;
  v_flat_by text;
  v_stop numeric;
  v_signal text := p_event->>'signal';
begin
  if p_event is null or jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'invalid paper event';
  end if;

  -- Exits must remain possible when configuration or the session gate disables new entries.
  -- Validate the full numeric and time envelope only on events that may create an entry.
  if v_enabled then
    if p_event->>'point_value' in ('NaN','Infinity','-Infinity') or
       p_event->>'tick_size' in ('NaN','Infinity','-Infinity') or
       p_event->>'fee_per_side' in ('NaN','Infinity','-Infinity') or
       p_event->>'slippage_ticks' in ('NaN','Infinity','-Infinity') or
       p_event->>'max_loss_per_trade' in ('NaN','Infinity','-Infinity') or
       p_event->>'max_loss_per_day' in ('NaN','Infinity','-Infinity') or
       p_event->>'max_exposure' in ('NaN','Infinity','-Infinity') or
       p_event->>'margin_per_contract' in ('NaN','Infinity','-Infinity') then
      raise exception 'invalid paper risk configuration';
    end if;

    v_point := nullif(p_event->>'point_value','')::numeric;
    v_tick := nullif(p_event->>'tick_size','')::numeric;
    v_fee := nullif(p_event->>'fee_per_side','')::numeric;
    v_slippage := nullif(p_event->>'slippage_ticks','')::numeric;
    v_loss_trade := nullif(p_event->>'max_loss_per_trade','')::numeric;
    v_loss_day := nullif(p_event->>'max_loss_per_day','')::numeric;
    v_exposure := nullif(p_event->>'max_exposure','')::numeric;
    v_margin := nullif(p_event->>'margin_per_contract','')::numeric;
    v_max_trades := nullif(p_event->>'max_trades_per_day','')::integer;
    v_max_contracts := nullif(p_event->>'max_contracts','')::integer;
    v_max_positions := nullif(p_event->>'max_open_positions','')::integer;
    v_last_entry := p_event->>'last_entry';
    v_flat_by := p_event->>'flat_by';
    v_stop := nullif(p_event->>'stop','')::numeric;

    if v_point is null or v_point <= 0 or v_tick is null or v_tick <= 0 or
       v_fee is null or v_fee < 0 or v_slippage is null or v_slippage < 1 or
       v_slippage > 20 or v_slippage <> trunc(v_slippage) or
       v_loss_trade is null or v_loss_trade <= 0 or v_loss_day is null or
       v_loss_day < v_loss_trade or v_exposure is null or v_exposure <= 0 or
       v_margin is null or v_margin <= 0 or v_margin > v_exposure or
       v_max_trades is null or v_max_trades < 1 or v_max_trades > 50 or
       v_max_contracts is null or v_max_contracts < 1 or v_max_contracts > 10 or
       v_max_positions is null or v_max_positions < 1 or v_max_positions > 5 or
       v_last_entry is null or v_last_entry !~ '^(0[9]|1[0-9]):[0-5][0-9]$' or
       v_flat_by is null or v_flat_by !~ '^(0[9]|1[0-9]):[0-5][0-9]$' or
       v_last_entry >= v_flat_by then
      raise exception 'invalid paper risk configuration';
    end if;

    if v_signal in ('WATCH_LONG','WATCH_SHORT') and
       (v_stop is null or v_stop <= 0 or abs(v_stop/v_tick-round(v_stop/v_tick)) > 0.000000001) then
      raise exception 'invalid paper stop';
    end if;
  end if;

  return public.dt_apply_paper_bar_before_input_validation(p_event);
end $$;

revoke all on function public.dt_apply_paper_bar(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar(jsonb) to service_role;

commit;
