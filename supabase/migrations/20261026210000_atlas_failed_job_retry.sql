-- 26/10/2026: Rafa (B3SA3) never analysed after being hired: two quote failures on 24/10 left him
-- RISK_BLOCKED, and claim_due_agents skips that status forever. A failed analysis now only waits for
-- the next turn (the error stays in job_runs and the owner is told); agents stuck that way resume.
begin;

create or replace function public.complete_agent_job(p_owner_id uuid,p_job_id uuid,p_lease_token uuid,p_status text,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_job public.job_runs; v_agent_id uuid;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_status is null or p_status not in ('SUCCEEDED','FAILED') then raise exception 'ATLAS_INVALID_JOB_STATUS'; end if;
  -- Match claim/finish lock order (agent, then job) to avoid a completion/claim deadlock.
  select agent_id into v_agent_id from public.job_runs where id=p_job_id and owner_id=p_owner_id;
  if v_agent_id is null then return false; end if;
  perform 1 from public.agents where id=v_agent_id and owner_id=p_owner_id for update;
  select * into v_job from public.job_runs where id=p_job_id and owner_id=p_owner_id for update;
  if not found or v_job.status <> 'RUNNING' or v_job.lease_token <> p_lease_token or p_lease_token is null or v_job.lease_expires_at <= clock_timestamp() then return false; end if;
  update public.agents set last_analysis_at=case when p_status='SUCCEEDED' then now() else last_analysis_at end,
    next_analysis_at=now()+make_interval(secs=>analysis_interval_seconds),lease_token=null,lease_expires_at=null,
    status='IDLE',updated_at=now()
    where id=v_job.agent_id and owner_id=p_owner_id and lease_token=p_lease_token;
  if not found then return false; end if;
  update public.job_runs set status=p_status,error_code=left(p_error,200),completed_at=now() where id=p_job_id;
  return true;
end $$;

update public.agents set status='IDLE', next_analysis_at=least(next_analysis_at, now()), updated_at=now() where status='RISK_BLOCKED';

commit;
