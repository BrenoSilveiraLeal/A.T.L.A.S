begin;

-- Risk limits and strategy revisions are durable evidence. Changes create a new
-- record and agents explicitly select it; past analyses never change in place.
create trigger risk_profiles_immutable before update or delete on public.risk_profiles
for each row execute function atlas_private.reject_mutation();
revoke update, delete on public.risk_profiles from service_role;
revoke insert on public.strategy_versions from service_role;

create function atlas_private.valid_risk_limits(p_limits jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_key text; v_value numeric;
begin
  if jsonb_typeof(p_limits) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_limits)) <> 17 then return false; end if;
  foreach v_key in array array['maxPositionPerAgent','maxPortfolioExposure','maxOrderValue','maxDailyLoss',
    'maxWeeklyLoss','maxDrawdownBps','minCashReserve','maxSectorExposure','maxCorrelatedExposure','maxSlippageBps']
  loop
    if jsonb_typeof(p_limits->v_key) is distinct from 'string'
      or (p_limits->>v_key) !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' then return false; end if;
    v_value := (p_limits->>v_key)::numeric;
    if v_key not in ('minCashReserve','maxSlippageBps') and v_value <= 0 then return false; end if;
    if v_key in ('maxDrawdownBps','maxSlippageBps') and v_value > 10000 then return false; end if;
  end loop;
  foreach v_key in array array['maxOpenPositions','maxOrdersPerMinute','maxOrdersPerDay','maxQuoteAgeMs','maxBrokerSnapshotAgeMs','maxClockSkewMs']
  loop
    if jsonb_typeof(p_limits->v_key) is distinct from 'number'
      or (p_limits->>v_key) !~ '^[0-9]+$' then return false; end if;
    v_value := (p_limits->>v_key)::numeric;
    if v_key <> 'maxClockSkewMs' and v_value <= 0 then return false; end if;
    if v_key in ('maxOpenPositions','maxOrdersPerMinute') and v_value > 1000 then return false; end if;
    if v_key = 'maxOrdersPerDay' and v_value > 10000 then return false; end if;
    if v_key in ('maxQuoteAgeMs','maxBrokerSnapshotAgeMs') and v_value > 60000 then return false; end if;
    if v_key = 'maxClockSkewMs' and v_value > 5000 then return false; end if;
  end loop;
  if jsonb_typeof(p_limits->'newsEmergencyThreshold') is distinct from 'string'
    or (p_limits->>'newsEmergencyThreshold') !~ '^(0\.[0-9]{1,4}|1(\.0{1,4})?)$'
    or (p_limits->>'newsEmergencyThreshold')::numeric <= 0 then return false; end if;
  return true;
end $$;
revoke all on function atlas_private.valid_risk_limits(jsonb) from public,anon,authenticated;
grant execute on function atlas_private.valid_risk_limits(jsonb) to service_role;
alter table public.risk_profiles add constraint risk_profiles_complete_limits
  check (not configured or atlas_private.valid_risk_limits(limits));

alter table public.agents add column strategy_version_id uuid;
alter table public.strategy_versions add constraint strategy_version_strategy_owner_unique
  unique(id,strategy_id,owner_id);
alter table public.agents add constraint agent_pinned_strategy_version
  foreign key(strategy_version_id,strategy_id,owner_id)
  references public.strategy_versions(id,strategy_id,owner_id);

create function public.publish_observation_strategy(
  p_owner_id uuid,p_name text,p_description text,p_definition jsonb,p_strategy_id uuid default null
) returns public.strategy_versions language plpgsql security definer set search_path = '' as $$
declare v_strategy_id uuid; v_version public.strategy_versions; v_revision integer;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_name is null or length(trim(p_name)) not between 2 and 80
    or p_description is null or length(p_description)>1000 then raise exception 'ATLAS_INVALID_STRATEGY'; end if;
  if p_definition is distinct from '{"engine":"sma-observation/1.0.0","mode":"OBSERVE_ONLY","fastPeriod":20,"slowPeriod":50}'::jsonb
    then raise exception 'ATLAS_INVALID_OBSERVATION_VERSION'; end if;
  if p_strategy_id is null then
    insert into public.strategies(owner_id,name,description,active)
      values(p_owner_id,trim(p_name),trim(p_description),false) returning id into v_strategy_id;
  else
    select id into v_strategy_id from public.strategies
      where id=p_strategy_id and owner_id=p_owner_id for update;
    if not found then raise exception 'ATLAS_STRATEGY_NOT_FOUND'; end if;
    update public.strategies set name=trim(p_name),description=trim(p_description)
      where id=v_strategy_id and owner_id=p_owner_id;
  end if;
  select count(*)+1 into v_revision from public.strategy_versions where strategy_id=v_strategy_id;
  insert into public.strategy_versions(owner_id,strategy_id,version,definition,research_status)
    values(p_owner_id,v_strategy_id,v_revision::text,p_definition,'PENDING') returning * into v_version;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'OWNER','STRATEGY_VERSION_PUBLISHED','strategy_version',v_version.id::text,
      jsonb_build_object('strategyId',v_strategy_id,'version',v_version.version,'definition',p_definition,'researchStatus','PENDING'));
  return v_version;
end $$;

create function public.configure_agent_observation(
  p_owner_id uuid,p_agent_id uuid,p_version_id uuid,p_risk_profile_id uuid,p_interval_seconds integer
) returns public.agents language plpgsql security definer set search_path = '' as $$
declare v_agent public.agents; v_version public.strategy_versions; v_profile public.risk_profiles;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_agent from public.agents where id=p_agent_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
  if v_agent.lease_expires_at > clock_timestamp() then raise exception 'ATLAS_AGENT_BUSY'; end if;
  if v_agent.enabled then raise exception 'ATLAS_PAUSE_AGENT_FIRST'; end if;
  if v_agent.status in ('FIRED','DEAD') then raise exception 'ATLAS_AGENT_RETIRED'; end if;
  if p_interval_seconds is null or p_interval_seconds not between 300 and 86400 then raise exception 'ATLAS_INVALID_AGENT'; end if;
  if not exists(select 1 from public.assets where id=v_agent.asset_id and owner_id=p_owner_id and active)
    then raise exception 'ATLAS_ASSET_INACTIVE'; end if;
  select * into v_version from public.strategy_versions where id=p_version_id and owner_id=p_owner_id;
  if not found or v_version.definition is distinct from '{"engine":"sma-observation/1.0.0","mode":"OBSERVE_ONLY","fastPeriod":20,"slowPeriod":50}'::jsonb
    then raise exception 'ATLAS_INVALID_OBSERVATION_VERSION'; end if;
  select * into v_profile from public.risk_profiles where id=p_risk_profile_id and owner_id=p_owner_id and configured;
  if not found or not atlas_private.valid_risk_limits(v_profile.limits) then raise exception 'ATLAS_RISK_PROFILE_NOT_CONFIGURED'; end if;
  if v_agent.strategy_version_id = p_version_id and v_agent.risk_profile_id = p_risk_profile_id
    and v_agent.analysis_interval_seconds = p_interval_seconds then return v_agent; end if;
  update public.agents set strategy_id=v_version.strategy_id,strategy_version_id=v_version.id,
    risk_profile_id=v_profile.id,analysis_interval_seconds=p_interval_seconds,
    status='PAUSED',lease_token=null,lease_expires_at=null,updated_at=now()
    where id=p_agent_id and owner_id=p_owner_id returning * into v_agent;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
    values(p_owner_id,'OWNER','AGENT_CONFIGURATION_CHANGED','agent',p_agent_id::text,
      jsonb_build_object('versionId',v_version.id,'strategyId',v_version.strategy_id,'version',v_version.version,
        'riskProfileId',v_profile.id,'riskProfileVersion',v_profile.version,'intervalSeconds',p_interval_seconds,
        'definition',v_version.definition,'riskLimits',v_profile.limits));
  return v_agent;
end $$;

-- An analysis for a configured agent must persist the exact immutable definition
-- and risk profile used by that worker. Existing HOLD/order guards remain intact.
create function atlas_private.check_analysis_configuration() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_agent public.agents; v_version public.strategy_versions; v_profile public.risk_profiles; v_expected jsonb;
begin
  select * into v_agent from public.agents where id=new.agent_id and owner_id=new.owner_id;
  if v_agent.strategy_id is null and v_agent.strategy_version_id is null and v_agent.risk_profile_id is null then
    if new.inputs->'configuration' is not null and new.inputs->'configuration' is distinct from 'null'::jsonb
      then raise exception 'ATLAS_ANALYSIS_CONFIGURATION_MISMATCH'; end if;
    return new;
  end if;
  select * into v_version from public.strategy_versions where id=v_agent.strategy_version_id
    and strategy_id=v_agent.strategy_id and owner_id=new.owner_id;
  if not found then raise exception 'ATLAS_ANALYSIS_CONFIGURATION_MISMATCH'; end if;
  select * into v_profile from public.risk_profiles where id=v_agent.risk_profile_id and owner_id=new.owner_id and configured;
  if not found then raise exception 'ATLAS_ANALYSIS_CONFIGURATION_MISMATCH'; end if;
  v_expected := jsonb_build_object('strategyId',v_version.strategy_id,'versionId',v_version.id,'version',v_version.version,
    'definition',v_version.definition,'riskProfileId',v_profile.id,'riskProfileVersion',v_profile.version,'riskLimits',v_profile.limits);
  if new.inputs->'configuration' is distinct from v_expected
    or new.strategy_version is distinct from v_version.definition->>'engine'
    then raise exception 'ATLAS_ANALYSIS_CONFIGURATION_MISMATCH'; end if;
  return new;
end $$;
create trigger analysis_configuration_matches before insert on public.decisions
for each row execute function atlas_private.check_analysis_configuration();
revoke all on function atlas_private.check_analysis_configuration() from public,anon,authenticated,service_role;
revoke all on function public.publish_observation_strategy(uuid,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.configure_agent_observation(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.publish_observation_strategy(uuid,text,text,jsonb,uuid) to service_role;
grant execute on function public.configure_agent_observation(uuid,uuid,uuid,uuid,integer) to service_role;

commit;
