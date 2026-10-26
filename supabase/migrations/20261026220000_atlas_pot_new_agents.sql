-- 26/10/2026: six agents hired with real_budget 0, so the real-money executor (agents with
-- real_budget > 0) would never send their orders. Like register_deposit does for the team, a newly
-- hired agent may draw on the whole pot; the limit that matters stays live_agent_room (free money).
begin;

create function atlas_private.agent_draws_on_pot() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_ceiling numeric;
begin
  select ceiling into v_ceiling from public.capital_plans where owner_id=new.owner_id;
  if v_ceiling is not null and v_ceiling > 0 then new.budget := v_ceiling; new.real_budget := v_ceiling; end if;
  return new;
end $$;
revoke all on function atlas_private.agent_draws_on_pot() from public,anon,authenticated,service_role;
create trigger agents_draw_on_pot before insert on public.agents for each row execute function atlas_private.agent_draws_on_pot();

update public.agents a set budget=c.ceiling, real_budget=c.ceiling, updated_at=now()
  from public.capital_plans c where c.owner_id=a.owner_id and a.status not in ('DEAD','FIRED');

commit;
