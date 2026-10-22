-- 1. Optional AI reading of each headline (local Ollama or Anthropic), stored beside the
--    free keyword reading. Display only: it never starts a trade.
-- 2. "IA gestora": the owner applies suggested budgets in one step. The total of living
--    agents can never exceed the team's current total, and a cut may not push an agent's
--    simulated life below 25% (no surprise eliminations).
begin;

alter table public.news_items
  add column ai jsonb check(ai is null or jsonb_typeof(ai) = 'array'),
  add column ai_model text check(ai_model is null or length(ai_model) between 1 and 80),
  add column ai_at timestamptz;
grant update(ai, ai_model, ai_at) on public.news_items to service_role;

create function public.set_agent_budgets(p_owner_id uuid,p_budgets jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_pool numeric; v_total numeric; v_item jsonb; v_agent public.agents; v_budget numeric;
  v_vital public.paper_agent_vitals; v_max numeric; v_loss numeric; v_count integer := 0;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_budgets is null or jsonb_typeof(p_budgets) <> 'array' or jsonb_array_length(p_budgets) not between 1 and 100 then
    raise exception 'ATLAS_INVALID_BUDGETS'; end if;
  perform 1 from public.agents where owner_id=p_owner_id for update;
  select coalesce(sum(budget),0) into v_pool from public.agents where owner_id=p_owner_id;
  select coalesce(agent_max_loss_pct,20) into v_max from public.paper_accounts where owner_id=p_owner_id;
  v_max := coalesce(v_max,20);
  for v_item in select value from jsonb_array_elements(p_budgets) loop
    v_budget := (v_item->>'budget')::numeric;
    if v_budget is null or v_budget < 0 or v_budget > 100000000 or v_budget <> round(v_budget,2) then
      raise exception 'ATLAS_INVALID_BUDGETS'; end if;
    select * into v_agent from public.agents where id=(v_item->>'agentId')::uuid and owner_id=p_owner_id;
    if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
    if v_agent.status in ('DEAD','FIRED') then raise exception 'ATLAS_AGENT_ELIMINATED'; end if;
    select * into v_vital from public.paper_agent_vitals where owner_id=p_owner_id and agent_id=v_agent.id;
    if found and v_budget < v_agent.budget then
      v_loss := greatest(0, -(v_vital.realized_pnl + v_vital.unrealized_pnl));
      if v_budget = 0 or v_loss > v_budget*v_max/100*0.75 then raise exception 'ATLAS_BUDGET_WOULD_KILL_AGENT'; end if;
    end if;
    if v_budget <> v_agent.budget then
      update public.agents set budget=v_budget,updated_at=now() where id=v_agent.id;
      insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
      values(p_owner_id,'OWNER','AGENT_BUDGET_CHANGED','agent',v_agent.id::text,
        jsonb_build_object('from',v_agent.budget::text,'to',v_budget::text,'source','IA_GESTORA'));
      v_count := v_count + 1;
    end if;
  end loop;
  -- Eliminated agents free their budget: the living team shares at most the current team total.
  select coalesce(sum(budget),0) into v_total from public.agents where owner_id=p_owner_id and status not in ('DEAD','FIRED');
  if v_total > v_pool then raise exception 'ATLAS_BUDGETS_EXCEED_TEAM_TOTAL'; end if;
  return v_count;
end $$;
revoke all on function public.set_agent_budgets(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.set_agent_budgets(uuid,jsonb) to service_role;
commit;
