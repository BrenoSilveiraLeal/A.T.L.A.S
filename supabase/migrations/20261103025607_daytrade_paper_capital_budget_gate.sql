begin;

-- Enforce the DASH-only paper capital allocation at the database boundary as well as
-- in application readiness. This is a fixed allocation ceiling, not a balance ledger.
alter function public.dt_apply_paper_bar(jsonb) rename to dt_apply_paper_bar_before_capital_budget;
revoke all on function public.dt_apply_paper_bar_before_capital_budget(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar_before_capital_budget(jsonb) to service_role;

create function public.dt_apply_paper_bar(p_event jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_enabled boolean := coalesce((p_event->>'enabled')::boolean,false);
  v_budget numeric;
  v_exposure numeric;
begin
  if p_event is null or jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'invalid paper event';
  end if;

  if v_enabled then
    if p_event->>'capital_budget' in ('NaN','Infinity','-Infinity') or
       p_event->>'max_exposure' in ('NaN','Infinity','-Infinity') then
      raise exception 'invalid paper capital budget';
    end if;
    v_budget := nullif(p_event->>'capital_budget','')::numeric;
    v_exposure := nullif(p_event->>'max_exposure','')::numeric;
    if v_budget is null or v_budget <= 0 or v_exposure is null or
       v_exposure <= 0 or v_exposure > v_budget then
      raise exception 'invalid paper capital budget';
    end if;
  end if;

  return public.dt_apply_paper_bar_before_capital_budget(p_event);
end $$;

revoke all on function public.dt_apply_paper_bar(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar(jsonb) to service_role;

commit;
