begin;

alter table public.decisions add column analysis_job_id uuid unique references public.job_runs(id);

-- Commit evidence + decision + memory + job completion together, fencing expired workers.
-- This observation pipeline cannot approve or emit a trade proposal/order.
create function public.finish_agent_analysis(
  p_owner_id uuid, p_job_id uuid, p_lease_token uuid,
  p_result jsonb, p_inputs jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_job public.job_runs; v_agent public.agents; v_existing public.decisions;
  v_id uuid; v_agent_id uuid; v_stamp timestamptz;
begin
  perform atlas_private.require_owner(p_owner_id);
  select agent_id into v_agent_id from public.job_runs where id=p_job_id and owner_id=p_owner_id;
  if v_agent_id is null then raise exception 'ATLAS_JOB_NOT_FOUND'; end if;
  select * into v_agent from public.agents where id=v_agent_id and owner_id=p_owner_id for update;
  select * into v_job from public.job_runs where id=p_job_id and owner_id=p_owner_id for update;
  if p_lease_token is null or v_job.lease_token <> p_lease_token then raise exception 'ATLAS_LEASE_LOST'; end if;
  select * into v_existing from public.decisions where analysis_job_id=p_job_id and owner_id=p_owner_id;
  if found then
    if v_existing.result is distinct from p_result or v_existing.inputs is distinct from p_inputs then
      raise exception 'ATLAS_ANALYSIS_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing.id;
  end if;
  if v_job.status <> 'RUNNING' or v_job.lease_expires_at <= clock_timestamp() or not v_agent.enabled
    or v_agent.lease_token is distinct from p_lease_token then raise exception 'ATLAS_LEASE_LOST'; end if;
  if jsonb_typeof(p_result) is distinct from 'object' or jsonb_typeof(p_inputs) is distinct from 'object'
    or p_result->>'decision' is distinct from 'HOLD'
    or p_result->>'strategyVersion' is distinct from 'sma-observation/1.0.0'
    or p_result#>'{risk,approved}' is distinct from 'false'::jsonb
    or p_result->'suggestedQuantity' is distinct from '0'::jsonb
    or p_result->'suggestedOrderType' is distinct from 'null'::jsonb
    or p_result->'suggestedLimitPrice' is distinct from 'null'::jsonb
    or length(coalesce(p_result->>'reasoningSummary','')) not between 1 and 4000
    or jsonb_typeof(p_result->'sources') is distinct from 'array'
    or octet_length(p_result::text)>65536
    or octet_length(p_inputs::text)>1048576 then raise exception 'ATLAS_INVALID_ANALYSIS'; end if;
  if jsonb_array_length(p_result->'sources') not between 1 and 50
    or exists(select 1 from jsonb_array_elements(p_result->'sources') s
      where jsonb_typeof(s) <> 'string' or length(s#>>'{}')>2048 or (s#>>'{}') !~ '^https://')
    or p_inputs#>>'{quote,ticker}' is distinct from p_result->>'ticker'
    or p_inputs#>>'{history,ticker}' is distinct from p_result->>'ticker'
    or p_inputs#>>'{quote,dataTimestamp}' is distinct from p_result->>'dataTimestamp'
    or p_inputs#>'{quote,tradable}' is distinct from 'false'::jsonb
    or p_inputs#>'{history,tradable}' is distinct from 'false'::jsonb then raise exception 'ATLAS_INVALID_ANALYSIS_EVIDENCE'; end if;
  if not exists(select 1 from public.assets where id=v_agent.asset_id and ticker=p_result->>'ticker' and owner_id=p_owner_id) then raise exception 'ATLAS_ANALYSIS_ASSET_MISMATCH'; end if;
  v_stamp := (p_result->>'dataTimestamp')::timestamptz;
  if v_stamp is null or not isfinite(v_stamp) or v_stamp>clock_timestamp() then raise exception 'ATLAS_INVALID_ANALYSIS_TIME'; end if;
  insert into public.decisions(owner_id,agent_id,asset_id,correlation_id,decision,strategy_version,
    reasoning_summary,inputs,result,sources,data_timestamp,analysis_job_id)
  values(p_owner_id,v_agent.id,v_agent.asset_id,v_job.correlation_id,'HOLD',p_result->>'strategyVersion',
    p_result->>'reasoningSummary',p_inputs,p_result,p_result->'sources',v_stamp,p_job_id) returning id into v_id;
  insert into public.agent_memories(owner_id,agent_id,event_key,summary,sources)
  values(p_owner_id,v_agent.id,'analysis:'||p_job_id,p_result->>'reasoningSummary',p_result->'sources');
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,correlation_id,details)
  values(p_owner_id,'SCHEDULER','ANALYSIS_COMMITTED','decision',v_id::text,v_job.correlation_id,
    jsonb_build_object('jobId',p_job_id,'strategyVersion',p_result->>'strategyVersion','decision','HOLD','risk',p_result->'risk'));
  if not public.complete_agent_job(p_owner_id,p_job_id,p_lease_token,'SUCCEEDED') then raise exception 'ATLAS_LEASE_LOST'; end if;
  return v_id;
end $$;
revoke all on function public.finish_agent_analysis(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_agent_analysis(uuid,uuid,uuid,jsonb,jsonb) to service_role;
commit;
