# Couple Finance (Grik Finance)

Personal finance app for Kushvanth & Grishma.

## Cloud sync between 2 phones (no login)

Both phones open the **same Vercel URL**. Changes sync automatically every 5 seconds.

---

## Part 1 — Create Supabase project

1. Go to **[supabase.com](https://supabase.com)** and sign in (GitHub is easiest).
2. Click **New project**.
3. Fill in:
   - **Name:** `grik-finance` (or anything)
   - **Database password:** choose a strong password (save it somewhere)
   - **Region:** pick closest to you (e.g. `East US`)
4. Click **Create new project** and wait ~2 minutes.

### Run the database setup

1. In Supabase, open **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open the file `supabase/setup.sql` from this repo, copy **all** of it, paste into the editor.
4. Click **Run** (or Ctrl+Enter).
5. You should see **Success. No rows returned**.

### Copy your API keys

1. In Supabase, go to **Project Settings** (gear icon) → **API**.
2. Copy these two values:
   - **Project URL** → looks like `https://abcdefgh.supabase.co`
   - **anon public** key → long string under "Project API keys"

---

## Part 2 — Local setup (optional, for testing)

1. Copy `.env.local.example` to `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-ID.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```
2. Paste your real URL and anon key from Supabase.
3. Run:
   ```bash
   npm install
   npm run dev
   ```
4. Open [http://localhost:3000/sync](http://localhost:3000/sync) → click **Test connection** → all green ✓

---

## Part 3 — Push to GitHub (GitHub Desktop)

1. Open **GitHub Desktop**.
2. **File → Add local repository** → select the `couple-finance` folder.
3. If it asks to create a repo, click **Create a repository**:
   - Name: `couple-finance`
   - Keep "Initialize with README" **unchecked** (you already have files)
4. Review changed files in the left panel (should **not** include `.env.local` — that stays private).
5. Write a commit message, e.g. `Add Supabase cloud sync`.
6. Click **Commit to main**.
7. Click **Publish repository** (or **Push origin** if already published).

> **Important:** Never commit `.env.local`. It is in `.gitignore`.

---

## Part 4 — Deploy on Vercel

1. Go to **[vercel.com](https://vercel.com)** and sign in with GitHub.
2. Click **Add New… → Project**.
3. Import your `couple-finance` repository.
4. Before clicking Deploy, expand **Environment Variables** and add:

   | Name | Value |
   |------|--------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT-ID.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key from Supabase |

5. Click **Deploy** and wait for the build to finish.
6. Open your Vercel URL (e.g. `https://couple-finance.vercel.app`).

### After changing env vars on Vercel

Always click **Redeploy** (Deployments → ⋯ → Redeploy) so the new keys are baked into the build.

---

## Part 5 — Use on both phones

1. Open the **same Vercel URL** on phone 1 and phone 2.
2. Header should show **Synced** (tap it to open `/sync`).
3. On phone 1: add a spend or income.
4. On phone 2: wait ~5 seconds, or go to **Sync → Download latest**.

No login. No password. Same URL = same data.

---

## Troubleshooting

| Header shows | Fix |
|--------------|-----|
| **Setup sync** | Add env vars on Vercel and redeploy |
| **Sync error** | Open `/sync` → **Test connection** — follow the red message |
| Table missing | Run `supabase/setup.sql` again in Supabase SQL Editor |
| Phones out of sync | Both must use the **exact same Vercel URL** |

---

## Tech stack

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Zustand (local state + localStorage)
- Supabase (cloud sync, no auth)
