begin;
create function atlas_private.audit_configuration() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_record jsonb;
begin
  v_record := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values((v_record->>'owner_id')::uuid,'OWNER',tg_table_name||'_'||tg_op,tg_table_name,
    v_record->>'id',jsonb_build_object('operation',tg_op,'record',v_record));
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function atlas_private.audit_configuration() from public,anon,authenticated,service_role;
create trigger assets_audit after insert or update or delete on public.assets
for each row execute function atlas_private.audit_configuration();
create trigger risk_profiles_audit after insert or update or delete on public.risk_profiles
for each row execute function atlas_private.audit_configuration();
create trigger strategies_audit after insert or update or delete on public.strategies
for each row execute function atlas_private.audit_configuration();
commit;
