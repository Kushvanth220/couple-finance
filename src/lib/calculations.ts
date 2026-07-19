import { endOfMonth, format, isSameMonth, startOfMonth } from "date-fns";
import { parseAppDateTime } from "@/lib/formatters";
import type {
  Account,
  Debt,
  IncomeEntry,
  InterCoupleEntry,
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

export function parseMonthKey(monthKey: string): Date {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function getAvailableMonthKeys(
  transactions: Transaction[],
  incomeEntries: IncomeEntry[],
  trailingMonths = 18
): string[] {
  const keys = new Set<string>();
  const now = new Date();

  for (let i = 0; i < trailingMonths; i++) {
    keys.add(getMonthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }

  for (const transaction of transactions) {
    keys.add(
      format(
        parseAppDateTime(transaction.date, transaction.time, transaction.timestamp),
        "yyyy-MM"
      )
    );
  }

  for (const entry of incomeEntries) {
    keys.add(entry.date.slice(0, 7));
  }

  return Array.from(keys).sort((a, b) => b.localeCompare(a));
}

export function getPersonDebtPaymentsInMonth(
  transactions: Transaction[],
  person: Person,
  date: Date = new Date()
): Transaction[] {
  return getTransactionsForMonth(transactions, date).filter((transaction) => {
    if (transaction.type !== "debt_payment" && transaction.type !== "credit_payment") {
      return false;
    }
    const payer = transaction.paidByPerson ?? transaction.person;
    return payer === person;
  });
}

export function getPersonOtherExpensesInMonth(
  transactions: Transaction[],
  person: Person,
  date: Date = new Date()
): Transaction[] {
  return getTransactionsForMonth(transactions, date).filter((transaction) => {
    if (transaction.type !== "expense") return false;
    return getTransactionExpenseShare(transaction, person) > 0;
  });
}

export function getPersonInterCoupleTransactionsInMonth(
  transactions: Transaction[],
  person: Person,
  date: Date = new Date()
): Transaction[] {
  return getTransactionsForMonth(transactions, date).filter((transaction) => {
    if (transaction.type !== "inter_couple") return false;
    const payer = transaction.paidByPerson ?? transaction.person;
    const benefited = transaction.beneficiaryPerson;
    return payer === person || benefited === person;
  });
}

export function getPersonBetweenUsEntriesInMonth(
  history: InterCoupleEntry[],
  person: Person,
  date: Date = new Date()
): InterCoupleEntry[] {
  return history.filter((entry) => {
    if (entry.paidBy !== person && entry.benefited !== person) return false;
    const entryDate = parseAppDateTime(entry.date, entry.time, entry.timestamp);
    return isSameMonth(entryDate, date);
  });
}

export interface DebtAndBetweenUsSummary {
  debtPayments: Transaction[];
  interCoupleTransactions: Transaction[];
  betweenUsEntries: InterCoupleEntry[];
  total: number;
}

export function getPersonDebtAndBetweenUsSummary(
  transactions: Transaction[],
  history: InterCoupleEntry[],
  person: Person,
  date: Date = new Date()
): DebtAndBetweenUsSummary {
  const debtPayments = getPersonDebtPaymentsInMonth(transactions, person, date);
  const interCoupleTransactions = getPersonInterCoupleTransactionsInMonth(
    transactions,
    person,
    date
  );
  const betweenUsEntries = getPersonBetweenUsEntriesInMonth(history, person, date);

  const linkedTransactionIds = new Set([
    ...debtPayments.map((transaction) => transaction.id),
    ...interCoupleTransactions.map((transaction) => transaction.id),
  ]);

  let total = debtPayments.reduce((sum, transaction) => sum + transaction.amount, 0);
  total += interCoupleTransactions
    .filter((transaction) => (transaction.paidByPerson ?? transaction.person) === person)
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  for (const entry of betweenUsEntries) {
    if (entry.paidBy !== person) continue;
    if (entry.autoMessage === "Starting balance") continue;
    if (entry.sourceTransactionId && linkedTransactionIds.has(entry.sourceTransactionId)) {
      continue;
    }
    total += entry.amount;
  }

  return { debtPayments, interCoupleTransactions, betweenUsEntries, total };
}

export function getMonthlyDebtAndBetweenUsTotal(
  transactions: Transaction[],
  history: InterCoupleEntry[],
  person: Person,
  date: Date = new Date()
): number {
  return getPersonDebtAndBetweenUsSummary(transactions, history, person, date).total;
}

export function getMonthlyDebtPaymentsTotal(
  transactions: Transaction[],
  person: Person,
  date: Date = new Date()
): number {
  return getPersonDebtPaymentsInMonth(transactions, person, date).reduce(
    (sum, transaction) => sum + transaction.amount,
    0
  );
}

export function getMonthlyOtherExpensesTotal(
  transactions: Transaction[],
  person: Person,
  date: Date = new Date()
): number {
  return getPersonOtherExpensesInMonth(transactions, person, date).reduce(
    (sum, transaction) => sum + getTransactionExpenseShare(transaction, person),
    0
  );
}

export function getMonthlySpendTotal(
  transactions: Transaction[],
  person: Person,
  date: Date = new Date(),
  interCoupleHistory: InterCoupleEntry[] = []
): number {
  return (
    getMonthlyDebtAndBetweenUsTotal(transactions, interCoupleHistory, person, date) +
    getMonthlyOtherExpensesTotal(transactions, person, date)
  );
}

export function getTrendMonths(
  monthKey: string,
  count = 6
): { key: string; label: string; date: Date }[] {
  const end = parseMonthKey(monthKey);
  const months: { key: string; label: string; date: Date }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(end.getFullYear(), end.getMonth() - i, 1);
    months.push({
      key: getMonthKey(date),
      label: format(date, "MMM"),
      date,
    });
  }
  return months;
}
