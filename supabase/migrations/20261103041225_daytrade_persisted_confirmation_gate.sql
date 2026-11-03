begin;

-- The server API already arms paper trading only when owner execution settings are
-- confirmed. Enforce the same invariant at the database boundary so a service call
-- cannot arm entries with forged or stale risk/cost parameters. Exits still flow
-- through the paper engine when the confirmation is missing or no longer matches.
alter function public.dt_apply_paper_bar(jsonb) rename to dt_apply_paper_bar_before_persisted_confirmation;
revoke all on function public.dt_apply_paper_bar_before_persisted_confirmation(jsonb)
  from public, anon, authenticated, service_role;

create function public.dt_apply_paper_bar(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event jsonb := p_event;
  v_settings public.dt_settings%rowtype;
  v_config jsonb;
  v_confirmed boolean := false;
begin
  if p_event is null or pg_catalog.jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'invalid paper event';
  end if;

  if coalesce((p_event->>'enabled')::boolean, false) then
    select s.* into v_settings
      from public.dt_settings s
      where s.owner_id = nullif(p_event->>'owner_id', '')::uuid
      for update;
    v_config := v_settings.execution_config;

    if found
      and v_settings.execution_confirmed_at is not null
      and v_config->'confirmSource' = 'true'::jsonb
      and pg_catalog.char_length(pg_catalog.btrim(v_settings.execution_source_note)) >= 8
      and v_settings.execution_source_note = v_config->>'sourceNote'
      and pg_catalog.jsonb_typeof(v_config->'capitalBudget') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'marginPerContract') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'brokeragePerContract') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'exchangeFeesPerContract') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'slippageTicks') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'maxLossPerTrade') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'maxLossPerDay') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'maxExposure') = 'number'
      and pg_catalog.jsonb_typeof(v_config->'lastEntry') = 'string'
      and pg_catalog.jsonb_typeof(v_config->'flatBy') = 'string'
      and p_event->>'last_entry' = v_config->>'lastEntry'
      and p_event->>'flat_by' = v_config->>'flatBy'
    then
      v_confirmed := true;
      -- JSON numeric types do not guarantee that a hostile event string can be cast.
      -- A malformed event disarms entries while leaving existing position exits alive.
      begin
        v_confirmed :=
          (p_event->>'capital_budget')::numeric = (v_config->>'capitalBudget')::numeric
          and (p_event->>'margin_per_contract')::numeric = (v_config->>'marginPerContract')::numeric
          and (p_event->>'fee_per_side')::numeric =
            (v_config->>'brokeragePerContract')::numeric + (v_config->>'exchangeFeesPerContract')::numeric
          and (p_event->>'slippage_ticks')::numeric = (v_config->>'slippageTicks')::numeric
          and (p_event->>'max_loss_per_trade')::numeric = (v_config->>'maxLossPerTrade')::numeric
          and (p_event->>'max_loss_per_day')::numeric = (v_config->>'maxLossPerDay')::numeric
          and (p_event->>'max_exposure')::numeric = (v_config->>'maxExposure')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          v_confirmed := false;
      end;
    end if;

    if not v_confirmed then
      v_event := pg_catalog.jsonb_set(p_event, '{enabled}', 'false'::jsonb, true);
    end if;
  end if;

  return public.dt_apply_paper_bar_before_persisted_confirmation(v_event);
end $$;

revoke all on function public.dt_apply_paper_bar(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar(jsonb) to service_role;

commit;
