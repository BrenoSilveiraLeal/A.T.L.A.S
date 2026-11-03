begin;

-- Recheck the owner kill switch inside the serialized paper transaction. The shared row lock
-- makes a concurrent halt linearizable: either the current paper bar finishes before halt
-- commits, or the bar observes halted=true and cannot create a new entry. Exits still run.
do $migration$
declare
  v_oid regprocedure := 'public.dt_apply_paper_bar(jsonb)'::regprocedure;
  v_definition text;
  v_old text;
  v_new text;
  v_match_count integer;
begin
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if v_definition is null then
    raise exception 'Paper session gate function was not found';
  end if;

  v_old := E'  v_plan jsonb;\n  v_enabled boolean := coalesce((p_event->>''enabled'')::boolean,false);';
  v_new := E'  v_plan jsonb;\n  v_halted boolean;\n  v_enabled boolean := coalesce((p_event->>''enabled'')::boolean,false);';
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then raise exception 'Expected one session-gate declaration block, found %', v_match_count; end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := E'      select s.status, s.plan into v_status, v_plan\n        from public.dt_sessions s\n        where s.owner_id=v_owner and s.day=v_day\n        for share;';
  v_new := E'      select s.status, s.plan, c.halted into v_status, v_plan, v_halted\n        from public.dt_sessions s\n        join public.dt_settings c on c.owner_id=s.owner_id\n        where s.owner_id=v_owner and s.day=v_day\n        for share of s, c;';
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then raise exception 'Expected one persisted-session lock, found %', v_match_count; end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := E'    if v_status is distinct from ''OPEN''';
  v_new := E'    if v_halted is distinct from false\n      or v_status is distinct from ''OPEN''';
  v_match_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))) / pg_catalog.length(v_old);
  if v_match_count <> 1 then raise exception 'Expected one entry-gate condition, found %', v_match_count; end if;
  execute pg_catalog.replace(v_definition, v_old, v_new);
end
$migration$;

commit;
