# Couple Finance

Personal finance management for **Kushvanth** and **Grishma**, built with a Liquid Glass–inspired Apple UI. Designed as a responsive web app that can later be wrapped as an iPhone app.

## Features

- **Dashboard** — Household overview with charts, credit utilization, and couple summary
- **Spend** — Quick expense entry with payment method selection and cash withdrawal flow
- **Income** — Track income by source with monthly/yearly totals
- **Expenses** — Editable recurring and one-time monthly expenses (e.g. Mama $2,000 in August)
- **Accounts** — Credit cards, debit accounts, and cash wallets with live balances
- **Debts** — Outstanding debts with payment tracking
- **Between Us** — Money owed between partners with full history
- **History** — Complete transaction log

All data persists in your browser via localStorage. Optional **Supabase cloud sync** keeps both partners in sync across devices.

## Cloud Sync (Supabase)

1. Create a [Supabase](https://supabase.com) project (free tier is fine).
2. In **Project Settings → API**, copy the project URL and anon key.
3. Copy `.env.local.example` to `.env.local` and paste those values.
4. In the Supabase **SQL Editor**, run `supabase/migrations/001_household_finance.sql`.
5. Restart the dev server (`npm run dev`).
6. Open **Sync** in the app header, create one shared account, and sign in on every device with the same email and password.

Changes sync automatically within a second or two. Without sign-in, the app still works locally only.

## Getting Started

```bash
cd couple-finance
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS 4
- Zustand (state + persistence)
- Supabase (optional cloud sync)
- Recharts (dashboard charts)
- Lucide React (icons)

## Future Roadmap

Architecture supports adding: budget planning, investments, savings goals, bill reminders, export, Face ID, notifications, and AI insights.
