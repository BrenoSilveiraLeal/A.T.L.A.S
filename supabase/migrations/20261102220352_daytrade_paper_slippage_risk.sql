do $migration$
declare
  v_oid regprocedure := 'public.dt_apply_paper_bar_before_session_gate(jsonb)'::regprocedure;
  v_definition text;
  v_old text := '+ 2*v_fee + 2*v_slip_ticks*v_tick*v_point;';
  v_new text := '+ 2*v_fee + v_slip_ticks*v_tick*v_point;';
  v_updated text;
begin
  v_definition := pg_get_functiondef(v_oid);
  if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
    raise exception 'Expected exactly one paper-risk slippage expression';
  end if;
  v_updated := replace(v_definition, v_old, v_new);
  execute v_updated;
end
$migration$;
