-- Execute only in the dedicated ATLAS project after deployment.
-- Enable pg_cron / pg_net through Integrations first.
-- In Vault create two secrets using the dashboard (never insert values in Git):
-- atlas_tick_url = https://<project-ref>.supabase.co/functions/v1/atlas-tick
-- atlas_cron_secret = same CRON_SECRET used by Edge + Next server.
do $$
declare v_job bigint;
begin
  if not exists(select 1 from vault.decrypted_secrets where name='atlas_tick_url')
    or not exists(select 1 from vault.decrypted_secrets where name='atlas_cron_secret') then
    raise exception 'Configure atlas_tick_url and atlas_cron_secret in Vault first';
  end if;
  for v_job in select jobid from cron.job where jobname='atlas-central-scheduler' loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule('atlas-central-scheduler','* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='atlas_tick_url'),
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name='atlas_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$);
end $$;
