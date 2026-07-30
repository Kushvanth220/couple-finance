# Supabase migration (keep your data)

Use this when deleting the old Supabase project and creating a new one.

## 1. Back up now (old project)

With your **current** `.env.local` still pointing at the old project:

```bash
npm run backup:supabase
```

This saves:

- `backups/<timestamp>-grik-finance-couple/household-finance.json` — full backup
- `docs/supabase-export.json` — latest copy for restore

**Copy the whole `backups/` folder somewhere safe** (USB, Google Drive, etc.) before deleting the old Supabase project.

## 2. Create the new Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the entire file: `supabase/setup.sql`
3. Enable **Realtime** for `household_finance` if prompted (the SQL script tries to add it).

## 3. Point the app at the new project

Update `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-NEW-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_new_anon_key
NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY=grik-finance-couple
```

Update the same variables on **Vercel** (Project → Settings → Environment Variables), then redeploy.

## 4. Restore data into the new project

```bash
npm run restore:supabase
```

Or restore a specific backup:

```bash
npm run restore:supabase -- backups/2026-07-30T...-grik-finance-couple/household-finance.json
```

## 5. Refresh the app

1. Restart `npm run dev` locally (or wait for Vercel redeploy).
2. Open the app — it should pull the restored cloud data.
3. If a device still shows old data, hard refresh or clear site data once, then reload.

## What is included in the backup

All finance data in one JSON blob:

- Accounts, debts, transactions
- Income sources and entries
- Spend categories and monthly expenses
- Inter-couple balance and history
- Deleted history log

## Optional: local browser backup

The app also keeps a copy in browser `localStorage`. Before switching projects, you can open DevTools → Application → Local Storage and note keys starting with `couple-finance`. The cloud backup above is the source of truth.
