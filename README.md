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

All data persists in your browser via localStorage.

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
- Recharts (dashboard charts)
- Lucide React (icons)

## Future Roadmap

Architecture supports adding: budget planning, investments, savings goals, bill reminders, export, cloud sync, Face ID, notifications, and AI insights.
