begin;

-- DASH is not an OMS. Enforce the SIMULATED-only product mode below the API so a
-- future service-role bug cannot write real orders, real ledger rows, or broker positions.
alter table public.dt_orders
  add constraint dt_orders_simulated_only
    check (simulated is true and broker_order_id is null);

alter table public.dt_ledger
  add constraint dt_ledger_simulated_only
    check (simulated is true);

alter table public.dt_positions
  add constraint dt_positions_paper_only
    check (confirmed_by_broker is false);

commit;
