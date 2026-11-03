begin;

-- Keep the SQL paper engine's timed flatten consistent with the backtest: when flatBy is reached,
-- the simulated exit belongs at the open of that minute, with adverse slippage applied.
do $migration$
declare
  v_definition text;
  v_old text := 'v_exit := v_close - v_state.position_side * v_state.slippage_price;';
  v_new text := 'v_exit := v_open - v_state.position_side * v_state.slippage_price;';
  v_match_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.dt_apply_paper_bar_before_session_gate(jsonb)'::pg_catalog.regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'Paper engine function was not found; refusing to alter the session flatten';
  end if;
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then
    raise exception 'Expected one session-flat exit expression, found %; refusing to alter the paper engine', v_match_count;
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

commit;
