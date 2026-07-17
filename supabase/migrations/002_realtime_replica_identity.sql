-- Required so Supabase Realtime sends full row data on UPDATE events.
alter table public.household_finance replica identity full;

-- Ensure the table is in the realtime publication (safe to re-run).
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
