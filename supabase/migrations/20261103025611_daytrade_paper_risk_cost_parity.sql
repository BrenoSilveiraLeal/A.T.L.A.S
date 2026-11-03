begin;

-- Keep the database paper-entry risk estimate aligned with the walk-forward model:
-- price distance from the unadjusted open to the stop, plus one adverse slippage
-- allowance for entry and one for stop exit, plus fees on both sides. The previous
-- expression included entry slippage in the price distance and then charged it twice
-- again, which conservatively counted three slippage legs instead of two.
do $migration$
declare
  -- Patch the core state machine beneath the later validation, capital, and equity wrappers.
  v_oid regprocedure := 'public.dt_apply_paper_bar_before_session_gate(jsonb)'::regprocedure;
  v_definition text;
  v_old text := 'v_risk := abs((v_open + v_state.pending_side*(v_slip_ticks*v_tick))-v_state.pending_stop)*v_point
        + 2*v_fee + v_slip_ticks*v_tick*v_point;';
  v_new text := 'v_risk := abs(v_open-v_state.pending_stop)*v_point
        + 2*v_fee + 2*v_slip_ticks*v_tick*v_point;';
  v_match_count integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then
    raise exception 'Expected exactly one paper entry-risk formula, found %', v_match_count;
  end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

commit;
