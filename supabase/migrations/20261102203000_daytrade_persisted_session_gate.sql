begin;

-- Preserve the paper engine but place a database-enforced session check in front of entries.
-- The ProfitDLL ingestion endpoint is the only application path that writes dt_sessions, and this RPC remains
-- executable only by service_role. A bad/missing session blocks new entries while still allowing
-- the existing engine to process its normal exits and state transitions.
alter function public.dt_apply_paper_bar(jsonb) rename to dt_apply_paper_bar_before_session_gate;
revoke all on function public.dt_apply_paper_bar_before_session_gate(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar_before_session_gate(jsonb) to service_role;

create function public.dt_apply_paper_bar(p_event jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_event jsonb := p_event;
  v_owner uuid;
  v_at timestamptz;
  v_day date;
  v_clock text;
  v_status text;
  v_plan jsonb;
  v_enabled boolean := coalesce((p_event->>'enabled')::boolean,false);
begin
  v_owner := nullif(p_event->>'owner_id','')::uuid;
  v_at := nullif(p_event->>'bar_at','')::timestamptz;
  if v_at is not null and v_at > now() then
    raise exception 'future paper bar is not allowed';
  end if;

  if v_enabled then
    if v_owner is not null and v_at is not null then
      v_day := (v_at at time zone 'America/Sao_Paulo')::date;
      v_clock := to_char(v_at at time zone 'America/Sao_Paulo','HH24:MI');
      select s.status, s.plan into v_status, v_plan
        from public.dt_sessions s
        where s.owner_id=v_owner and s.day=v_day
        for share;
    end if;
    if v_status is distinct from 'OPEN'
      or v_plan->>'instrument' is distinct from p_event->>'instrument'
      or v_plan->>'open' is null or v_plan->>'close' is null
      or v_clock < v_plan->>'open' or v_clock >= v_plan->>'close' then
      v_event := p_event || '{"enabled":false}'::jsonb;
    end if;
  end if;

  return public.dt_apply_paper_bar_before_session_gate(v_event);
end $$;

revoke all on function public.dt_apply_paper_bar(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar(jsonb) to service_role;

commit;
