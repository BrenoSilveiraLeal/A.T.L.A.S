-- Owner (25/10/2026): every relevant event (orders sent, buys and sales executed, rejections,
-- money missing for a purchase, errors, deposits) is shown in the app (bell + beep) and e-mailed.
begin;

create table public.notifications (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  level text not null check(level in ('info','success','warning','error')),
  title text not null check(length(title) between 1 and 160),
  body text not null default '' check(length(body) <= 2000),
  emailed boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_owner_recent on public.notifications(owner_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated,service_role;
grant select on public.notifications to authenticated;
grant select, insert, update on public.notifications to service_role;
create policy owner_aal2_select on public.notifications for select to authenticated
  using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()));

commit;
