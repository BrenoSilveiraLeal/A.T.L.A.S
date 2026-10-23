-- Genial answers (23/10/2026): swing trade without RLP costs R$ 2,99 per standard-lot order and
-- R$ 0,99 per fractional order; fees are not shown in MT5. The simulation now charges the same
-- per order on top of the B3 fees already modelled in fee_bps (about 0,03%). One paper order
-- of 137 shares counts as both legs (100 standard + 37 fractional), like the real split.
begin;

alter table public.paper_accounts
  add column fee_lot numeric(8,2) not null default 2.99 check(fee_lot between 0 and 100),
  add column fee_fraction numeric(8,2) not null default 0.99 check(fee_fraction between 0 and 100);

create function atlas_private.paper_fee(p_fee_bps integer,p_lot numeric,p_fraction numeric,p_value numeric,p_quantity integer)
returns numeric language sql immutable set search_path='' as $$
  select ceil(p_value*p_fee_bps/10000*100)/100
    + case when p_quantity >= 100 then p_lot else 0 end
    + case when p_quantity % 100 > 0 then p_fraction else 0 end
$$;

-- Patch the two places that priced fees, keeping everything else in those functions intact.
do $$ declare d text; v_old constant text := 'ceil(v_value*v_account.fee_bps/10000*100)/100'; begin
  d := pg_get_functiondef('public.paper_review_proposal(uuid,uuid,boolean)'::regprocedure);
  if position(v_old in d) = 0 then raise exception 'ATLAS_FEE_PATCH_REVIEW_NOT_FOUND'; end if;
  execute replace(d, v_old, 'atlas_private.paper_fee(v_account.fee_bps,v_account.fee_lot,v_account.fee_fraction,v_value,v_proposal.quantity::integer)');
  d := pg_get_functiondef('public.paper_settle_quote(uuid,uuid,numeric,text,timestamptz)'::regprocedure);
  if position(v_old in d) = 0 then raise exception 'ATLAS_FEE_PATCH_SETTLE_NOT_FOUND'; end if;
  execute replace(d, v_old, 'atlas_private.paper_fee(v_account.fee_bps,v_account.fee_lot,v_account.fee_fraction,v_value,v_order.quantity)');
end $$;
commit;
