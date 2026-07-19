export type Person = "kushvanth" | "grishma";

export type AccountType = "credit" | "debit" | "cash";

export type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "cash_withdrawal"
  | "cash_deposit"
  | "debt_payment"
  | "credit_payment"
  | "inter_couple"
  | "balance_adjustment";

export interface IncomeSource {
  id: string;
  person: Person;
  name: string;
}

export type IncomeDepositType = "cash" | "debit";

export interface IncomeEntry {
  id: string;
  person: Person;
  sourceId: string;
  amount: number;
  date: string;
  time?: string;
  timestamp?: string;
  notes?: string;
  depositType: IncomeDepositType;
  depositAccountId: string;
}

export interface MonthlyExpense {
  id: string;
  person: Person;
  name: string;
  amount: number | null;
  isVariable: boolean;
  isRecurring: boolean;
  oneTimeMonth?: number;
  oneTimeYear?: number;
  isPaid?: boolean;
  /** Day of month when payment is due (recurring) */
  dueDayOfMonth?: number;
  /** Full due date for one-time expenses (yyyy-MM-dd) */
  dueDate?: string;
}

export interface Account {
  id: string;
  person: Person;
  name: string;
  type: AccountType;
  balance: number;
  creditLimit?: number;
}

export interface Debt {
  id: string;
  person: Person;
  name: string;
  amount: number;
  linkedAccountId?: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  person: Person;
  amount: number;
  date: string;
  time: string;
  timestamp?: string;
  category?: string;
  accountId?: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  beneficiaryPerson?: Person;
  paidByPerson?: Person;
  notes?: string;
  autoMessage?: string;
  paymentMethod?: string;
  monthlyExpenseId?: string;
  expenseOwner?: Person;
  /** Per-person share when expense is split (e.g. both ate, $10 each). */
  expenseShares?: Partial<Record<Person, number>>;
  plannedAmount?: number;
  categoryPaidBefore?: number;
  categoryRemaining?: number;
  debtRemaining?: number;
  /** Account balance before a manual adjustment (for reversal on delete). */
  previousBalance?: number;
}

export interface InterCoupleEntry {
  id: string;
  date: string;
  time: string;
  timestamp?: string;
  amount: number;
  paidBy: Person;
  benefited: Person;
  notes?: string;
  autoMessage?: string;
  runningBalance: number;
  sourceTransactionId?: string;
}

/** Permanent audit log entry when a transaction is deleted from History. */
export interface DeletedHistoryRecord {
  id: string;
  deletedAt: string;
  /** Who removed this from active History (Kushvanth or Grishma). */
  deletedBy?: Person;
  primaryTransactionId: string;
  transactions: Transaction[];
  removedInterCoupleEntries: InterCoupleEntry[];
  removedIncomeEntry?: IncomeEntry;
  monthlyExpense?: {
    id: string;
    name: string;
    person: Person;
    amount: number | null;
    isVariable: boolean;
    isRecurring: boolean;
  };
  context: {
    accounts: Record<string, { name: string; type: AccountType; person: Person }>;
    debts: Record<string, { name: string; person: Person }>;
    incomeSources: Record<string, { name: string; person: Person }>;
  };
  summary: string;
}

export interface FinanceState {
  incomeSources: IncomeSource[];
  incomeEntries: IncomeEntry[];
  monthlyExpenses: MonthlyExpense[];
  accounts: Account[];
  debts: Debt[];
  transactions: Transaction[];
  interCoupleHistory: InterCoupleEntry[];
  /** Positive = Grishma owes Kushvanth */
  interCoupleBalance: number;
  /** Append-only log of deleted transactions — never removed by delete or reset. */
  deletedHistory: DeletedHistoryRecord[];
}

export const PERSON_LABELS: Record<Person, string> = {
  kushvanth: "Kushvanth",
  grishma: "Grishma",
};
