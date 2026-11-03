begin;

-- Match the paper engine's position exits to the candidate's out-of-sample rules:
-- a close through EMA 9 or VWAP queues an exit for the next minute open.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_match_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.dt_apply_paper_bar_before_session_gate(jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'Paper engine function was not found; refusing to change its strategy exits';
  end if;

  v_old := '  v_signal text := coalesce(p_event->>''signal'',''NO_SETUP'');';
  v_new := v_old || E'\n  v_ema_fast numeric := nullif(p_event->>''ema_fast'','''')::numeric;\n  v_vwap numeric := nullif(p_event->>''vwap'','''')::numeric;';
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then raise exception 'Expected one signal declaration, found %', v_match_count; end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := 'or v_close <= 0 or v_signal not in (''INSUFFICIENT_DATA'',''WAITING_FOR_OPENING_RANGE'',''NO_SETUP'',''WATCH_LONG'',''WATCH_SHORT'')';
  v_new := 'or v_close <= 0 or (v_ema_fast is not null and v_ema_fast <= 0) or (v_vwap is not null and v_vwap <= 0) or v_signal not in (''INSUFFICIENT_DATA'',''WAITING_FOR_OPENING_RANGE'',''NO_SETUP'',''WATCH_LONG'',''WATCH_SHORT'')';
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then raise exception 'Expected one paper signal validation, found %', v_match_count; end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := '((v_state.position_side=1 and v_signal=''WATCH_SHORT'') or (v_state.position_side=-1 and v_signal=''WATCH_LONG''))';
  v_new := '((v_state.position_side=1 and (v_signal=''WATCH_SHORT'' or (v_ema_fast is not null and v_close < v_ema_fast) or (v_vwap is not null and v_close < v_vwap))) or (v_state.position_side=-1 and (v_signal=''WATCH_LONG'' or (v_ema_fast is not null and v_close > v_ema_fast) or (v_vwap is not null and v_close > v_vwap))))';
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then raise exception 'Expected one opposite-signal exit condition, found %', v_match_count; end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  execute v_definition;
end
$migration$;

commit;
