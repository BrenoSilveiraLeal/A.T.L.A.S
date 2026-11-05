-- Separate issuer payment schedules from the owner's confirmation of the actual broker credit.
alter table public.live_dividends
  add column received_on date,
  add column received_net numeric(20,2),
  add constraint live_dividend_receipt_valid check (
    (received_on is null and received_net is null) or
    (received_on is not null and received_net is not null and received_on >= payment_date and received_net >= 0 and received_net <= gross)
  );

create function public.confirm_live_dividend_receipt(p_owner_id uuid,p_id bigint,p_received_on date,p_amount numeric)
returns text language plpgsql security definer set search_path='' as $$
declare v_row public.live_dividends; v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_row from public.live_dividends where id=p_id and owner_id=p_owner_id for update;
  if not found then raise exception 'ATLAS_DIVIDEND_NOT_FOUND'; end if;
  if p_received_on is null or p_received_on < v_row.payment_date or p_received_on > v_today
      or p_amount is null or p_amount < 0 or p_amount > v_row.gross or p_amount <> round(p_amount,2) then
    raise exception 'ATLAS_INVALID_DIVIDEND_RECEIPT';
  end if;
  if v_row.received_on is not null then
    if v_row.received_on = p_received_on and v_row.received_net = p_amount then return 'DUPLICATE'; end if;
    raise exception 'ATLAS_DIVIDEND_RECEIPT_ALREADY_RECORDED';
  end if;
  update public.live_dividends set received_on=p_received_on, received_net=p_amount where id=p_id and owner_id=p_owner_id;
  return 'RECORDED';
end $$;
revoke all on function public.confirm_live_dividend_receipt(uuid,bigint,date,numeric) from public,anon,authenticated,service_role;
grant execute on function public.confirm_live_dividend_receipt(uuid,bigint,date,numeric) to service_role;
