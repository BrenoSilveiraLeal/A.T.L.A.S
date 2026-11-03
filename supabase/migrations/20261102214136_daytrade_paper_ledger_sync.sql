begin;

-- Give every paper fill a durable, traceable row in the existing append-only DASH ledger.
-- The source key makes the backfill and trigger idempotent.
alter table public.dt_ledger
  add column paper_fill_id bigint unique references public.dt_paper_fills(id),
  add column paper_action text check (paper_action in ('ENTRY', 'EXIT')),
  add column strategy_version text,
  add column gross_pnl numeric(28,10),
  add column net_pnl numeric(28,10),
  add column reason text;

create function public.dt_record_paper_fill_in_ledger()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.dt_ledger (
    owner_id, order_id, simulated, instrument, side, quantity, price, fees, at,
    paper_fill_id, paper_action, strategy_version, gross_pnl, net_pnl, reason
  ) values (
    new.owner_id, null, true, new.instrument, new.side, new.quantity, new.price, new.fees, new.bar_at,
    new.id, new.action, new.strategy_version, new.gross_pnl, new.net_pnl, new.reason
  ) on conflict (paper_fill_id) do nothing;
  return new;
end;
$$;

-- Backfill existing simulator rows before enabling ongoing synchronization.
insert into public.dt_ledger (
  owner_id, order_id, simulated, instrument, side, quantity, price, fees, at,
  paper_fill_id, paper_action, strategy_version, gross_pnl, net_pnl, reason
)
select
  f.owner_id, null, true, f.instrument, f.side, f.quantity, f.price, f.fees, f.bar_at,
  f.id, f.action, f.strategy_version, f.gross_pnl, f.net_pnl, f.reason
from public.dt_paper_fills f
on conflict (paper_fill_id) do nothing;

create trigger dt_paper_fill_to_ledger
after insert on public.dt_paper_fills
for each row execute function public.dt_record_paper_fill_in_ledger();

revoke all on function public.dt_record_paper_fill_in_ledger() from public, anon, authenticated;

commit;
