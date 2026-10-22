-- News "TV" of the office: free public headlines (Agência Brasil, Banco Central, GDELT, CVM)
-- with the agents' rule-based reading (pode subir / pode cair / atenção) per ticker.
-- Only title, link, date and source are kept. Written by the backend; pruned after 30 days.
begin;

create table public.news_items (
  owner_id uuid not null references auth.users(id),
  url text not null check(length(url) between 8 and 1000),
  title text not null check(length(title) between 1 and 500),
  source text not null check(length(source) between 1 and 80),
  published_at timestamptz not null,
  seen_at timestamptz not null default now(),
  tags jsonb not null default '[]' check(jsonb_typeof(tags) = 'array'),
  primary key(owner_id, url)
);
create index news_items_recent on public.news_items(owner_id, published_at desc);

alter table public.news_items enable row level security;
revoke all on public.news_items from public,anon,authenticated,service_role;
grant select on public.news_items to authenticated;
grant select, insert, delete on public.news_items to service_role;
create policy owner_aal2_select on public.news_items for select to authenticated
  using (owner_id = (select auth.uid()) and (select atlas_private.is_atlas_owner()));
commit;
