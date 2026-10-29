-- Dividends and JCP on the real Genial shares (owner, 29/10/2026: "dividendos é o que enriquecem").
-- The MT5 Swing account does not report the cash balance, so ATLAS counts deposits minus trades;
-- each cash event the company pays on shares ATLAS held at the "data com" is recorded here from
-- B3's official list, and the net amount counts as money to invest from its payment date.
create table public.live_dividends (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  agent_id uuid references public.agents(id) on delete set null,
  ticker text not null check(ticker ~ '^[A-Z0-9]{4,8}$'),
  label text not null check(label in ('DIVIDENDO','JRS CAP PROPRIO','RENDIMENTO')),
  isin text not null check(isin ~ '^[A-Z0-9]{12}$'),
  last_date_prior date not null,
  payment_date date not null,
  rate numeric(24,11) not null check(rate > 0 and rate < 10000),
  quantity integer not null check(quantity > 0),
  gross numeric(20,2) not null check(gross >= 0),
  tax numeric(20,2) not null check(tax >= 0 and tax <= gross),
  net numeric(20,2) not null check(net = gross - tax),
  source text not null check(source like 'https://%'),
  created_at timestamptz not null default now(),
  unique(owner_id, ticker, label, last_date_prior, payment_date, rate)
);
alter table public.live_dividends enable row level security;
revoke all on public.live_dividends from public,anon,authenticated,service_role;
grant select on public.live_dividends to authenticated,service_role;
create policy owner_aal2_select on public.live_dividends for select to authenticated
  using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()));

-- Records one cash event; never changes or removes one already recorded.
create function public.live_record_dividend(p_owner_id uuid, p_event jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare v_id bigint;
begin
  insert into public.live_dividends(owner_id, agent_id, ticker, label, isin, last_date_prior, payment_date, rate, quantity, gross, tax, net, source)
  values (p_owner_id, nullif(p_event->>'agentId','')::uuid, p_event->>'ticker', p_event->>'label', p_event->>'isin',
          (p_event->>'lastDatePrior')::date, (p_event->>'paymentDate')::date, (p_event->>'rate')::numeric,
          (p_event->>'quantity')::integer, (p_event->>'gross')::numeric, (p_event->>'tax')::numeric,
          (p_event->>'net')::numeric, p_event->>'source')
  on conflict (owner_id, ticker, label, last_date_prior, payment_date, rate) do nothing
  returning id into v_id;
  return case when v_id is null then 'DUPLICATE' else 'RECORDED' end;
end $$;
revoke all on function public.live_record_dividend(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.live_record_dividend(uuid,jsonb) to service_role;

-- Money free for the agents now also includes the net dividends and JCP already paid.
create or replace function atlas_private.live_agent_room(p_owner_id uuid,p_agent_id uuid) returns numeric
language sql stable set search_path='' as $$
  select coalesce((select ceiling from public.capital_plans where owner_id=p_owner_id),0)
    + coalesce((select sum(realized_pnl) from public.live_positions where owner_id=p_owner_id),0)
    - coalesce((select sum(cost) from public.live_positions where owner_id=p_owner_id),0)
    - coalesce((select sum(reserved_cash) from public.live_orders where owner_id=p_owner_id
        and side='BUY' and status in ('PENDING','DISPATCHED','OPEN','PARTIALLY_FILLED','UNKNOWN')),0)
    + coalesce((select sum(net) from public.live_dividends where owner_id=p_owner_id
        and payment_date <= (now() at time zone 'America/Sao_Paulo')::date),0)
$$;
