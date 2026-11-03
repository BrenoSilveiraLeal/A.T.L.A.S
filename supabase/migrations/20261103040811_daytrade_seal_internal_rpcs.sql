begin;

-- Keep the externally callable boundaries as the only service-role entry points.
-- Their owners are the migration role (postgres); every wrapper uses a fixed empty
-- search_path and qualified object names before it reaches the internal state machine.
alter function public.dt_apply_paper_bar(jsonb) security definer;
alter function public.dt_apply_paper_bar(jsonb) set search_path = '';
revoke all on function public.dt_apply_paper_bar(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.dt_apply_paper_bar(jsonb) to service_role;

revoke all on function public.dt_apply_paper_bar_before_equity_gate(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.dt_apply_paper_bar_before_capital_budget(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.dt_apply_paper_bar_before_input_validation(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.dt_apply_paper_bar_before_session_gate(jsonb) from public, anon, authenticated, service_role;

-- Quote validation must not be skippable by calling the atomic persistence helper directly.
alter function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb) security definer;
alter function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb) set search_path = '';
revoke all on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.dt_accept_market_quote(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  to service_role;
revoke all on function public.dt_accept_market_quote_before_bar_validation(uuid, text, text, numeric, numeric, numeric, timestamptz, timestamptz, bigint, jsonb)
  from public, anon, authenticated, service_role;

commit;
