-- KG Finance: run this ENTIRE file once in Supabase SQL Editor
-- Safe for first-time setup (no existing table needed)

drop table if exists public.household_finance cascade;

create table public.household_finance (
  household_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.household_finance enable row level security;

create policy "open household sync"
  on public.household_finance
  for all
  to anon, authenticated
  using (true)
  with check (true);

create or replace function public.set_household_finance_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger household_finance_updated_at
  before update on public.household_finance
  for each row
  execute function public.set_household_finance_updated_at();

alter table public.household_finance replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'household_finance'
  ) then
    alter publication supabase_realtime add table public.household_finance;
  end if;
end $$;
