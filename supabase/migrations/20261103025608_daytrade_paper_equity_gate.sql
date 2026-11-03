begin;

-- Enforce the configured paper allocation against realized paper P&L and reserve margin
-- for concurrent positions. The settings row lock serializes all instruments per owner.
alter function public.dt_apply_paper_bar(jsonb) rename to dt_apply_paper_bar_before_equity_gate;
revoke all on function public.dt_apply_paper_bar_before_equity_gate(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar_before_equity_gate(jsonb) to service_role;

create function public.dt_apply_paper_bar(p_event jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_enabled boolean := coalesce((p_event->>'enabled')::boolean,false);
  v_owner uuid;
  v_instrument text;
  v_budget numeric;
  v_saved_budget numeric;
  v_exposure numeric;
  v_margin numeric;
  v_realized numeric;
  v_other_positions integer;
  v_max_positions integer;
  v_event jsonb := p_event;
begin
  if p_event is null or jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'invalid paper event';
  end if;

  if v_enabled then
    v_owner := nullif(p_event->>'owner_id','')::uuid;
    v_instrument := p_event->>'instrument';
    if p_event->>'capital_budget' in ('NaN','Infinity','-Infinity') or
       p_event->>'max_exposure' in ('NaN','Infinity','-Infinity') or
       p_event->>'margin_per_contract' in ('NaN','Infinity','-Infinity') then
      raise exception 'invalid paper capital budget';
    end if;
    v_budget := nullif(p_event->>'capital_budget','')::numeric;
    v_exposure := nullif(p_event->>'max_exposure','')::numeric;
    v_margin := nullif(p_event->>'margin_per_contract','')::numeric;
    v_max_positions := nullif(p_event->>'max_open_positions','')::integer;

    -- A service-role caller cannot arm paper with an unsaved or forged owner allocation.
    select nullif(s.execution_config->>'capitalBudget','')::numeric
      into v_saved_budget
      from public.dt_settings s
      where s.owner_id = v_owner
      for update;
    if v_saved_budget is null or v_budget is distinct from v_saved_budget or
       v_budget <= 0 or v_exposure is null or v_exposure <= 0 or v_exposure > v_budget or
       v_margin is null or v_margin <= 0 or v_max_positions is null or v_max_positions not between 1 and 5 then
      raise exception 'invalid paper capital budget';
    end if;

    select coalesce(sum(f.net_pnl),0) into v_realized
      from public.dt_paper_fills f
      where f.owner_id = v_owner and f.action = 'EXIT';
    select count(*)::integer into v_other_positions
      from public.dt_paper_state p
      where p.owner_id = v_owner and p.instrument <> v_instrument
        and (p.position_side <> 0 or p.pending_side <> 0);

    -- Profits and losses are cumulative across sessions. Existing/queued positions on
    -- other instruments reserve margin; the current instrument needs one contract of room.
    if v_other_positions >= v_max_positions or
       v_budget + v_realized - (v_other_positions * v_margin) < v_margin then
      v_event := jsonb_set(p_event, '{enabled}', 'false'::jsonb, true);
    end if;
  end if;

  return public.dt_apply_paper_bar_before_equity_gate(v_event);
end $$;

revoke all on function public.dt_apply_paper_bar(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar(jsonb) to service_role;

commit;
