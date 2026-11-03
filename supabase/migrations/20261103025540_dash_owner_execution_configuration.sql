begin;

-- Owner-entered account-specific paper settings are stored server-side and remain
-- separate from the public, source-controlled instrument defaults.
alter table public.dt_settings
  add column execution_config jsonb not null default '{}'::jsonb,
  add column execution_source_note text not null default '',
  add column execution_confirmed_at timestamptz,
  add constraint dt_settings_execution_config_object
    check (pg_catalog.jsonb_typeof(execution_config) = 'object'),
  add constraint dt_settings_execution_source_note_length
    check (pg_catalog.char_length(execution_source_note) <= 240),
  add constraint dt_settings_execution_confirmation_source
    check (execution_confirmed_at is null or pg_catalog.char_length(pg_catalog.btrim(execution_source_note)) >= 8);

-- Persist the owner configuration and its append-only audit entry as one transaction.
create function public.dt_save_execution_config(
  p_owner_id uuid,
  p_execution_config jsonb,
  p_source_note text,
  p_confirmed_at timestamptz,
  p_journal_message text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_owner_id is null or p_execution_config is null
    or pg_catalog.jsonb_typeof(p_execution_config) <> 'object'
    or p_source_note is null or pg_catalog.char_length(p_source_note) > 240
    or p_journal_message is null or pg_catalog.char_length(p_journal_message) > 1000
    or (p_confirmed_at is not null and pg_catalog.char_length(pg_catalog.btrim(p_source_note)) < 8) then
    raise exception 'invalid owner execution configuration';
  end if;

  insert into public.dt_settings (
    owner_id, execution_config, execution_source_note, execution_confirmed_at, updated_at
  ) values (p_owner_id, p_execution_config, p_source_note, p_confirmed_at, pg_catalog.now())
  on conflict (owner_id) do update set
    execution_config = excluded.execution_config,
    execution_source_note = excluded.execution_source_note,
    execution_confirmed_at = excluded.execution_confirmed_at,
    updated_at = excluded.updated_at;

  insert into public.dt_journal (owner_id, desk, state, message, at)
  values (p_owner_id, 'risk', case when p_confirmed_at is null then 'BLOCKED' else 'WORKING' end,
    p_journal_message, pg_catalog.now());
end;
$$;

revoke all on function public.dt_save_execution_config(uuid, jsonb, text, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.dt_save_execution_config(uuid, jsonb, text, timestamptz, text)
  to service_role;

commit;
