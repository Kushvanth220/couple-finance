import { endOfMonth, format, isSameMonth, startOfMonth } from "date-fns";
import { parseAppDateTime } from "@/lib/formatters";
import type {
  Account,
  Debt,
  IncomeEntry,
  MonthlyExpense,
  Person,
  Transaction,
} from "@/types";

export function getMonthExpenses(
  expenses: MonthlyExpense[],
  person: Person,
  date: Date = new Date()
): MonthlyExpense[] {
  return expenses.filter((expense) => {
    if (expense.person !== person) return false;
    if (expense.isRecurring) return true;
    if (expense.isPaid) return false;
    if (!expense.oneTimeMonth || !expense.oneTimeYear) return false;
    return (
      expense.oneTimeMonth === date.getMonth() + 1 &&
      expense.oneTimeYear === date.getFullYear()
    );
  });
}

export function sumMonthlyExpenses(expenses: MonthlyExpense[]): number {
  return expenses.reduce((sum, expense) => sum + (expense.amount ?? 0), 0);
}

export function getIncomeForPeriod(
  entries: IncomeEntry[],
  person: Person | null,
  start: Date,
  end: Date
): IncomeEntry[] {
  return entries.filter((entry) => {
    if (person && entry.person !== person) return false;
    const entryDate = parseAppDateTime(entry.date, entry.time, entry.timestamp);
    return entryDate >= start && entryDate <= end;
  });
}

export function sumIncome(entries: IncomeEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

export function getMonthlyIncome(
  entries: IncomeEntry[],
  person: Person | null,
  date: Date = new Date()
): number {
  const filtered = getIncomeForPeriod(
    entries,
    person,
    startOfMonth(date),
    endOfMonth(date)
  );
  return sumIncome(filtered);
}

export function getYearlyIncome(
  entries: IncomeEntry[],
  person: Person | null,
  date: Date = new Date()
): number {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const yearEnd = new Date(date.getFullYear(), 11, 31, 23, 59, 59);
  const filtered = getIncomeForPeriod(entries, person, yearStart, yearEnd);
  return sumIncome(filtered);
}

export function getCreditUtilization(account: Account): number {
  if (account.type !== "credit" || !account.creditLimit) return 0;
  return (account.balance / account.creditLimit) * 100;
}

export function getAvailableCredit(account: Account): number {
  if (account.type !== "credit" || !account.creditLimit) return 0;
  return Math.max(0, account.creditLimit - account.balance);
}

export function getTotalDebt(debts: Debt[], person: Person | null): number {
  return debts
    .filter((debt) => !person || debt.person === person)
    .reduce((sum, debt) => sum + debt.amount, 0);
}

export function getAccountBalances(
  accounts: Account[],
  person: Person | null,
  type?: Account["type"]
): number {
  return accounts
    .filter((account) => {
      if (person && account.person !== person) return false;
      if (type && account.type !== type) return false;
      return true;
    })
    .reduce((sum, account) => {
      if (account.type === "credit") return sum;
      return sum + account.balance;
    }, 0);
}

export function getNetWorth(
  accounts: Account[],
  debts: Debt[],
  person: Person | null
): number {
  const assets = getAccountBalances(accounts, person);
  const liabilities = getTotalDebt(debts, person);
  return assets - liabilities;
}

export function getTransactionsForMonth(
  transactions: Transaction[],
  date: Date = new Date()
): Transaction[] {
  return transactions.filter((transaction) =>
    isSameMonth(parseAppDateTime(transaction.date, transaction.time, transaction.timestamp), date)
  );
}

export function groupIncomeBySource(
  entries: IncomeEntry[],
  sourceNames: Record<string, string>
): { name: string; amount: number }[] {
  const grouped = new Map<string, number>();
  for (const entry of entries) {
    const name = sourceNames[entry.sourceId] ?? "Unknown";
    grouped.set(name, (grouped.get(name) ?? 0) + entry.amount);
  }
  return Array.from(grouped.entries()).map(([name, amount]) => ({ name, amount }));
}

export function getTransactionExpenseShare(
  transaction: Transaction,
  person: Person
): number {
  if (transaction.type !== "expense") return 0;
  const share = transaction.expenseShares?.[person];
  if (share != null) return share;
  const owner = transaction.expenseOwner ?? transaction.beneficiaryPerson ?? transaction.person;
  return owner === person ? transaction.amount : 0;
}

export function transactionInvolvesPerson(
  transaction: Transaction,
  person: Person
): boolean {
  if (transaction.person === person || transaction.paidByPerson === person) return true;
  if (transaction.expenseOwner === person || transaction.beneficiaryPerson === person) {
    return true;
  }
  return (transaction.expenseShares?.[person] ?? 0) > 0;
}

export function getMonthlyExpensesTotal(
  transactions: Transaction[],
  person: Person | null,
  date: Date = new Date()
): number {
  const monthTx = getTransactionsForMonth(transactions, date).filter(
    (transaction) => transaction.type === "expense"
  );
  if (!person) {
    return monthTx.reduce((sum, transaction) => sum + transaction.amount, 0);
  }
  return monthTx.reduce(
    (sum, transaction) => sum + getTransactionExpenseShare(transaction, person),
    0
  );
}

export function groupExpensesByCategory(
  transactions: Transaction[],
  person: Person | null = null
): { name: string; amount: number }[] {
  const grouped = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    const category = transaction.category ?? "Other";
    const amount = person
      ? getTransactionExpenseShare(transaction, person)
      : transaction.amount;
    if (amount <= 0) continue;
    grouped.set(category, (grouped.get(category) ?? 0) + amount);
  }
  return Array.from(grouped.entries()).map(([name, amount]) => ({ name, amount }));
}

export function getMonthKey(date: Date = new Date()): string {
  return format(date, "yyyy-MM");
}
