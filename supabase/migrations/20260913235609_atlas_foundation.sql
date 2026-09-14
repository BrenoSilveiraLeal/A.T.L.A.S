-- ATLAS foundation. No seed assets, credentials, quotes, cash or executions.
-- Auth schema and roles are supplied by Supabase; the test harness supplies local stubs.
begin;

create schema if not exists atlas_private;
revoke all on schema atlas_private from public, anon, authenticated;
grant usage on schema atlas_private to service_role;

create domain public.atlas_decimal as numeric(28,10)
  check (value > '-Infinity'::numeric and value < 'Infinity'::numeric);

create table public.system_state (
  id boolean primary key default true check (id),
  owner_id uuid not null unique references auth.users(id),
  live_trading_enabled boolean not null default false,
  global_kill_switch boolean not null default true,
  kill_switch_reason text not null default 'Setup incompleto: live desabilitado.',
  broker_reconciled_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  ticker text not null check (ticker ~ '^[A-Z0-9._-]{1,20}$'),
  company_name text not null check (length(company_name) between 1 and 200),
  exchange text not null default 'B3', currency text not null default 'BRL',
  sector text, active boolean not null default true,
  lot_size integer not null default 1 check (lot_size > 0),
  tick_size public.atlas_decimal not null default 0.01 check (tick_size > 0),
  created_at timestamptz not null default now(),
  unique(owner_id, ticker, exchange), unique(id, owner_id)
);

create table public.strategies (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  name text not null, description text not null default '',
  active boolean not null default false, created_at timestamptz not null default now(),
  unique(id, owner_id)
);
create table public.strategy_versions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  strategy_id uuid not null, version text not null, definition jsonb not null,
  research_status text not null default 'PENDING' check (research_status in ('PENDING','VALIDATED','REJECTED')),
  created_at timestamptz not null default now(),
  foreign key(strategy_id,owner_id) references public.strategies(id,owner_id),
  unique(strategy_id,version), unique(id,owner_id)
);
create table public.risk_profiles (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  name text not null, version integer not null default 1 check (version > 0),
  limits jsonb not null default '{}', configured boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,owner_id)
);
create table public.agents (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  asset_id uuid not null, name text not null check (length(name) between 1 and 80),
  avatar text not null default 'atlas',
  status text not null default 'PAUSED' check (status in ('IDLE','ANALYZING','WATCHING_MARKET','READING_NEWS','NEWS_REVIEW','PREPARING_ORDER','ORDER_PENDING','POSITION_OPEN','MONITORING','MEETING','PAUSED','RISK_BLOCKED','FIRED','DEAD')),
  strategy_id uuid, risk_profile_id uuid,
  budget public.atlas_decimal not null default 0 check (budget >= 0),
  enabled boolean not null default false,
  analysis_interval_seconds integer not null default 900 check (analysis_interval_seconds between 60 and 86400),
  last_analysis_at timestamptz, next_analysis_at timestamptz not null default now(),
  lease_token uuid, lease_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  foreign key(strategy_id,owner_id) references public.strategies(id,owner_id),
  foreign key(risk_profile_id,owner_id) references public.risk_profiles(id,owner_id),
  check ((lease_token is null) = (lease_expires_at is null)), unique(id,owner_id)
);
create index agents_due_idx on public.agents(next_analysis_at) where enabled;

create table public.broker_accounts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  provider text not null, external_account_id text not null,
  connection_status text not null default 'UNCONFIGURED' check (connection_status in ('UNCONFIGURED','PENDING','CONNECTED','ERROR','REVOKED')),
  capabilities jsonb not null default '{}', reconciled_at timestamptz,
  created_at timestamptz not null default now(), unique(owner_id,provider,external_account_id), unique(id,owner_id)
);
create table public.broker_connections (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  broker_account_id uuid not null, status text not null default 'UNCONFIGURED',
  -- Only a non-secret secret-manager reference is permitted; actual credentials live in Vault/env.
  credential_reference text, last_health_at timestamptz, last_error_code text,
  created_at timestamptz not null default now(),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id)
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  agent_id uuid not null, asset_id uuid not null, correlation_id uuid not null,
  decision text not null check (decision in ('BUY','SELL','HOLD','CANCEL_ORDER','MODIFY_ORDER')),
  strategy_version text not null, reasoning_summary text not null,
  inputs jsonb not null, result jsonb not null, sources jsonb not null default '[]',
  data_timestamp timestamptz not null, created_at timestamptz not null default now(),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id), unique(id,owner_id)
);
create index decisions_correlation_idx on public.decisions(correlation_id);
create table public.trade_proposals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  agent_id uuid not null, asset_id uuid not null, decision_id uuid not null, correlation_id uuid not null,
  side text not null check (side in ('BUY','SELL')), quantity public.atlas_decimal not null check (quantity > 0),
  order_type text not null check (order_type in ('LIMIT','STOP','STOP_LIMIT')),
  limit_price public.atlas_decimal check (limit_price > 0), stop_price public.atlas_decimal check (stop_price > 0),
  risk_status text not null default 'PENDING' check (risk_status in ('PENDING','APPROVED','REJECTED','EXPIRED')),
  risk_result jsonb, risk_profile_version integer, approved_at timestamptz, expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  foreign key(decision_id,owner_id) references public.decisions(id,owner_id), unique(id,owner_id),
  check ((order_type <> 'LIMIT' or limit_price is not null) and (order_type <> 'STOP' or stop_price is not null) and (order_type <> 'STOP_LIMIT' or (limit_price is not null and stop_price is not null)))
);
create table public.orders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  agent_id uuid not null, asset_id uuid not null, broker_account_id uuid not null, proposal_id uuid not null,
  correlation_id uuid not null, idempotency_key text not null, client_order_id text not null,
  broker_order_id text, side text not null check(side in ('BUY','SELL')),
  order_type text not null check(order_type in ('LIMIT','STOP','STOP_LIMIT')),
  status text not null default 'CREATED' check(status in ('CREATED','RISK_REVIEW','APPROVED','SUBMITTING','SUBMITTED','PARTIALLY_FILLED','FILLED','CANCEL_REQUESTED','CANCELLED','REJECTED','EXPIRED','ERROR')),
  quantity public.atlas_decimal not null check(quantity > 0), filled_quantity public.atlas_decimal not null default 0,
  limit_price public.atlas_decimal check(limit_price > 0), stop_price public.atlas_decimal check(stop_price > 0),
  reconciliation_required boolean not null default false,
  submitted_at timestamptz, reconciled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(filled_quantity >= 0 and filled_quantity <= quantity),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id),
  foreign key(proposal_id,owner_id) references public.trade_proposals(id,owner_id),
  unique(owner_id,idempotency_key), unique(broker_account_id,client_order_id), unique(broker_account_id,broker_order_id), unique(id,owner_id)
);
create table public.order_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  order_id uuid not null, event_key text not null, event_type text not null, payload jsonb not null,
  source text not null, created_at timestamptz not null default now(),
  foreign key(order_id,owner_id) references public.orders(id,owner_id), unique(order_id,event_key)
);
create table public.executions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  order_id uuid not null, broker_account_id uuid not null, broker_execution_id text not null,
  quantity public.atlas_decimal not null check(quantity > 0), price public.atlas_decimal not null check(price > 0),
  fees public.atlas_decimal check(fees >= 0), executed_at timestamptz not null, received_at timestamptz not null default now(),
  foreign key(order_id,owner_id) references public.orders(id,owner_id),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id),
  unique(broker_account_id,broker_execution_id), unique(id,owner_id)
);
create table public.positions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  broker_account_id uuid not null, asset_id uuid not null, agent_id uuid,
  quantity public.atlas_decimal not null check(quantity >= 0), reserved_quantity public.atlas_decimal not null default 0,
  average_price public.atlas_decimal check(average_price >= 0), realized_pnl public.atlas_decimal,
  reconciled_at timestamptz not null,
  check(reserved_quantity >= 0 and reserved_quantity <= quantity),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  unique nulls not distinct(broker_account_id,asset_id,agent_id)
);
create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  broker_account_id uuid not null, cash public.atlas_decimal not null, equity public.atlas_decimal,
  invested public.atlas_decimal, realized_pnl public.atlas_decimal, unrealized_pnl public.atlas_decimal,
  reconciled boolean not null default false, discrepancies jsonb not null default '[]',
  source_timestamp timestamptz not null, created_at timestamptz not null default now(),
  foreign key(broker_account_id,owner_id) references public.broker_accounts(id,owner_id)
);

create table public.market_data_cache (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), asset_id uuid,
  provider text not null, ticker text not null, data_kind text not null default 'QUOTE',
  quality text not null check(quality in ('REAL_TIME','DELAYED','EOD','STALE','UNKNOWN')),
  price public.atlas_decimal check(price > 0), currency text not null default 'BRL',
  provider_timestamp timestamptz, retrieved_at timestamptz not null default now(),
  declared_delay_seconds integer check(declared_delay_seconds >= 0),
  source_url text not null, payload jsonb not null, license_reference text,
  foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  unique nulls not distinct(owner_id,provider,ticker,data_kind,provider_timestamp)
);
create index market_cache_ticker_idx on public.market_data_cache(owner_id,ticker,retrieved_at desc);
create table public.news_articles (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  source text not null, url text not null check(url ~ '^https://'), title text not null,
  published_at timestamptz not null, retrieved_at timestamptz not null default now(),
  event_key text not null, content_hash text, category text,
  relevance public.atlas_decimal check(relevance between 0 and 1),
  sentiment text, confidence public.atlas_decimal check(confidence between 0 and 1),
  expected_impact text, impact_horizon text, analysis jsonb,
  unique(owner_id,url), unique(id,owner_id)
);
create index news_event_idx on public.news_articles(owner_id,event_key);
create table public.news_asset_links (
  owner_id uuid not null references auth.users(id), article_id uuid not null, asset_id uuid not null,
  primary key(article_id,asset_id),
  foreign key(article_id,owner_id) references public.news_articles(id,owner_id),
  foreign key(asset_id,owner_id) references public.assets(id,owner_id)
);
create table public.agent_memories (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), agent_id uuid not null,
  event_key text not null, summary text not null, sources jsonb not null,
  created_at timestamptz not null default now(), foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  unique(agent_id,event_key)
);
create table public.market_sessions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  exchange text not null, session_date date not null, timezone text not null default 'America/Sao_Paulo',
  status text not null check(status in ('OPEN','CLOSED','AUCTION','HALTED','UNKNOWN')),
  opens_at timestamptz, closes_at timestamptz, source_url text not null, source_version text not null,
  verified_at timestamptz not null, unique(owner_id,exchange,session_date)
);
create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), asset_id uuid not null,
  provider text not null, external_event_id text not null, event_type text not null,
  effective_at timestamptz not null, announced_at timestamptz not null, payload jsonb not null, source_url text not null,
  applied_at timestamptz, foreign key(asset_id,owner_id) references public.assets(id,owner_id),
  unique(owner_id,provider,external_event_id)
);

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  account_key text not null, name text not null,
  kind text not null check(kind in ('BROKER_CASH','RESERVE','AGENT_CASH','INVESTED','EXTERNAL_CLEARING')),
  currency text not null default 'BRL' check(currency = 'BRL'),
  balance public.atlas_decimal not null default 0,
  agent_id uuid, created_at timestamptz not null default now(),
  check(balance >= 0 or kind = 'EXTERNAL_CLEARING'),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  unique(owner_id,account_key), unique(id,owner_id)
);
create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  idempotency_key text not null,
  kind text not null check(kind in ('DEPOSIT','WITHDRAWAL','ALLOCATION','REALLOCATION','FILL','FEE','CORPORATE_ACTION','REVERSAL','ADJUSTMENT')),
  source text not null, reason text not null, external_reference text, correlation_id uuid not null,
  agent_id uuid, order_id uuid, request_payload jsonb not null, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(order_id,owner_id) references public.orders(id,owner_id),
  unique(owner_id,idempotency_key), unique(owner_id,source,kind,external_reference), unique(id,owner_id)
);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  transaction_id uuid not null, account_id uuid not null,
  amount public.atlas_decimal not null check(amount <> 0),
  balance_before public.atlas_decimal not null, balance_after public.atlas_decimal not null,
  created_at timestamptz not null default now(),
  check(balance_after = balance_before + amount),
  foreign key(transaction_id,owner_id) references public.ledger_transactions(id,owner_id),
  foreign key(account_id,owner_id) references public.ledger_accounts(id,owner_id),
  unique(transaction_id,account_id)
);
create table public.agent_allocations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  agent_id uuid not null, ledger_transaction_id uuid not null, amount public.atlas_decimal not null,
  created_at timestamptz not null default now(), foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  foreign key(ledger_transaction_id,owner_id) references public.ledger_transactions(id,owner_id)
);
create table public.treasury_transactions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  kind text not null check(kind in ('DEPOSIT','WITHDRAWAL')), amount public.atlas_decimal not null check(amount > 0),
  status text not null default 'PENDING_CONFIRMATION' check(status in ('PENDING_CONFIRMATION','CONFIRMED','REJECTED','CANCELLED')),
  provider text, external_reference text, confirmed_at timestamptz, ledger_transaction_id uuid,
  created_at timestamptz not null default now(),
  check(status <> 'CONFIRMED' or (external_reference is not null and confirmed_at is not null and ledger_transaction_id is not null)),
  foreign key(ledger_transaction_id,owner_id) references public.ledger_transactions(id,owner_id),
  unique(owner_id,provider,external_reference)
);
create table public.order_reservations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  order_id uuid not null, account_id uuid not null,
  amount public.atlas_decimal not null check(amount > 0),
  released_at timestamptz, created_at timestamptz not null default now(),
  foreign key(order_id,owner_id) references public.orders(id,owner_id),
  foreign key(account_id,owner_id) references public.ledger_accounts(id,owner_id), unique(order_id,account_id)
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  event_key text not null, status text not null default 'PENDING', summary text,
  affected_assets jsonb not null default '[]', risk_changes jsonb not null default '[]', recommended_actions jsonb not null default '[]',
  created_at timestamptz not null default now(), unique(owner_id,event_key), unique(id,owner_id)
);
create table public.meeting_participants (
  owner_id uuid not null references auth.users(id), meeting_id uuid not null, agent_id uuid not null,
  primary key(meeting_id,agent_id), foreign key(meeting_id,owner_id) references public.meetings(id,owner_id),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id)
);
create table public.alerts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  severity text not null check(severity in ('INFO','WARNING','CRITICAL')),
  code text not null, message text not null, correlation_id uuid, acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  actor text not null, action text not null, entity_type text not null, entity_id text,
  correlation_id uuid not null default gen_random_uuid(), details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_correlation_idx on public.audit_logs(correlation_id);
create table public.system_health (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  component text not null check(component in ('MARKET_DATA','BROKER','DATABASE','SCHEDULER','NEWS','AI','EXECUTION')),
  status text not null check(status in ('GREEN','YELLOW','RED','UNCONFIGURED')),
  message text not null, checked_at timestamptz not null, expires_at timestamptz not null,
  check(expires_at > checked_at), unique(owner_id,component)
);
create table public.job_runs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), agent_id uuid not null,
  job_type text not null default 'AGENT_ANALYSIS', scheduled_for timestamptz not null,
  status text not null default 'RUNNING' check(status in ('RUNNING','SUCCEEDED','FAILED')),
  lease_token uuid not null, lease_expires_at timestamptz not null,
  attempts integer not null default 1 check(attempts > 0), started_at timestamptz not null default now(), completed_at timestamptz,
  error_code text, correlation_id uuid not null default gen_random_uuid(),
  foreign key(agent_id,owner_id) references public.agents(id,owner_id),
  unique(agent_id,job_type,scheduled_for)
);
create table atlas_private.rate_limit_buckets (
  key text primary key, window_started_at timestamptz not null, count integer not null check(count >= 0)
);

create function atlas_private.is_atlas_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.jwt()->>'aal')='aal2' and exists(
    select 1 from public.system_state where id and owner_id=(select auth.uid())
  );
$$;

-- One owner: readable data requires that exact owner AND a currently AAL2 JWT.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'system_state','assets','strategies','strategy_versions','risk_profiles','agents','broker_accounts','broker_connections',
    'decisions','trade_proposals','orders','order_events','executions','positions','portfolio_snapshots','market_data_cache',
    'news_articles','news_asset_links','agent_memories','market_sessions','corporate_actions','ledger_accounts','ledger_transactions',
    'ledger_entries','agent_allocations','treasury_transactions','order_reservations','meetings','meeting_participants','alerts','audit_logs','system_health','job_runs'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',v_table);
    execute format('grant select on public.%I to authenticated, service_role',v_table);
    execute format('create policy owner_aal2_select on public.%I for select to authenticated using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()))',v_table);
  end loop;
end $$;
-- Non-financial ingestion/configuration only. Financial and audit writes require RPCs.
grant insert, update, delete on public.assets, public.strategies, public.risk_profiles,
  public.market_data_cache, public.news_articles, public.news_asset_links, public.market_sessions,
  public.system_health, public.alerts to service_role;
grant insert on public.system_state to service_role;
grant insert on public.strategy_versions, public.decisions, public.agent_memories to service_role;

create function atlas_private.require_owner(p_owner_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_owner_id is null or not exists(select 1 from public.system_state where id and owner_id = p_owner_id) then
    raise exception 'ATLAS_OWNER_REQUIRED' using errcode = '42501';
  end if;
end $$;

create function atlas_private.reject_mutation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'ATLAS_APPEND_ONLY' using errcode = '55000';
end $$;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries for each row execute function atlas_private.reject_mutation();
create trigger ledger_transactions_immutable before update or delete on public.ledger_transactions for each row execute function atlas_private.reject_mutation();
create trigger audit_logs_immutable before update or delete on public.audit_logs for each row execute function atlas_private.reject_mutation();
create trigger executions_immutable before update or delete on public.executions for each row execute function atlas_private.reject_mutation();
create trigger decisions_immutable before update or delete on public.decisions for each row execute function atlas_private.reject_mutation();
create trigger strategy_versions_immutable before update or delete on public.strategy_versions for each row execute function atlas_private.reject_mutation();
create trigger order_events_immutable before update or delete on public.order_events for each row execute function atlas_private.reject_mutation();

create function atlas_private.check_balanced_transaction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if tg_table_name = 'ledger_transactions' then
    v_id := new.id;
  else
    v_id := new.transaction_id;
  end if;
  if (select count(*) < 2 or coalesce(sum(amount),0) <> 0 from public.ledger_entries where transaction_id=v_id) then
    raise exception 'ATLAS_UNBALANCED_LEDGER' using errcode='23514';
  end if;
  return new;
end $$;
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function atlas_private.check_balanced_transaction();
create constraint trigger ledger_transaction_has_entries after insert on public.ledger_transactions
  deferrable initially deferred for each row execute function atlas_private.check_balanced_transaction();

create function public.create_agent(
  p_owner_id uuid,p_asset_id uuid,p_name text,p_avatar text,p_budget public.atlas_decimal,
  p_strategy_id uuid default null,p_risk_profile_id uuid default null,p_interval_seconds integer default 900
) returns public.agents language plpgsql security definer set search_path = '' as $$
declare v_agent public.agents;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_budget is null or p_budget < 0 or length(trim(p_name)) not between 1 and 80 then
    raise exception 'ATLAS_INVALID_AGENT';
  end if;
  insert into public.agents(owner_id,asset_id,name,avatar,budget,strategy_id,risk_profile_id,analysis_interval_seconds)
  values(p_owner_id,p_asset_id,trim(p_name),p_avatar,p_budget,p_strategy_id,p_risk_profile_id,p_interval_seconds) returning * into v_agent;
  -- Budget is a cap. Creating an agent never allocates or creates money.
  insert into public.ledger_accounts(owner_id,account_key,name,kind,agent_id)
  values(p_owner_id,'agent:'||v_agent.id,v_agent.name,'AGENT_CASH',v_agent.id);
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','AGENT_CREATED','agent',v_agent.id::text,jsonb_build_object('budget',p_budget::text,'enabled',false));
  return v_agent;
end $$;

create function public.update_agent_enabled(p_owner_id uuid,p_agent_id uuid,p_enabled boolean)
returns public.agents language plpgsql security definer set search_path = '' as $$
declare v_agent public.agents;
begin
  perform atlas_private.require_owner(p_owner_id);
  select * into v_agent from public.agents where id=p_agent_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_AGENT_NOT_FOUND'; end if;
  if v_agent.status in ('FIRED','DEAD') and p_enabled then raise exception 'ATLAS_AGENT_RETIRED'; end if;
  if v_agent.lease_expires_at > now() then raise exception 'ATLAS_AGENT_BUSY'; end if;
  update public.agents set enabled=p_enabled,status=case when p_enabled then 'IDLE' else 'PAUSED' end,
    lease_token=null,lease_expires_at=null,updated_at=now() where id=p_agent_id returning * into v_agent;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','AGENT_ENABLED_CHANGED','agent',p_agent_id::text,jsonb_build_object('enabled',p_enabled));
  return v_agent;
end $$;

create function public.claim_due_agents(p_owner_id uuid,p_limit integer default 10,p_lease_seconds integer default 60)
returns table(job_id uuid,agent_id uuid,lease_token uuid) language plpgsql security definer set search_path = '' as $$
declare v_agent public.agents; v_job_id uuid; v_token uuid;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_limit is null or p_limit not between 1 and 50 or p_lease_seconds is null or p_lease_seconds not between 10 and 300 then
    raise exception 'ATLAS_INVALID_JOB_LIMIT';
  end if;
  for v_agent in select a.* from public.agents a
    where a.owner_id=p_owner_id and a.enabled and a.next_analysis_at <= now()
      and a.status not in ('PAUSED','RISK_BLOCKED','FIRED','DEAD')
      and (a.lease_expires_at is null or a.lease_expires_at <= now())
    order by a.next_analysis_at,a.id for update skip locked limit p_limit
  loop
    v_token := gen_random_uuid();
    insert into public.job_runs(owner_id,agent_id,scheduled_for,lease_token,lease_expires_at)
    values(p_owner_id,v_agent.id,v_agent.next_analysis_at,v_token,now()+make_interval(secs=>p_lease_seconds))
    on conflict on constraint job_runs_agent_id_job_type_scheduled_for_key do update
      set lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,
        status='RUNNING',attempts=public.job_runs.attempts+1,started_at=now(),completed_at=null,error_code=null
      where public.job_runs.status='RUNNING' and public.job_runs.lease_expires_at <= now()
    returning id into v_job_id;
    if v_job_id is not null then
      update public.agents set lease_token=v_token,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),status='ANALYZING',updated_at=now() where id=v_agent.id;
      job_id:=v_job_id; agent_id:=v_agent.id; lease_token:=v_token; return next;
    end if;
  end loop;
end $$;

create function public.complete_agent_job(p_owner_id uuid,p_job_id uuid,p_lease_token uuid,p_status text,p_error text default null)
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
    status=case when p_status='SUCCEEDED' then 'IDLE' else 'RISK_BLOCKED' end,updated_at=now()
    where id=v_job.agent_id and owner_id=p_owner_id and lease_token=p_lease_token;
  if not found then return false; end if;
  update public.job_runs set status=p_status,error_code=left(p_error,200),completed_at=now() where id=p_job_id;
  return true;
end $$;

create function public.set_kill_switch(p_owner_id uuid,p_enabled boolean,p_reason text)
returns public.system_state language plpgsql security definer set search_path = '' as $$
declare v_state public.system_state;
begin
  perform atlas_private.require_owner(p_owner_id);
  if p_enabled is null or coalesce(length(trim(p_reason)),0) < 3 then raise exception 'ATLAS_KILL_SWITCH_REASON_REQUIRED'; end if;
  update public.system_state set global_kill_switch=p_enabled,
    live_trading_enabled=case when p_enabled then false else live_trading_enabled end,
    kill_switch_reason=p_reason,updated_at=now() where id and owner_id=p_owner_id returning * into v_state;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,details)
  values(p_owner_id,'OWNER','KILL_SWITCH_CHANGED','system','true',jsonb_build_object('enabled',p_enabled,'reason',p_reason,'cancelOpenOrders','PENDING_BROKER_PROVIDER','liquidatePositions',false));
  return v_state;
end $$;

create function public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(length(p_key),0) not between 1 and 200 or p_limit is null or p_limit not between 1 and 10000 or p_window_seconds is null or p_window_seconds not between 1 and 86400 then raise exception 'ATLAS_INVALID_RATE_LIMIT'; end if;
  insert into atlas_private.rate_limit_buckets(key,window_started_at,count) values(p_key,clock_timestamp(),1)
  on conflict(key) do update set
    count=case when atlas_private.rate_limit_buckets.window_started_at+make_interval(secs=>p_window_seconds) <= clock_timestamp() then 1 else atlas_private.rate_limit_buckets.count+1 end,
    window_started_at=case when atlas_private.rate_limit_buckets.window_started_at+make_interval(secs=>p_window_seconds) <= clock_timestamp() then clock_timestamp() else atlas_private.rate_limit_buckets.window_started_at end
  returning count into v_count;
  return v_count <= p_limit;
end $$;

create function public.create_ledger_account(p_owner_id uuid,p_account_key text,p_name text,p_kind text)
returns public.ledger_accounts language plpgsql security definer set search_path = '' as $$
declare v_account public.ledger_accounts;
begin
  perform atlas_private.require_owner(p_owner_id);
  if coalesce(length(p_account_key),0) not between 1 and 100 or coalesce(length(p_name),0) not between 1 and 100 then raise exception 'ATLAS_INVALID_ACCOUNT'; end if;
  insert into public.ledger_accounts(owner_id,account_key,name,kind) values(p_owner_id,p_account_key,p_name,p_kind)
  returning * into v_account;
  return v_account;
end $$;

create function public.post_ledger_transaction(
  p_owner_id uuid,p_idempotency_key text,p_kind text,p_lines jsonb,p_source text,p_reason text,
  p_external_reference text default null,p_agent_id uuid default null,p_order_id uuid default null,p_metadata jsonb default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_transaction public.ledger_transactions; v_payload jsonb; v_line jsonb;
  v_account public.ledger_accounts; v_amount public.atlas_decimal; v_sum numeric:=0; v_count integer; v_id uuid;
begin
  perform atlas_private.require_owner(p_owner_id);
  if coalesce(length(p_idempotency_key),0) not between 1 and 200 or coalesce(length(p_source),0) < 1 or coalesce(length(p_reason),0) < 1 then raise exception 'ATLAS_LEDGER_PROVENANCE_REQUIRED'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 2 and 100 then raise exception 'ATLAS_INVALID_LEDGER_LINES'; end if;
  if p_kind in ('DEPOSIT','WITHDRAWAL','FILL','CORPORATE_ACTION') and coalesce(length(p_external_reference),0)=0 then raise exception 'ATLAS_EXTERNAL_CONFIRMATION_REQUIRED'; end if;
  v_payload:=jsonb_build_object('kind',p_kind,'lines',p_lines,'source',p_source,'reason',p_reason,'externalReference',p_external_reference,'agentId',p_agent_id,'orderId',p_order_id,'metadata',p_metadata);
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_idempotency_key,0));
  select * into v_transaction from public.ledger_transactions where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
  if found then
    if v_transaction.request_payload <> v_payload then raise exception 'ATLAS_IDEMPOTENCY_CONFLICT'; end if;
    return v_transaction.id;
  end if;
  select count(distinct (x->>'accountId')::uuid) into v_count from jsonb_array_elements(p_lines) x;
  if v_count <> jsonb_array_length(p_lines) then raise exception 'ATLAS_DUPLICATE_LEDGER_ACCOUNT'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line->'amount') <> 'string' or not (v_line->>'amount' ~ '^-?[0-9]+(\.[0-9]{1,10})?$') then raise exception 'ATLAS_DECIMAL_STRING_REQUIRED'; end if;
    v_amount:=(v_line->>'amount')::public.atlas_decimal;
    if v_amount is null or v_amount=0 then raise exception 'ATLAS_INVALID_LEDGER_AMOUNT'; end if;
    v_sum:=v_sum+v_amount;
  end loop;
  if v_sum<>0 then raise exception 'ATLAS_UNBALANCED_LEDGER' using errcode='23514'; end if;
  -- Lock every affected account in deterministic order; no application-memory locks.
  perform 1 from public.ledger_accounts a where a.owner_id=p_owner_id
    and a.id in (select (value->>'accountId')::uuid from jsonb_array_elements(p_lines)) order by a.id for update;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_lines) then raise exception 'ATLAS_LEDGER_ACCOUNT_NOT_FOUND'; end if;
  insert into public.ledger_transactions(owner_id,idempotency_key,kind,source,reason,external_reference,correlation_id,agent_id,order_id,request_payload,metadata)
  values(p_owner_id,p_idempotency_key,p_kind,p_source,p_reason,p_external_reference,gen_random_uuid(),p_agent_id,p_order_id,v_payload,p_metadata) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_amount:=(v_line->>'amount')::public.atlas_decimal;
    select * into strict v_account from public.ledger_accounts where id=(v_line->>'accountId')::uuid and owner_id=p_owner_id;
    if v_account.kind<>'EXTERNAL_CLEARING' and v_account.balance+v_amount < 0 then raise exception 'ATLAS_INSUFFICIENT_BALANCE' using errcode='23514'; end if;
    -- Internal reallocations cannot involve external clearing or manufacture deposits.
    if p_kind in ('ALLOCATION','REALLOCATION') and v_account.kind='EXTERNAL_CLEARING' then raise exception 'ATLAS_INTERNAL_ALLOCATION_ONLY'; end if;
    update public.ledger_accounts set balance=balance+v_amount where id=v_account.id;
    insert into public.ledger_entries(owner_id,transaction_id,account_id,amount,balance_before,balance_after)
    values(p_owner_id,v_id,v_account.id,v_amount,v_account.balance,v_account.balance+v_amount);
  end loop;
  insert into public.audit_logs(owner_id,actor,action,entity_type,entity_id,correlation_id,details)
    select p_owner_id,'SYSTEM','LEDGER_POSTED','ledger_transaction',v_id::text,correlation_id,jsonb_build_object('kind',p_kind,'source',p_source,'externalReference',p_external_reference)
    from public.ledger_transactions where id=v_id;
  return v_id;
end $$;

-- Monetary snapshots cross the JSON boundary as decimal strings, never JSON numbers.
-- No aggregate here is represented as broker-confirmed cash unless a real snapshot exists.
create function public.get_accounting_snapshot(p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_accounts jsonb; v_positions jsonb; v_snapshot jsonb;
begin
  perform atlas_private.require_owner(p_owner_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'accountKey',account_key,'kind',kind,'currency',currency,'agentId',agent_id,'balance',balance::text
  ) order by account_key),'[]'::jsonb) into v_accounts from public.ledger_accounts where owner_id=p_owner_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'brokerAccountId',broker_account_id,'assetId',asset_id,'agentId',agent_id,
    'quantity',quantity::text,'reservedQuantity',reserved_quantity::text,'averagePrice',average_price::text,
    'realizedPnl',realized_pnl::text,'reconciledAt',reconciled_at
  ) order by id),'[]'::jsonb) into v_positions from public.positions where owner_id=p_owner_id;
  select jsonb_build_object(
    'id',id,'brokerAccountId',broker_account_id,'cash',cash::text,'equity',equity::text,'invested',invested::text,
    'realizedPnl',realized_pnl::text,'unrealizedPnl',unrealized_pnl::text,'reconciled',reconciled,
    'discrepancies',discrepancies,'sourceTimestamp',source_timestamp,'createdAt',created_at
  ) into v_snapshot from public.portfolio_snapshots where owner_id=p_owner_id order by created_at desc,id limit 1;
  return jsonb_build_object('ledgerAccounts',v_accounts,'positions',v_positions,'latestPortfolioSnapshot',v_snapshot);
end $$;

-- No function is implicitly executable through PUBLIC/anon/authenticated.
revoke all on all functions in schema atlas_private from public,anon,authenticated,service_role;
revoke all on all tables in schema atlas_private from public,anon,authenticated,service_role;
grant usage on schema atlas_private to authenticated;
grant execute on function atlas_private.is_atlas_owner() to authenticated;
do $$
declare v_function record;
begin
  for v_function in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_agent','update_agent_enabled','claim_due_agents','complete_agent_job','set_kill_switch','consume_rate_limit','create_ledger_account','post_ledger_transaction','get_accounting_snapshot')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature);
    execute format('grant execute on function %s to service_role',v_function.signature);
  end loop;
end $$;

commit;
