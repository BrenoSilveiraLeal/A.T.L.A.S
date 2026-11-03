begin;

-- A missed session flat can leave a paper position to be closed at the first available
-- open on the next trading day. Attribute that realized close to the new day's risk total
-- so a loss cannot silently reset the daily loss gate.
do $migration$
declare
  v_oid regprocedure := 'public.dt_apply_paper_bar_before_session_gate(jsonb)'::regprocedure;
  v_definition text;
  v_old text := E'      v_state.realized_pnl_today := 0;\n      v_action := ''DAY_BOUNDARY_FLAT'';';
  v_new text := E'      v_state.realized_pnl_today := v_net;\n      v_action := ''DAY_BOUNDARY_FLAT'';';
  v_updated text;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if v_definition is null or
    pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')) <> pg_catalog.length(v_old) then
    raise exception 'Expected exactly one day-boundary PnL reset in the paper engine';
  end if;
  v_updated := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_updated;
end
$migration$;

commit;
