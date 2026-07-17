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
  plannedAmount?: number;
  categoryPaidBefore?: number;
  categoryRemaining?: number;
  debtRemaining?: number;
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
}

export const PERSON_LABELS: Record<Person, string> = {
  kushvanth: "Kushvanth",
  grishma: "Grishma",
};
