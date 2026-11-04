-- JCP paid/credited from 2026-01-01 is subject to 17.5% IRRF (LC 224/2025).
-- Keep older events at the prior 15% rate and keep the persisted cash ledger in sync.
update public.live_dividends
set tax = least(gross, ceil(gross * 0.175 * 100) / 100),
    net = gross - least(gross, ceil(gross * 0.175 * 100) / 100)
where label = 'JRS CAP PROPRIO'
  and payment_date >= date '2026-01-01';
