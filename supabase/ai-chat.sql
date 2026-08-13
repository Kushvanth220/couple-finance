-- AI assistant chat (run AFTER setup.sql — does not modify household_finance)
-- Isolated sessions per user_id (kushvanth | grishma)

create table if not exists public.ai_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id text not null,
  user_id text not null check (user_id in ('kushvanth', 'grishma')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_chat_sessions_household_user_idx
  on public.ai_chat_sessions (household_id, user_id, updated_at desc);

create table if not exists public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
  household_id text not null,
  user_id text not null check (user_id in ('kushvanth', 'grishma')),
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_chat_messages_session_idx
  on public.ai_chat_messages (session_id, created_at asc);

create index if not exists ai_chat_messages_user_idx
  on public.ai_chat_messages (household_id, user_id, created_at desc);

alter table public.ai_chat_sessions enable row level security;
alter table public.ai_chat_messages enable row level security;

create policy "open ai chat sessions"
  on public.ai_chat_sessions
  for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "open ai chat messages"
  on public.ai_chat_messages
  for all
  to anon, authenticated
  using (true)
  with check (true);

create or replace function public.set_ai_chat_session_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_chat_sessions_updated_at on public.ai_chat_sessions;

create trigger ai_chat_sessions_updated_at
  before update on public.ai_chat_sessions
  for each row
  execute function public.set_ai_chat_session_updated_at();
