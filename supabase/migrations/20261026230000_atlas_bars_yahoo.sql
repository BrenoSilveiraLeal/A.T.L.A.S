-- 26/10/2026: brapi's free plan had not published the election-day session by the evening and
-- B3's daily file comes out later; without that day the turn rule would compare tomorrow's price
-- with Friday's close. Daily bars may also come from Yahoo Finance (insert-only, like the others).
begin;
alter table public.market_bars drop constraint market_bars_source_check;
alter table public.market_bars add constraint market_bars_source_check check(source in ('B3_COTAHIST','BRAPI','YAHOO'));
create function atlas_private.bars_yahoo_marker() returns void language sql as 'select';
revoke all on function atlas_private.bars_yahoo_marker() from public,anon,authenticated,service_role;
commit;
