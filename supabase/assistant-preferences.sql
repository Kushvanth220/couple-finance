-- Household assistant behavior preferences (run AFTER setup.sql)
-- Stores dynamic user instructions that shape assistant system prompts

create table if not exists public.assistant_preferences (
  household_id text not null,
  assistant_name text default 'Assistant',
  voice_gender text default 'female' check (voice_gender in ('male', 'female')),
  wake_listening_enabled boolean not null default true,
  language text not null default 'en-US',
  behavior_instructions jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (household_id)
);

alter table public.assistant_preferences enable row level security;

create policy "open assistant preferences"
  on public.assistant_preferences
  for all
  to anon, authenticated
  using (true)
  with check (true);
