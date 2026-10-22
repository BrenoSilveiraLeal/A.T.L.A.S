-- Corporate actions in the virtual book: official B3 events (cash dividends / JCP,
-- splits, groupings, bonus issues) adjust paper positions so they never fake a gain
-- or a loss. Still simulation only: no real ledger, order or broker table is touched.
begin;

alter table public.paper_events drop constraint paper_events_event_check;
alter table public.paper_events add constraint paper_events_event_check check(event in (
  'ACCOUNT_OPENED','PROPOSED','RISK_APPROVED','RISK_REJECTED','ORDER_OPENED','ORDER_FILLED',
  'ORDER_CANCELLED','ORDER_EXPIRED','PAUSED','RESUMED','AUTOPILOT_CHANGED','AGENT_ELIMINATED','CORPORATE_ACTION'));

create table public.paper_corporate_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  asset_id uuid not null,
  kind text not null check(kind in ('CASH','SPLIT','GROUPING','BONUS')),
  label text not null check(length(label) between 1 and 60),
  isin text not null check(isin ~ '^BR[A-Z0-9]{10}$'),
  value numeric(30,11) not null check(value > 0),
  last_date_prior date not null,
  payment_date date,
  source text not null check(source like 'https://%'),
  affected jsonb not null default '[]' check(jsonb_typeof(affected)='array'),
  applied_at timestamptz not null default now(),
  unique(owner_id,asset_id,kind,label,isin,last_date_prior,value),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id)
);
alter table public.paper_corporate_actions enable row level security;
revoke all on public.paper_corporate_actions from public,anon,authenticated,service_role;
grant select on public.paper_corporate_actions to authenticated,service_role;
create policy owner_aal2_select on public.paper_corporate_actions for select to authenticated
  using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()));

-- Applies one event once (idempotent by its natural key). Entitlement is the quantity each
-- agent held at the end of last_date_prior ("data com"), rebuilt from immutable fills.
-- CASH: credits held × rate (JCP net of 15% withholding) on/after payment_date, booked as
-- realized result. SPLIT/BONUS: value is the percentage added (300 = 1→4). GROUPING: value
-- is the multiplier (0.1 = 10→1); fractions are credited at p_reference_price.
create function public.paper_apply_corporate_action(p_owner_id uuid,p_asset_id uuid,p_kind text,p_label text,p_isin text,
  p_value numeric,p_last_date_prior date,p_payment_date date,p_reference_price numeric,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_account public.paper_accounts; v_action public.paper_corporate_actions; v_position public.paper_positions;
  v_cutoff timestamptz; v_held numeric; v_new integer; v_delta integer; v_amount numeric; v_basis numeric;
  v_tx uuid; v_affected jsonb := '[]'::jsonb; v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_account from public.paper_accounts where owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_PAPER_ACCOUNT_REQUIRED'; end if;
  if p_kind not in ('CASH','SPLIT','GROUPING','BONUS') or p_value is null or p_value <= 0 or p_last_date_prior is null or
    p_source not like 'https://%' or p_isin !~ '^BR[A-Z0-9]{10}$' or
    (p_kind='CASH' and (p_payment_date is null or p_payment_date > v_today)) or
    (p_kind<>'CASH' and p_last_date_prior >= v_today) or
    (p_kind='GROUPING' and (p_value >= 1 or p_reference_price is null or p_reference_price <= 0)) then
    raise exception 'ATLAS_PAPER_INVALID_CORPORATE_ACTION';
  end if;
  insert into public.paper_corporate_actions(owner_id,asset_id,kind,label,isin,value,last_date_prior,payment_date,source)
  values(p_owner_id,p_asset_id,p_kind,p_label,p_isin,p_value,p_last_date_prior,p_payment_date,p_source)
  on conflict do nothing returning * into v_action;
  if v_action.id is null then return jsonb_build_object('applied',false,'reason','ALREADY_APPLIED'); end if;
  v_cutoff := ((p_last_date_prior + 1)::timestamp at time zone 'America/Sao_Paulo');
  for v_position in select * from public.paper_positions where owner_id=p_owner_id and asset_id=p_asset_id for update loop
    select coalesce(sum(case when side='BUY' then quantity else -quantity end),0) into v_held from public.paper_fills
      where owner_id=p_owner_id and agent_id=v_position.agent_id and asset_id=p_asset_id and filled_at < v_cutoff;
    continue when v_held <= 0;
    if p_kind='CASH' then
      v_amount := round(v_held * p_value * case when p_label ilike '%JRS%' or p_label ilike '%JUROS%' then 0.85 else 1 end, 2);
      continue when v_amount <= 0;
      update public.paper_positions set realized_pnl=realized_pnl+v_amount,updated_at=now() where owner_id=p_owner_id and agent_id=v_position.agent_id and asset_id=p_asset_id;
      update public.paper_accounts set cash=cash+v_amount,updated_at=now() where owner_id=p_owner_id;
      v_tx := gen_random_uuid();
      insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
        values(p_owner_id,v_tx,'CASH',v_amount),(p_owner_id,v_tx,'REALIZED_PNL',-v_amount);
      v_affected := v_affected || jsonb_build_object('agentId',v_position.agent_id,'held',v_held,'cash',v_amount);
    else
      -- Shares acquired after the record date are untouched; the rest is converted.
      v_new := floor(v_held * case when p_kind='GROUPING' then p_value else 1 + p_value/100 end);
      v_delta := v_new - v_held::integer;
      v_basis := v_position.quantity * v_position.average_cost;
      update public.paper_positions set quantity=quantity+v_delta,
        average_cost=case when quantity+v_delta > 0 then round(v_basis/(quantity+v_delta),8) else 0 end,updated_at=now()
        where owner_id=p_owner_id and agent_id=v_position.agent_id and asset_id=p_asset_id;
      v_amount := 0;
      if p_kind='GROUPING' then
        -- Fractions are auctioned by the company; credit them at the reference price.
        v_amount := round((v_held * p_value - v_new) * p_reference_price, 2);
        if v_amount > 0 then
          update public.paper_accounts set cash=cash+v_amount,updated_at=now() where owner_id=p_owner_id;
          update public.paper_positions set realized_pnl=realized_pnl+v_amount where owner_id=p_owner_id and agent_id=v_position.agent_id and asset_id=p_asset_id;
          v_tx := gen_random_uuid();
          insert into public.paper_ledger_entries(owner_id,transaction_id,account_kind,amount)
            values(p_owner_id,v_tx,'CASH',v_amount),(p_owner_id,v_tx,'REALIZED_PNL',-v_amount);
        end if;
      end if;
      v_affected := v_affected || jsonb_build_object('agentId',v_position.agent_id,'held',v_held,'newShares',v_new,'cash',v_amount);
    end if;
  end loop;
  update public.paper_corporate_actions set affected=v_affected where id=v_action.id;
  insert into public.paper_events(owner_id,event,details) values(p_owner_id,'CORPORATE_ACTION',
    jsonb_build_object('assetId',p_asset_id,'kind',p_kind,'label',p_label,'value',p_value,'lastDatePrior',p_last_date_prior,
      'paymentDate',p_payment_date,'affected',v_affected,'source',p_source,'simulation',true));
  return jsonb_build_object('applied',true,'affected',v_affected);
end $$;

revoke all on function public.paper_apply_corporate_action(uuid,uuid,text,text,text,numeric,date,date,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.paper_apply_corporate_action(uuid,uuid,text,text,text,numeric,date,date,numeric,text) to service_role;
commit;
