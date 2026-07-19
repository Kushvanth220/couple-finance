"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { format } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import {
  buildBalanceAdjustmentMessage,
  buildCashWithdrawalMessage,
  buildDebtAutoMessage,
  buildExpenseAutoMessage,
  buildIncomeAutoMessage,
  buildInterCoupleAutoMessage,
  getCategorySpentThisMonth,
  getPaymentMethodLabel,
} from "@/lib/transaction-messages";
import { getMonthlyExpensePaid } from "@/lib/monthly-expense-tracker";
import {
  applyTransactionDeletion,
  ensureInterCoupleBaseline,
  getInterCoupleUpdatesFromShares,
  recalculateInterCoupleState,
  type ExpenseShares,
} from "@/lib/transaction-reversal";
import { buildDeletedHistoryRecord } from "@/lib/deleted-history";
import { celebrateBetweenUsUpdate } from "@/lib/between-us-celebration";
import { clearPersistedAppData, FINANCE_STORAGE_KEY } from "@/lib/reset-app-data";
import { parseAppDateTime } from "@/lib/formatters";
import { seedData } from "@/lib/seed-data";
import { PERSON_LABELS } from "@/types";
import type {
  Account,
  Debt,
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
}

interface SpendSplitOptions {
  category: string;
  expenseOwner?: Person;
  expenseShares?: ExpenseShares;
  notes?: string;
  payments: SplitPayment[];
  monthlyExpenseId?: string;
  plannedAmount?: number;
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
  addIncome: (entry: Omit<IncomeEntry, "id">) => void;
  updateIncome: (id: string, updates: Partial<IncomeEntry>) => void;
  deleteIncome: (id: string) => void;

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

  spend: (options: SpendOptions) => void;
  spendSplit: (options: SpendSplitOptions) => void;
  recordInterCouple: (
    paidBy: Person,
    benefited: Person,
    amount: number,
    notes?: string
  ) => void;
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
  notes?: string,
  sourceTransactionId?: string
): { balance: number; entry?: InterCoupleEntry } {
  if (!beneficiary || paidBy === beneficiary) {
    return { balance: currentBalance };
  }

  const { date, time, timestamp } = nowParts();
  let newBalance = currentBalance;

  if (paidBy === "kushvanth" && beneficiary === "grishma") {
    newBalance += amount;
  } else if (paidBy === "grishma" && beneficiary === "kushvanth") {
    newBalance -= amount;
  }

  const autoMessage =
    notes ??
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
      notes,
      autoMessage,
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
              { ...entry, id: uuidv4(), time: recordAt.time, timestamp: recordAt.timestamp },
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

      deleteIncome: (id) =>
        set((state) => ({
          incomeEntries: state.incomeEntries.filter((entry) => entry.id !== id),
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

      spend: (options) => {
        const newInterEntries: InterCoupleEntry[] = [];
        set((state) => {
          const {
            person,
            amount,
            accountId,
            cashSourceAccountId,
            category,
            notes,
            beneficiaryPerson,
            skipInterCouple,
            monthlyExpenseId,
            expenseOwner,
            plannedAmount,
            expenseShares,
          } = options;

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
          });

          const newTransactions: Transaction[] = [];

          if (cashSourceAccountId) {
            const source = state.accounts.find((a) => a.id === cashSourceAccountId);
            newTransactions.push(
              createTransaction("cash_withdrawal", person, amount, {
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
              })
            );
          }

          newTransactions.push(
            createTransaction("expense", person, amount, {
              accountId,
              sourceAccountId: cashSourceAccountId,
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
            })
          );

          const expenseTransaction = newTransactions[newTransactions.length - 1];

          let interCoupleBalance = state.interCoupleBalance;
          let interCoupleHistory = state.interCoupleHistory;

          if (expenseShares) {
            for (const { benefited, amount: shareAmount } of getInterCoupleUpdatesFromShares(
              person,
              expenseShares
            )) {
              const interMsg = buildInterCoupleAutoMessage({
                paidBy: person,
                benefited,
                amount: shareAmount,
              });
              const interUpdate = updateInterCoupleFromSpend(
                person,
                benefited,
                shareAmount,
                interCoupleBalance,
                `${interMsg} (${category ?? "expense"} shared)`,
                expenseTransaction.id
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
              const interMsg = buildInterCoupleAutoMessage({
                paidBy: person,
                benefited: benefitPerson,
                amount,
              });
              const interUpdate = updateInterCoupleFromSpend(
                person,
                benefitPerson,
                amount,
                interCoupleBalance,
                interMsg,
                expenseTransaction.id
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
      },

      spendSplit: (options) => {
        const newInterEntries: InterCoupleEntry[] = [];
        set((state) => {
          const {
            category,
            expenseOwner,
            expenseShares,
            notes,
            payments,
            monthlyExpenseId,
            plannedAmount,
          } = options;
          if (payments.length === 0) return state;

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
                createTransaction("cash_withdrawal", payment.person, payment.amount, {
                  accountId: payment.accountId,
                  sourceAccountId: payment.cashSourceAccountId,
                  category,
                  autoMessage: buildCashWithdrawalMessage({
                    person: payment.person,
                    amount: payment.amount,
                    fromAccount: source?.name ?? "debit",
                    forCategory: category,
                  }),
                })
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
              createTransaction("expense", payment.person, payment.amount, {
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
              })
            );

            const shareTransaction = newTransactions[newTransactions.length - 1];

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
                shareTransaction.id
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
      },

      recordInterCouple: (paidBy, benefited, amount, notes) => {
        const newInterEntries: InterCoupleEntry[] = [];
        set((state) => {
          const autoMessage =
            notes ?? buildInterCoupleAutoMessage({ paidBy, benefited, amount });
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
            transaction.id
          );
          if (!interUpdate.entry) return state;

          const entry = { ...interUpdate.entry, notes, autoMessage, sourceTransactionId: transaction.id };
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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated ? result : null;
}

export function getFinanceState(): FinanceState {
  const state = useFinanceStore.getState();
  return {
    incomeSources: state.incomeSources,
    incomeEntries: state.incomeEntries,
    monthlyExpenses: state.monthlyExpenses,
    accounts: state.accounts,
    debts: state.debts,
    transactions: state.transactions,
    interCoupleHistory: state.interCoupleHistory,
    interCoupleBalance: state.interCoupleBalance,
    deletedHistory: state.deletedHistory ?? [],
  };
}

export function applyRemoteFinanceState(state: FinanceState) {
  useFinanceStore.setState({
    ...state,
    deletedHistory: state.deletedHistory ?? [],
  });
}

let hydrationPromise: Promise<void> | null = null;

/** Wait until localStorage data has loaded into the store. */
export function waitForStoreHydration(timeoutMs = 5000): Promise<void> {
  if (useFinanceStore.persist.hasHydrated()) {
    return Promise.resolve();
  }

  if (!hydrationPromise) {
    hydrationPromise = new Promise((resolve) => {
      const finish = () => resolve();

      if (useFinanceStore.persist.hasHydrated()) {
        finish();
        return;
      }

      useFinanceStore.persist.onFinishHydration(finish);

      setTimeout(() => {
        console.warn("[finance-store] Hydration timed out — continuing with defaults.");
        finish();
      }, timeoutMs);
    });
  }

  return hydrationPromise;
}

export type { IncomeSource, IncomeEntry, MonthlyExpense, Account, Debt, Transaction };
