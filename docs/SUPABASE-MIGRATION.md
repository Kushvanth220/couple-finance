# Supabase migration (keep your data)

Your finance data is bundled in the app at `src/data/household-finance.json`.
On first load, the app uses that snapshot and uploads it to Supabase when the cloud is empty.

## Before you delete the old Supabase project

```bash
npm run backup:supabase
```

Copy the `backups/` folder somewhere safe.

## Set up the new Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the entire file: `supabase/setup.sql`
3. Copy **Project URL** and **anon public key** from Settings → API.

## Local `.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-NEW-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_new_anon_key
NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY=grik-finance-couple
```

Restart dev server after saving:

```bash
npm run dev
```

Open http://localhost:3000 — data loads from the bundled snapshot and syncs to the new cloud automatically.

## Vercel deploy

1. Push this repo to GitHub.
2. In Vercel → Project → Settings → Environment Variables, set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY` = `grik-finance-couple`
3. Redeploy.
4. Open your live site once — it seeds the new Supabase project automatically.

Optional manual restore (instead of waiting for first app load):

```bash
npm run restore:supabase
```

## Update bundled data later

After exporting fresh cloud data:

```bash
npm run backup:supabase
npm run seed:generate
```

Then commit `src/data/household-finance.json` and redeploy.

## What's included

- 136 transactions
- 14 accounts
- 36 income entries
- 9 debts
- Inter-couple history and balance
- Deleted history log
