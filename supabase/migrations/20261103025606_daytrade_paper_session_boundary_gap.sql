begin;

-- An overnight interval is an expected session boundary, not a same-session data outage.
-- Keep the boundary-flat result and its new-day P&L instead of overwriting the action with
-- DATA_GAP_NO_ENTRY immediately after the position has already been flattened.
do $migration$
declare
  v_oid regprocedure := 'public.dt_apply_paper_bar_before_session_gate(jsonb)'::regprocedure;
  v_definition text;
  v_old text := 'v_gap := v_state.last_bar_at is not null and v_at - v_state.last_bar_at > interval ''60 seconds'';';
  v_new text := 'v_gap := v_state.session_day = v_day and v_state.last_bar_at is not null and v_at - v_state.last_bar_at > interval ''60 seconds'';';
  v_match_count integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then
    raise exception 'Expected exactly one same-session data-gap calculation, found %', v_match_count;
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

commit;
