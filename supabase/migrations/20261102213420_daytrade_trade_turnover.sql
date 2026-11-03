begin;

-- Preserve trade-level price × quantity inside each 1-minute candle so DASH can calculate
-- trade-weighted VWAP instead of treating every trade as if it happened at the candle close.
alter table public.dt_market_bars
  add column turnover numeric(28,10) check (turnover is null or turnover >= 0);

alter table public.dt_market_bars
  add constraint dt_market_bars_turnover_within_ohlc
  check (turnover is null or (
    turnover >= low * volume - greatest(0.01, high * volume * 0.000000001)
    and turnover <= high * volume + greatest(0.01, high * volume * 0.000000001)
  ));

comment on column public.dt_market_bars.turnover is
  'Sum of execution price × trade quantity for the minute; null means this legacy or imported candle cannot support exact trade-weighted VWAP.';

commit;
