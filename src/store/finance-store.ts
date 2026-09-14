"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { format } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import {
  buildBalanceAdjustmentMessage,
  buildCashWithdrawalMessage,
  buildDebtAutoMessage,
  buildDebtNotePaymentMessage,
  buildExpenseAutoMessage,
  buildIncomeAutoMessage,
  buildInterCoupleAutoMessage,
  buildRefundBetweenUsMessage,
  buildExternalBetweenUsMessage,
  getCategorySpentThisMonth,
  getPaymentMethodLabel,
} from "@/lib/transaction-messages";
import { getMonthlyExpensePaid } from "@/lib/monthly-expense-tracker";
import {
  applyTransactionDeletion,
  ensureInterCoupleBaseline,
  findIncomeTransactionForEntry,
  getInterCoupleUpdatesFromShares,
  recalculateInterCoupleState,
  reverseDepositToAccount,
  type ExpenseShares,
} from "@/lib/transaction-reversal";
import { buildDeletedHistoryRecord } from "@/lib/deleted-history";
import { applySharedAccountNormalization } from "@/lib/accounts";
import { celebrateBetweenUsUpdate } from "@/lib/between-us-celebration";
import { clearPersistedAppData, FINANCE_STORAGE_KEY } from "@/lib/reset-app-data";
import { pickRicherState, scoreFinanceState } from "@/lib/recover-finance-data";
import { parseAppDateTime } from "@/lib/formatters";
import { seedData } from "@/lib/seed-data";
import type {
  Account,
  Debt,
  FlexDeposit,
  FinanceState,
  IncomeEntry,
  IncomeSource,
  InterCoupleEntry,
  MonthlyExpense,
  Person,
  Transaction,
  TransactionType,
} from "@/types";

interface SpendOptions {
  person: Person;
  amount: number;
  accountId: string;
  cashSourceAccountId?: string;
  category?: string;
  notes?: string;
  beneficiaryPerson?: Person;
  skipInterCouple?: boolean;
  monthlyExpenseId?: string;
  expenseOwner?: Person;
  plannedAmount?: number;
  expenseShares?: ExpenseShares;
  /** Day the money left (yyyy-MM-dd). Today when absent; the clock time is kept. */
  date?: string;
  /** Money coming BACK into the account — stored as a negative expense. */
  refund?: boolean;
}

interface SpendSplitOptions {
  category: string;
  expenseOwner?: Person;
  expenseShares?: ExpenseShares;
  notes?: string;
  payments: SplitPayment[];
  monthlyExpenseId?: string;
  plannedAmount?: number;
  /** Day the money left (yyyy-MM-dd). Today when absent. */
  date?: string;
}

interface SplitPayment {
  person: Person;
  amount: number;
  accountId: string;
  cashSourceAccountId?: string;
}

interface PayDebtForOtherOptions {
  paidBy: Person;
  debtId: string;
  amount: number;
  fromAccountId: string;
  cashSourceAccountId?: string;
}

interface FinanceActions {
  addIncomeSource: (person: Person, name: string) => void;
  updateIncomeSource: (id: string, name: string) => void;
  deleteIncomeSource: (id: string) => void;
  /** An explicit id makes a posting idempotent: the same id is never added twice. */
  addIncome: (entry: Omit<IncomeEntry, "id"> & { id?: string }) => void;
  updateIncome: (id: string, updates: Partial<IncomeEntry>) => void;
  deleteIncome: (id: string, deletedBy?: Person) => void;

  /** A Flex payout that landed. Skips an id already present, so two phones agree. */
  addFlexDeposit: (deposit: FlexDeposit) => void;
  updateFlexDeposit: (id: string, updates: Partial<FlexDeposit>) => void;
  removeFlexDeposit: (id: string) => void;

  addSpendCategory: (name: string, keywords?: string[]) => void;
  updateSpendCategory: (id: string, updates: Partial<import("@/types").SpendCategory>) => void;
  deleteSpendCategory: (id: string) => void;

  addMonthlyExpense: (expense: Omit<MonthlyExpense, "id">) => void;
  updateMonthlyExpense: (id: string, updates: Partial<MonthlyExpense>) => void;
  deleteMonthlyExpense: (id: string) => void;
  markOneTimeExpensePaid: (id: string) => void;

  addAccount: (account: Omit<Account, "id">) => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  adjustAccountBalance: (id: string, newBalance: number, notes?: string) => void;
  deleteAccount: (id: string) => void;

  addDebt: (debt: Omit<Debt, "id">) => void;
  updateDebt: (id: string, updates: Partial<Debt>) => void;
  deleteDebt: (id: string) => void;
  payDebt: (debtId: string, amount: number, fromAccountId: string, notes?: string) => void;
  payDebtForOther: (options: PayDebtForOtherOptions) => void;
  recordDebtPayment: (debtId: string, amountPaid: number, notes?: string) => void;
  markDebtCleared: (debtId: string, notes?: string) => void;

  /** Returns the id of the expense row it wrote, so the caller can undo it. */
  spend: (options: SpendOptions) => string | null;
  /** Returns the ids of the expense rows it wrote, one per payer. */
  spendSplit: (options: SpendSplitOptions) => string[];
  recordInterCouple: (
    paidBy: Person,
    benefited: Person,
    amount: number,
    notes?: string
  ) => void;
  recordExternalBetweenUs: (options: {
    paidBy: Person;
    benefited: Person;
    amount: number;
    notes: string;
  }) => void;
  updateInterCoupleBalance: (amount: number) => void;

  deleteTransaction: (id: string, deletedBy: Person) => void;
  resetToSeed: () => void;
}

type FinanceStore = typeof seedData & FinanceActions;

function nowParts() {
  const now = new Date();
  return {
    date: format(now, "yyyy-MM-dd"),
    time: format(now, "HH:mm:ss"),
    timestamp: now.toISOString(),
  };
}

/**
 * Stamp for a spend on a chosen day: that date with the current clock time,
 * so yesterday's coffee lands on yesterday and still sorts after yesterday's
 * breakfast. Today (or no date) is just now.
 */
function partsForDate(date?: string) {
  const now = nowParts();
  if (!date || date === now.date) return now;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return now;
  const clock = new Date();
  const when = new Date(year, month - 1, day, clock.getHours(), clock.getMinutes(), clock.getSeconds());
  if (Number.isNaN(when.getTime())) return now;
  return { date, time: format(when, "HH:mm:ss"), timestamp: when.toISOString() };
}

function syncLinkedDebt(
  debts: Debt[],
  accountId: string,
  newBalance: number
): Debt[] {
  return debts.map((debt) =>
    debt.linkedAccountId === accountId ? { ...debt, amount: newBalance } : debt
  );
}

function createTransaction(
  type: TransactionType,
  person: Person,
  amount: number,
  extra: Partial<Transaction> = {},
  at?: { date: string; time: string; timestamp: string }
): Transaction {
  const { date, time, timestamp } = at ?? nowParts();
  return {
    id: uuidv4(),
    type,
    person,
    amount,
    date,
    time,
    timestamp,
    ...extra,
  };
}

function withRecalculatedInterCouple(history: InterCoupleEntry[]) {
  return recalculateInterCoupleState(history);
}

function updateInterCoupleFromSpend(
  paidBy: Person,
  beneficiary: Person | undefined,
  amount: number,
  currentBalance: number,
  autoMessage?: string,
  sourceTransactionId?: string,
  entryNotes?: string,
  at?: { date: string; time: string; timestamp: string }
): { balance: number; entry?: InterCoupleEntry } {
  if (!beneficiary || paidBy === beneficiary) {
    return { balance: currentBalance };
  }

  const { date, time, timestamp } = at ?? nowParts();
  let newBalance = currentBalance;

  if (paidBy === "kushvanth" && beneficiary === "grishma") {
    newBalance += amount;
  } else if (paidBy === "grishma" && beneficiary === "kushvanth") {
    newBalance -= amount;
  }

  const message =
    autoMessage ??
    buildInterCoupleAutoMessage({ paidBy, benefited: beneficiary, amount });

  return {
    balance: newBalance,
    entry: {
      id: uuidv4(),
      date,
      time,
      timestamp,
      amount,
      paidBy,
      benefited: beneficiary,
      notes: entryNotes,
      autoMessage: message,
      runningBalance: newBalance,
      sourceTransactionId,
    },
  };
}

function applyPaymentFromAccount(
  accounts: Account[],
  debts: Debt[],
  person: Person,
  amount: number,
  accountId: string,
  cashSourceAccountId?: string
): { accounts: Account[]; debts: Debt[] } | null {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  let nextAccounts = [...accounts];
  let nextDebts = [...debts];

  if (account.type === "cash" && cashSourceAccountId) {
    const source = nextAccounts.find((a) => a.id === cashSourceAccountId);
    if (!source) return null;
    nextAccounts = nextAccounts.map((a) => {
      if (a.id === cashSourceAccountId) return { ...a, balance: a.balance - amount };
      return a;
    });
  } else if (account.type === "cash") {
    nextAccounts = nextAccounts.map((a) =>
      a.id === accountId ? { ...a, balance: a.balance - amount } : a
    );
  } else if (account.type === "debit") {
    nextAccounts = nextAccounts.map((a) =>
      a.id === accountId ? { ...a, balance: a.balance - amount } : a
    );
  } else if (account.type === "credit") {
    const newBalance = account.balance + amount;
    nextAccounts = nextAccounts.map((a) =>
      a.id === accountId ? { ...a, balance: newBalance } : a
    );
    nextDebts = syncLinkedDebt(nextDebts, accountId, newBalance);
  }

  return { accounts: nextAccounts, debts: nextDebts };
}

function creditAccount(
  accounts: Account[],
  accountId: string,
  amount: number
): Account[] {
  return accounts.map((a) =>
    a.id === accountId ? { ...a, balance: a.balance + amount } : a
  );
}

export const useFinanceStore = create<FinanceStore>()(
  persist(
    (set) => ({
      ...seedData,

      addIncomeSource: (person, name) =>
        set((state) => ({
          incomeSources: [...state.incomeSources, { id: uuidv4(), person, name }],
        })),

      updateIncomeSource: (id, name) =>
        set((state) => ({
          incomeSources: state.incomeSources.map((source) =>
            source.id === id ? { ...source, name } : source
          ),
        })),

      deleteIncomeSource: (id) =>
        set((state) => ({
          incomeSources: state.incomeSources.filter((source) => source.id !== id),
        })),

      addIncome: (entry) =>
        set((state) => {
          if (entry.id && state.incomeEntries.some((item) => item.id === entry.id)) return state;
          const sourceName = state.incomeSources.find((s) => s.id === entry.sourceId)?.name;
          const depositAccount = state.accounts.find((a) => a.id === entry.depositAccountId);
          if (!depositAccount) return state;

          const accounts = creditAccount(state.accounts, entry.depositAccountId, entry.amount);
          const paymentMethod = getPaymentMethodLabel(
            state.accounts,
            entry.depositAccountId
          );
          const depositLabel =
            entry.depositType === "cash" ? "Cash Wallet" : depositAccount.name;

          const autoMessage = buildIncomeAutoMessage({
            person: entry.person,
            amount: entry.amount,
            source: sourceName ?? "Income",
            paymentMethod: depositLabel,
          });

          const { time } = nowParts();
          const recordAt = {
            date: entry.date,
            time,
            timestamp: parseAppDateTime(entry.date, time).toISOString(),
          };

          const transaction = createTransaction(
            "income",
            entry.person,
            entry.amount,
            {
              category: sourceName,
              accountId: entry.depositAccountId,
              paymentMethod,
              autoMessage,
              notes: entry.notes,
            },
            recordAt
          );

          return {
            accounts,
            incomeEntries: [
              ...state.incomeEntries,
              { ...entry, id: entry.id ?? uuidv4(), time: recordAt.time, timestamp: recordAt.timestamp },
            ],
            transactions: [transaction, ...state.transactions],
          };
        }),

      updateIncome: (id, updates) =>
        set((state) => ({
          incomeEntries: state.incomeEntries.map((entry) =>
            entry.id === id ? { ...entry, ...updates } : entry
          ),
        })),

      /**
       * addIncome credits an account AND writes a History row, so removing the
       * entry alone would leave the balance inflated and the row orphaned.
       * Delete through the transaction so the balance is reversed and audited.
       */
      addFlexDeposit: (deposit) =>
        set((state) => {
          const current = state.flexDeposits ?? [];
          if (current.some((d) => d.id === deposit.id)) return state;
          return { flexDeposits: [...current, deposit] };
        }),

      updateFlexDeposit: (id, updates) =>
        set((state) => ({
          flexDeposits: (state.flexDeposits ?? []).map((d) => (d.id === id ? { ...d, ...updates } : d)),
        })),

      removeFlexDeposit: (id) =>
        set((state) => ({ flexDeposits: (state.flexDeposits ?? []).filter((d) => d.id !== id) })),

      deleteIncome: (id, deletedBy) =>
        set((state) => {
          const entry = state.incomeEntries.find((item) => item.id === id);
          if (!entry) return state;

          const linked = findIncomeTransactionForEntry(entry, state.transactions);

          if (linked) {
            const result = applyTransactionDeletion({
              accounts: state.accounts,
              debts: state.debts,
              transactions: state.transactions,
              incomeEntries: state.incomeEntries,
              interCoupleHistory: state.interCoupleHistory,
              interCoupleBalance: state.interCoupleBalance,
              monthlyExpenses: state.monthlyExpenses,
              transactionId: linked.id,
            });

            if (result) {
              const { deletionAudit, ...nextState } = result;
              return {
                ...nextState,
                // The reversal matches on field equality, so drop this entry explicitly.
                incomeEntries: nextState.incomeEntries.filter((item) => item.id !== id),
                deletedHistory: [
                  ...(state.deletedHistory ?? []),
                  buildDeletedHistoryRecord({
                    primaryTransactionId: deletionAudit.primaryTransactionId,
                    removedTransactions: deletionAudit.removedTransactions,
                    removedInterCoupleEntries: deletionAudit.removedInterCoupleEntries,
                    removedIncomeEntry: deletionAudit.removedIncomeEntry ?? entry,
                    monthlyExpense: deletionAudit.monthlyExpense,
                    accounts: state.accounts,
                    debts: state.debts,
                    incomeSources: state.incomeSources,
                    deletedBy: deletedBy ?? entry.person,
                  }),
                ],
              };
            }
          }

          // Legacy entry with no History row — still undo the deposit.
          return {
            accounts: reverseDepositToAccount(
              state.accounts,
              entry.depositAccountId,
              entry.amount
            ),
            incomeEntries: state.incomeEntries.filter((item) => item.id !== id),
          };
        }),

      addSpendCategory: (name, keywords) =>
        set((state) => ({
          spendCategories: [
            ...state.spendCategories,
            { id: uuidv4(), name: name.trim(), keywords: keywords?.filter(Boolean) },
          ],
        })),

      updateSpendCategory: (id, updates) =>
        set((state) => ({
          spendCategories: state.spendCategories.map((category) =>
            category.id === id ? { ...category, ...updates } : category
          ),
        })),

      deleteSpendCategory: (id) =>
        set((state) => ({
          spendCategories: state.spendCategories.filter((category) => category.id !== id),
        })),

      addMonthlyExpense: (expense) =>
        set((state) => ({
          monthlyExpenses: [...state.monthlyExpenses, { ...expense, id: uuidv4() }],
        })),

      updateMonthlyExpense: (id, updates) =>
        set((state) => ({
          monthlyExpenses: state.monthlyExpenses.map((expense) =>
            expense.id === id ? { ...expense, ...updates } : expense
          ),
        })),

      deleteMonthlyExpense: (id) =>
        set((state) => ({
          monthlyExpenses: state.monthlyExpenses.filter((expense) => expense.id !== id),
        })),

      markOneTimeExpensePaid: (id) =>
        set((state) => ({
          monthlyExpenses: state.monthlyExpenses.map((expense) =>
            expense.id === id ? { ...expense, isPaid: true } : expense
          ),
        })),

      addAccount: (account) =>
        set((state) => ({
          accounts: [...state.accounts, { ...account, id: uuidv4() }],
        })),

      updateAccount: (id, updates) =>
        set((state) => {
          const accounts = state.accounts.map((account) =>
            account.id === id ? { ...account, ...updates } : account
          );
          const updated = accounts.find((a) => a.id === id);
          let debts = state.debts;
          if (updated?.type === "credit") {
            debts = syncLinkedDebt(debts, id, updated.balance);
          }
          return { accounts, debts };
        }),

      deleteAccount: (id) =>
        set((state) => ({
          accounts: state.accounts.filter((a) => a.id !== id),
        })),

      adjustAccountBalance: (id, newBalance, notes) =>
        set((state) => {
          const account = state.accounts.find((a) => a.id === id);
          if (!account) return state;

          const accounts = state.accounts.map((a) =>
            a.id === id ? { ...a, balance: newBalance } : a
          );
          let debts = state.debts;
          if (account.type === "credit") {
            debts = syncLinkedDebt(debts, id, newBalance);
          }

          const autoMessage = buildBalanceAdjustmentMessage({
            person: account.person,
            accountName: account.name,
            notes: notes ?? "Manual balance update",
          });

          const transaction = createTransaction(
            "balance_adjustment",
            account.person,
            Math.abs(newBalance - account.balance),
            {
              accountId: id,
              paymentMethod: account.name,
              autoMessage,
              notes: notes ?? "Manual balance update",
              previousBalance: account.balance,
            }
          );

          return {
            accounts,
            debts,
            transactions: [transaction, ...state.transactions],
          };
        }),

      addDebt: (debt) =>
        set((state) => ({
          debts: [...state.debts, { ...debt, id: uuidv4() }],
        })),

      updateDebt: (id, updates) =>
        set((state) => ({
          debts: state.debts.map((debt) =>
            debt.id === id ? { ...debt, ...updates } : debt
          ),
        })),

      deleteDebt: (id) =>
        set((state) => ({
          debts: state.debts.filter((debt) => debt.id !== id),
        })),

      payDebt: (debtId, amount, fromAccountId, notes) =>
        set((state) => {
          const debt = state.debts.find((d) => d.id === debtId);
          const fromAccount = state.accounts.find((a) => a.id === fromAccountId);
          if (!debt || !fromAccount) return state;

          const applied = applyPaymentFromAccount(
            state.accounts,
            state.debts,
            fromAccount.person,
            amount,
            fromAccountId
          );
          if (!applied) return state;

          let { accounts, debts } = applied;

          if (debt.linkedAccountId) {
            const linked = accounts.find((a) => a.id === debt.linkedAccountId);
            if (linked) {
              const newBal = Math.max(0, linked.balance - amount);
              accounts = accounts.map((a) =>
                a.id === debt.linkedAccountId ? { ...a, balance: newBal } : a
              );
              debts = syncLinkedDebt(debts, debt.linkedAccountId!, newBal);
            }
          }

          const newDebtAmount = Math.max(0, debt.amount - amount);
          debts = debts.map((d) =>
            d.id === debtId ? { ...d, amount: newDebtAmount } : d
          );

          const paymentMethod = getPaymentMethodLabel(state.accounts, fromAccountId);
          const autoMessage = buildDebtAutoMessage({
            paidBy: fromAccount.person,
            amount,
            debtName: debt.name,
            paymentMethod,
            debtOwner: debt.person,
            debtRemaining: newDebtAmount,
          });

          const transaction = createTransaction(
            debt.linkedAccountId ? "credit_payment" : "debt_payment",
            debt.person,
            amount,
            {
              accountId: fromAccountId,
              targetAccountId: debt.linkedAccountId,
              category: debt.name,
              paymentMethod,
              autoMessage,
              debtRemaining: newDebtAmount,
              paidByPerson: fromAccount.person,
            }
          );

          return {
            accounts,
            debts,
            transactions: [transaction, ...state.transactions],
          };
        }),

      payDebtForOther: (options) => {
        const newInterEntries: InterCoupleEntry[] = [];
        set((state) => {
          const { paidBy, debtId, amount, fromAccountId, cashSourceAccountId } = options;
          const debt = state.debts.find((d) => d.id === debtId);
          if (!debt) return state;

          const applied = applyPaymentFromAccount(
            state.accounts,
            state.debts,
            paidBy,
            amount,
            fromAccountId,
            cashSourceAccountId
          );
          if (!applied) return state;

          let { accounts, debts } = applied;

          if (debt.linkedAccountId) {
            const linked = accounts.find((a) => a.id === debt.linkedAccountId);
            if (linked) {
              const newBal = Math.max(0, linked.balance - amount);
              accounts = accounts.map((a) =>
                a.id === debt.linkedAccountId ? { ...a, balance: newBal } : a
              );
              debts = syncLinkedDebt(debts, debt.linkedAccountId!, newBal);
            }
          }

          const newDebtAmount = Math.max(0, debt.amount - amount);
          debts = debts.map((d) =>
            d.id === debtId ? { ...d, amount: newDebtAmount } : d
          );

          const paymentMethod = getPaymentMethodLabel(
            state.accounts,
            fromAccountId,
            cashSourceAccountId
          );
          const autoMessage = buildDebtAutoMessage({
            paidBy,
            amount,
            debtName: debt.name,
            paymentMethod,
            debtOwner: debt.person,
            debtRemaining: newDebtAmount,
          });

          const transaction = createTransaction(
            debt.linkedAccountId ? "credit_payment" : "debt_payment",
            paidBy,
            amount,
            {
              accountId: fromAccountId,
              targetAccountId: debt.linkedAccountId,
              category: debt.name,
              paymentMethod,
              autoMessage,
              debtRemaining: newDebtAmount,
              paidByPerson: paidBy,
              beneficiaryPerson: debt.person,
            }
          );

          let interCoupleBalance = state.interCoupleBalance;
          let interCoupleHistory = state.interCoupleHistory;

          if (paidBy !== debt.person) {
            const interUpdate = updateInterCoupleFromSpend(
              paidBy,
              debt.person,
              amount,
              state.interCoupleBalance,
              autoMessage,
              transaction.id
            );
            interCoupleBalance = interUpdate.balance;
            if (interUpdate.entry) {
              newInterEntries.push(interUpdate.entry);
              interCoupleHistory = [interUpdate.entry, ...interCoupleHistory];
            }
          }

          const inter = withRecalculatedInterCouple(interCoupleHistory);

          return {
            accounts,
            debts,
            transactions: [transaction, ...state.transactions],
            interCoupleBalance: inter.interCoupleBalance,
            interCoupleHistory: inter.interCoupleHistory,
          };
        });
        celebrateBetweenUsUpdate(
          newInterEntries,
          useFinanceStore.getState().interCoupleBalance
        );
      },

      recordDebtPayment: (debtId, amountPaid, notes) =>
        set((state) => {
          const debt = state.debts.find((d) => d.id === debtId);
          if (!debt || amountPaid <= 0) return state;

          const appliedAmount = Math.min(amountPaid, debt.amount);
          const newDebtAmount = Math.max(0, debt.amount - appliedAmount);
          const debts = state.debts.map((d) =>
            d.id === debtId ? { ...d, amount: newDebtAmount } : d
          );

          const autoMessage = buildDebtNotePaymentMessage({
            debtOwner: debt.person,
            amountPaid: appliedAmount,
            debtName: debt.name,
            debtRemaining: newDebtAmount,
            cleared: newDebtAmount <= 0,
            notes,
          });

          const transaction = createTransaction("debt_payment", debt.person, appliedAmount, {
            category: debt.name,
            paymentMethod: "Debt note",
            autoMessage,
            notes,
            debtRemaining: newDebtAmount,
            paidByPerson: debt.person,
          });

          return {
            debts,
            transactions: [transaction, ...state.transactions],
          };
        }),

      markDebtCleared: (debtId, notes) =>
        set((state) => {
          const debt = state.debts.find((d) => d.id === debtId);
          if (!debt || debt.amount <= 0) return state;

          const clearedAmount = debt.amount;
          const debts = state.debts.map((d) =>
            d.id === debtId ? { ...d, amount: 0 } : d
          );

          const autoMessage = buildDebtNotePaymentMessage({
            debtOwner: debt.person,
            amountPaid: clearedAmount,
            debtName: debt.name,
            debtRemaining: 0,
            cleared: true,
            notes,
          });

          const transaction = createTransaction("debt_payment", debt.person, clearedAmount, {
            category: debt.name,
            paymentMethod: "Debt note",
            autoMessage,
            notes,
            debtRemaining: 0,
            paidByPerson: debt.person,
          });

          return {
            debts,
            transactions: [transaction, ...state.transactions],
          };
        }),

      spend: (options) => {
        const newInterEntries: InterCoupleEntry[] = [];
        let writtenId: string | null = null;
        set((state) => {
          const {
            person,
            amount: rawAmount,
            accountId,
            cashSourceAccountId,
            category,
            notes,
            beneficiaryPerson,
            skipInterCouple,
            monthlyExpenseId,
            expenseOwner,
            plannedAmount,
            expenseShares: rawShares,
            date,
          } = options;

          // A refund is the same row with the sign flipped: the account gets
          // the money back, and every monthly sum nets it out on its own.
          const refund = options.refund === true || rawAmount < 0;
          const magnitude = Math.abs(rawAmount);
          const amount = refund ? -magnitude : magnitude;
          const expenseShares =
            rawShares && refund
              ? (Object.fromEntries(
                  Object.entries(rawShares).map(([who, share]) => [who, -Math.abs(share ?? 0)])
                ) as ExpenseShares)
              : rawShares;
          const at = partsForDate(date);

          const applied = applyPaymentFromAccount(
            state.accounts,
            state.debts,
            person,
            amount,
            accountId,
            cashSourceAccountId
          );
          if (!applied) return state;

          const paymentMethod = getPaymentMethodLabel(
            state.accounts,
            accountId,
            cashSourceAccountId
          );

          const owner = expenseOwner ?? beneficiaryPerson ?? person;
          const expenseItem = monthlyExpenseId
            ? state.monthlyExpenses.find((e) => e.id === monthlyExpenseId)
            : null;
          const categoryPaidBefore =
            expenseItem && plannedAmount != null
              ? getMonthlyExpensePaid(state.transactions, expenseItem)
              : category && plannedAmount != null
                ? getCategorySpentThisMonth(state.transactions, category, owner)
                : undefined;
          const categoryRemaining =
            plannedAmount != null && categoryPaidBefore != null
              ? Math.max(0, plannedAmount - categoryPaidBefore - amount)
              : undefined;

          const autoMessage = buildExpenseAutoMessage({
            paidBy: person,
            amount,
            category: category ?? "expense",
            paymentMethod,
            expenseOwner: expenseShares ? undefined : owner,
            expenseShares,
            plannedAmount,
            categoryRemaining,
            refund,
          });

          const newTransactions: Transaction[] = [];

          // Only a CASH payment is topped up from another account. Without this
          // check a stray cashSourceAccountId on a debit/credit payment wrote a
          // phantom "withdrew $60 cash" row next to the real expense — two $60
          // lines in History for one spend. applyPaymentFromAccount already
          // guards the balances the same way; this keeps the ledger in step.
          const payingAccount = state.accounts.find((a) => a.id === accountId);
          if (cashSourceAccountId && payingAccount?.type === "cash" && !refund) {
            const source = state.accounts.find((a) => a.id === cashSourceAccountId);
            newTransactions.push(
              createTransaction(
                "cash_withdrawal",
                person,
                amount,
                {
                  accountId,
                  sourceAccountId: cashSourceAccountId,
                  category,
                  paymentMethod: source?.name,
                  autoMessage: buildCashWithdrawalMessage({
                    person,
                    amount,
                    fromAccount: source?.name ?? "debit",
                    forCategory: category,
                  }),
                },
                at
              )
            );
          }

          newTransactions.push(
            createTransaction(
              "expense",
              person,
              amount,
              {
                accountId,
                sourceAccountId: refund ? undefined : cashSourceAccountId,
                category,
                paymentMethod,
                autoMessage,
                notes,
                beneficiaryPerson,
                paidByPerson: person,
                expenseOwner: owner,
                expenseShares,
                monthlyExpenseId,
                plannedAmount,
                categoryPaidBefore,
                categoryRemaining,
                refund: refund || undefined,
              },
              at
            )
          );

          const expenseTransaction = newTransactions[newTransactions.length - 1]!;
          writtenId = expenseTransaction.id;

          let interCoupleBalance = state.interCoupleBalance;
          let interCoupleHistory = state.interCoupleHistory;

          // A refund runs Between Us backwards: the other person's share came
          // back, so it is recorded as them paying the buyer — positive
          // amounts in the history, balance moving the other way.
          if (expenseShares) {
            const absShares = Object.fromEntries(
              Object.entries(expenseShares).map(([who, share]) => [who, Math.abs(share ?? 0)])
            ) as ExpenseShares;
            for (const { benefited, amount: shareAmount } of getInterCoupleUpdatesFromShares(
              person,
              absShares
            )) {
              const interMsg = refund
                ? buildRefundBetweenUsMessage({ buyer: person, benefited, amount: shareAmount })
                : buildInterCoupleAutoMessage({
                    paidBy: person,
                    benefited,
                    amount: shareAmount,
                  });
              const interUpdate = updateInterCoupleFromSpend(
                refund ? benefited : person,
                refund ? person : benefited,
                shareAmount,
                interCoupleBalance,
                refund ? interMsg : `${interMsg} (${category ?? "expense"} shared)`,
                expenseTransaction.id,
                undefined,
                at
              );
              interCoupleBalance = interUpdate.balance;
              if (interUpdate.entry) {
                newInterEntries.push(interUpdate.entry);
                interCoupleHistory = [interUpdate.entry, ...interCoupleHistory];
              }
            }
          } else {
            const benefitPerson =
              beneficiaryPerson ??
              (expenseOwner && expenseOwner !== person ? expenseOwner : undefined);

            if (!skipInterCouple && benefitPerson && benefitPerson !== person) {
              const interMsg = refund
                ? buildRefundBetweenUsMessage({ buyer: person, benefited: benefitPerson, amount: magnitude })
                : buildInterCoupleAutoMessage({
                    paidBy: person,
                    benefited: benefitPerson,
                    amount,
                  });
              const interUpdate = updateInterCoupleFromSpend(
                refund ? benefitPerson : person,
                refund ? person : benefitPerson,
                magnitude,
                interCoupleBalance,
                interMsg,
                expenseTransaction.id,
                undefined,
                at
              );
              interCoupleBalance = interUpdate.balance;
              if (interUpdate.entry) {
                newInterEntries.push(interUpdate.entry);
                interCoupleHistory = [interUpdate.entry, ...interCoupleHistory];
              }
            }
          }

          const inter = withRecalculatedInterCouple(interCoupleHistory);

          return {
            accounts: applied.accounts,
            debts: applied.debts,
            transactions: [...newTransactions, ...state.transactions],
            interCoupleBalance: inter.interCoupleBalance,
            interCoupleHistory: inter.interCoupleHistory,
          };
        });
        celebrateBetweenUsUpdate(
          newInterEntries,
          useFinanceStore.getState().interCoupleBalance
        );
        return writtenId;
      },

      spendSplit: (options) => {
        const newInterEntries: InterCoupleEntry[] = [];
        const writtenIds: string[] = [];
        set((state) => {
          const {
            category,
            expenseOwner,
            expenseShares,
            notes,
            payments,
            monthlyExpenseId,
            plannedAmount,
            date,
          } = options;
          if (payments.length === 0) return state;
          const at = partsForDate(date);

          let accounts = state.accounts;
          let debts = state.debts;
          const newTransactions: Transaction[] = [];
          let interCoupleBalance = state.interCoupleBalance;
          let interCoupleHistory = [...state.interCoupleHistory];

          const categoryPaidBefore =
            plannedAmount != null && monthlyExpenseId
              ? (() => {
                  const exp = state.monthlyExpenses.find((e) => e.id === monthlyExpenseId);
                  return exp ? getMonthlyExpensePaid(state.transactions, exp) : 0;
                })()
              : plannedAmount != null && expenseOwner
                ? getCategorySpentThisMonth(state.transactions, category, expenseOwner)
                : undefined;
          let runningPaid = categoryPaidBefore ?? 0;

          for (const payment of payments) {
            if (payment.amount <= 0) continue;

            const applied = applyPaymentFromAccount(
              accounts,
              debts,
              payment.person,
              payment.amount,
              payment.accountId,
              payment.cashSourceAccountId
            );
            if (!applied) continue;

            accounts = applied.accounts;
            debts = applied.debts;

            const paymentMethod = getPaymentMethodLabel(
              state.accounts,
              payment.accountId,
              payment.cashSourceAccountId
            );

            runningPaid += payment.amount;
            const categoryRemaining =
              plannedAmount != null
                ? Math.max(0, plannedAmount - runningPaid)
                : undefined;

            if (payment.cashSourceAccountId) {
              const source = state.accounts.find((a) => a.id === payment.cashSourceAccountId);
              newTransactions.push(
                createTransaction(
                  "cash_withdrawal",
                  payment.person,
                  payment.amount,
                  {
                    accountId: payment.accountId,
                    sourceAccountId: payment.cashSourceAccountId,
                    category,
                    autoMessage: buildCashWithdrawalMessage({
                      person: payment.person,
                      amount: payment.amount,
                      fromAccount: source?.name ?? "debit",
                      forCategory: category,
                    }),
                  },
                  at
                )
              );
            }

            const autoMessage = buildExpenseAutoMessage({
              paidBy: payment.person,
              amount: payment.amount,
              category,
              paymentMethod,
              expenseOwner: expenseShares ? undefined : expenseOwner,
              expenseShares,
              plannedAmount,
              categoryRemaining,
              isSplitShare: true,
            });

            newTransactions.push(
              createTransaction(
                "expense",
                payment.person,
                payment.amount,
                {
                  accountId: payment.accountId,
                  sourceAccountId: payment.cashSourceAccountId,
                  category,
                  paymentMethod,
                  autoMessage,
                  notes,
                  paidByPerson: payment.person,
                  expenseOwner,
                  expenseShares,
                  monthlyExpenseId,
                  plannedAmount,
                  categoryPaidBefore: categoryPaidBefore,
                  categoryRemaining,
                },
                at
              )
            );

            const shareTransaction = newTransactions[newTransactions.length - 1]!;
            writtenIds.push(shareTransaction.id);

            if (expenseOwner && !expenseShares && payment.person !== expenseOwner) {
              const interMsg = buildInterCoupleAutoMessage({
                paidBy: payment.person,
                benefited: expenseOwner,
                amount: payment.amount,
              });
              const interUpdate = updateInterCoupleFromSpend(
                payment.person,
                expenseOwner,
                payment.amount,
                interCoupleBalance,
                `${interMsg} (${category} split)`,
                shareTransaction.id,
                undefined,
                at
              );
              interCoupleBalance = interUpdate.balance;
              if (interUpdate.entry) {
                newInterEntries.push(interUpdate.entry);
                interCoupleHistory = [interUpdate.entry, ...interCoupleHistory];
              }
            }
          }

          const inter = withRecalculatedInterCouple(interCoupleHistory);

          return {
            accounts,
            debts,
            transactions: [...newTransactions, ...state.transactions],
            interCoupleBalance: inter.interCoupleBalance,
            interCoupleHistory: inter.interCoupleHistory,
          };
        });
        celebrateBetweenUsUpdate(
          newInterEntries,
          useFinanceStore.getState().interCoupleBalance
        );
        return writtenIds;
      },

      recordInterCouple: (paidBy, benefited, amount, notes) => {
        const newInterEntries: InterCoupleEntry[] = [];
        set((state) => {
          const autoMessage = buildInterCoupleAutoMessage({ paidBy, benefited, amount });
          const transaction = createTransaction("inter_couple", paidBy, amount, {
            beneficiaryPerson: benefited,
            paidByPerson: paidBy,
            autoMessage,
            notes,
          });
          const interUpdate = updateInterCoupleFromSpend(
            paidBy,
            benefited,
            amount,
            state.interCoupleBalance,
            autoMessage,
            transaction.id,
            notes
          );
          if (!interUpdate.entry) return state;

          const entry = { ...interUpdate.entry, sourceTransactionId: transaction.id };
          newInterEntries.push(entry);
          const inter = withRecalculatedInterCouple([entry, ...state.interCoupleHistory]);

          return {
            interCoupleBalance: inter.interCoupleBalance,
            interCoupleHistory: inter.interCoupleHistory,
            transactions: [transaction, ...state.transactions],
          };
        });
        celebrateBetweenUsUpdate(
          newInterEntries,
          useFinanceStore.getState().interCoupleBalance
        );
      },

      recordExternalBetweenUs: ({ paidBy, benefited, amount, notes }) => {
        const trimmedNotes = notes.trim();
        if (!trimmedNotes || paidBy === benefited || amount <= 0) return;

        const newInterEntries: InterCoupleEntry[] = [];
        set((state) => {
          const autoMessage = buildExternalBetweenUsMessage({ paidBy, benefited, amount });
          const transaction = createTransaction("inter_couple", paidBy, amount, {
            beneficiaryPerson: benefited,
            paidByPerson: paidBy,
            autoMessage,
            notes: trimmedNotes,
            category: "External",
            paymentMethod: "Outside accounts",
          });
          const interUpdate = updateInterCoupleFromSpend(
            paidBy,
            benefited,
            amount,
            state.interCoupleBalance,
            autoMessage,
            transaction.id,
            trimmedNotes
          );
          if (!interUpdate.entry) return state;

          const entry = { ...interUpdate.entry, sourceTransactionId: transaction.id };
          newInterEntries.push(entry);
          const inter = withRecalculatedInterCouple([entry, ...state.interCoupleHistory]);

          return {
            interCoupleBalance: inter.interCoupleBalance,
            interCoupleHistory: inter.interCoupleHistory,
            transactions: [transaction, ...state.transactions],
          };
        });
        celebrateBetweenUsUpdate(
          newInterEntries,
          useFinanceStore.getState().interCoupleBalance
        );
      },

      updateInterCoupleBalance: (amount) =>
        set((state) => {
          const historyWithoutManual = state.interCoupleHistory.filter(
            (entry) => entry.autoMessage !== "Manual balance adjustment"
          );
          const base = recalculateInterCoupleState(historyWithoutManual);
          const delta = amount - base.interCoupleBalance;

          if (Math.abs(delta) < 0.01) {
            return {
              interCoupleBalance: amount,
              interCoupleHistory: base.interCoupleHistory,
            };
          }

          const paidBy: Person = delta > 0 ? "kushvanth" : "grishma";
          const benefited: Person = delta > 0 ? "grishma" : "kushvanth";
          const interUpdate = updateInterCoupleFromSpend(
            paidBy,
            benefited,
            Math.abs(delta),
            base.interCoupleBalance,
            "Manual balance adjustment"
          );

          if (!interUpdate.entry) {
            return { interCoupleBalance: amount };
          }

          const final = recalculateInterCoupleState([
            interUpdate.entry,
            ...base.interCoupleHistory,
          ]);

          return {
            interCoupleBalance: final.interCoupleBalance,
            interCoupleHistory: final.interCoupleHistory,
          };
        }),

      deleteTransaction: (id, deletedBy) =>
        set((state) => {
          const result = applyTransactionDeletion({
            accounts: state.accounts,
            debts: state.debts,
            transactions: state.transactions,
            incomeEntries: state.incomeEntries,
            interCoupleHistory: state.interCoupleHistory,
            interCoupleBalance: state.interCoupleBalance,
            monthlyExpenses: state.monthlyExpenses,
            transactionId: id,
          });
          if (!result) return state;

          const { deletionAudit, ...nextState } = result;
          const deletedRecord = buildDeletedHistoryRecord({
            primaryTransactionId: deletionAudit.primaryTransactionId,
            removedTransactions: deletionAudit.removedTransactions,
            removedInterCoupleEntries: deletionAudit.removedInterCoupleEntries,
            removedIncomeEntry: deletionAudit.removedIncomeEntry,
            monthlyExpense: deletionAudit.monthlyExpense,
            accounts: state.accounts,
            debts: state.debts,
            incomeSources: state.incomeSources,
            deletedBy,
          });

          return {
            ...nextState,
            deletedHistory: [...(state.deletedHistory ?? []), deletedRecord],
          };
        }),

      resetToSeed: () => {
        const preservedDeletedHistory = useFinanceStore.getState().deletedHistory ?? [];
        clearPersistedAppData();
        set({ ...seedData, deletedHistory: preservedDeletedHistory });
      },
    }),
    {
      name: FINANCE_STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.deletedHistory) {
          state.deletedHistory = [];
        }

        const persisted = {
          incomeSources: state.incomeSources,
          incomeEntries: state.incomeEntries,
          spendCategories: state.spendCategories,
          monthlyExpenses: state.monthlyExpenses,
          accounts: state.accounts,
          debts: state.debts,
          transactions: state.transactions,
          interCoupleHistory: state.interCoupleHistory,
          interCoupleBalance: state.interCoupleBalance,
          deletedHistory: state.deletedHistory,
        };

        const best = pickRicherState(seedData, persisted);
        if (scoreFinanceState(best) > scoreFinanceState(persisted)) {
          Object.assign(state, best);
        }

        if (!state.spendCategories?.length) {
          state.spendCategories = seedData.spendCategories;
        }

        const normalized = applySharedAccountNormalization({
          accounts: state.accounts,
          incomeEntries: state.incomeEntries,
          transactions: state.transactions,
          incomeSources: state.incomeSources,
          spendCategories: state.spendCategories,
          monthlyExpenses: state.monthlyExpenses,
          debts: state.debts,
          interCoupleHistory: state.interCoupleHistory,
          interCoupleBalance: state.interCoupleBalance,
          deletedHistory: state.deletedHistory,
        });

        state.accounts = normalized.accounts;
        state.incomeEntries = normalized.incomeEntries;
        state.transactions = normalized.transactions;

        const baseline = ensureInterCoupleBaseline(
          state.interCoupleHistory,
          state.interCoupleBalance
        );
        const synced = recalculateInterCoupleState(baseline.interCoupleHistory);
        state.interCoupleHistory = synced.interCoupleHistory;
        state.interCoupleBalance = synced.interCoupleBalance;
      },
    }
  )
);

export function useHydratedStore<T>(selector: (state: FinanceStore) => T): T | null {
  const result = useFinanceStore(selector);
  // False on the server and during hydration, true after — without an effect
  // that sets state on mount.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  return hydrated ? result : null;
}

export function getFinanceState(): FinanceState {
  const state = useFinanceStore.getState();
  return {
    incomeSources: state.incomeSources,
    incomeEntries: state.incomeEntries,
    spendCategories: state.spendCategories,
    monthlyExpenses: state.monthlyExpenses,
    accounts: state.accounts,
    debts: state.debts,
    transactions: state.transactions,
    interCoupleHistory: state.interCoupleHistory,
    interCoupleBalance: state.interCoupleBalance,
    deletedHistory: state.deletedHistory ?? [],
    greenDotTrackingStartDate: state.greenDotTrackingStartDate,
    flexDeposits: state.flexDeposits ?? [],
  };
}

export function applyRemoteFinanceState(state: FinanceState) {
  const normalized = applySharedAccountNormalization(state);
  const baseline = ensureInterCoupleBaseline(
    normalized.interCoupleHistory,
    normalized.interCoupleBalance
  );
  const synced = recalculateInterCoupleState(baseline.interCoupleHistory);

  useFinanceStore.setState({
    ...normalized,
    spendCategories: normalized.spendCategories?.length
      ? normalized.spendCategories
      : seedData.spendCategories,
    deletedHistory: normalized.deletedHistory ?? [],
    interCoupleHistory: synced.interCoupleHistory,
    interCoupleBalance: synced.interCoupleBalance,
  });
}

/** Wait until localStorage data has loaded into the store. */
export function waitForStoreHydration(timeoutMs = 5000): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (useFinanceStore.persist.hasHydrated()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    if (useFinanceStore.persist.hasHydrated()) {
      finish();
      return;
    }

    useFinanceStore.persist.onFinishHydration(finish);
    window.setTimeout(finish, timeoutMs);
  });
}

export type { IncomeSource, IncomeEntry, MonthlyExpense, Account, Debt, Transaction };
