-- Grik Finance cloud sync: one row per shared login account.
-- Both partners sign in with the same email/password on each device.

create table if not exists public.household_finance (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.household_finance enable row level security;

create policy "Users manage own finance data"
  on public.household_finance
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at fresh on every write
create or replace function public.set_household_finance_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists household_finance_updated_at on public.household_finance;

create trigger household_finance_updated_at
  before update on public.household_finance
  for each row
  execute function public.set_household_finance_updated_at();

-- Realtime: run in Supabase SQL editor if this fails locally
alter publication supabase_realtime add table public.household_finance;
