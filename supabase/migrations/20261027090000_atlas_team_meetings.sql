-- 26/10/2026: the end-of-day team meeting (core/meeting.ts). One record per trading day with what
-- each agent said, the summary, how the rule did and the suggestions for the owner.
begin;

create table public.team_meetings (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  day date not null,
  lines jsonb not null default '[]',
  summary jsonb not null default '[]',
  lessons jsonb not null default '[]',
  suggestions jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique(owner_id, day)
);
alter table public.team_meetings enable row level security;
revoke all on public.team_meetings from public,anon,authenticated,service_role;
grant select on public.team_meetings to authenticated;
grant select, insert, update on public.team_meetings to service_role;
create policy owner_aal2_select on public.team_meetings for select to authenticated
  using (owner_id=(select auth.uid()) and (select atlas_private.is_atlas_owner()));

commit;
