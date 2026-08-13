-- Add reminders column if assistant_preferences already exists
alter table public.assistant_preferences
  add column if not exists reminders jsonb not null default '[]'::jsonb;
