import { OWNER_LABEL, PARTNER_LABEL } from "@/lib/branding";
/** Static domain knowledge injected into assistant system instructions. */
export function buildAssistantKnowledgeBlock(): string {
  return `APP & DATA MODEL (KG Finance):
- Client state: Zustand finance-store (localStorage) synced to Supabase table household_finance (JSONB FinanceState).
- People: kushvanth, grishma. Ask who is speaking first. Accounts can be private or shared (shared flag).
- Transaction types: income, expense, transfer, cash_withdrawal, cash_deposit, debt_payment, credit_payment, inter_couple, balance_adjustment.
- Spend page fields: expense_for (kushvanth | grishma | both), paid_by (kushvanth | grishma | split), expenseShares for split amounts, account per payer.
- interCoupleBalance: positive means ${PARTNER_LABEL} owes ${OWNER_LABEL}; negative means ${OWNER_LABEL} owes ${PARTNER_LABEL}.
- Debts are per-person notes; payments can reduce debt and optionally debit an account.
- All amounts are USD. Use calculation tools for totals — do not guess from memory.

CALCULATION RULES:
- Monthly spend = sum of expense transactions in calendar month (respecting expenseShares per person).
- Monthly income = sum of income entries in calendar month per person.
- Net worth = account balances minus outstanding debt (use calculate_net_worth tool).
- Split expense: expense_for both with paid_by grishma means ${PARTNER_LABEL} paid the total and each owes half. Shares must equal the total; inter-couple updates when one person pays for another's share.
- Always run a read-only calculation tool before stating totals or before record_expense when math is non-trivial.`;
}
