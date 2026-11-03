begin;

-- Cover owner-scoped DASH history reads and foreign-key lookups used by deletes/joins.
-- The composite owner/time indexes also serve the owner_id foreign keys.
create index if not exists dt_journal_owner_at_idx
  on public.dt_journal (owner_id, at desc);
create index if not exists dt_ledger_owner_at_idx
  on public.dt_ledger (owner_id, at desc);
create index if not exists dt_ledger_order_id_idx
  on public.dt_ledger (order_id);
create index if not exists dt_order_events_owner_at_idx
  on public.dt_order_events (owner_id, at desc);
create index if not exists dt_order_events_order_id_idx
  on public.dt_order_events (order_id);
create index if not exists dt_orders_owner_created_idx
  on public.dt_orders (owner_id, created_at desc);
create index if not exists dt_orders_proposal_id_idx
  on public.dt_orders (proposal_id);
create index if not exists dt_proposals_owner_id_idx
  on public.dt_proposals (owner_id);
create index if not exists dt_proposals_signal_id_idx
  on public.dt_proposals (signal_id);
create index if not exists dt_room_votes_owner_id_idx
  on public.dt_room_votes (owner_id);
create index if not exists dt_signals_owner_id_idx
  on public.dt_signals (owner_id);

commit;
