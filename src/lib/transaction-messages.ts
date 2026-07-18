import { isSameMonth } from "date-fns";
import { parseAppDateTime } from "@/lib/formatters";
import type { Account, Person, Transaction } from "@/types";
import { PERSON_LABELS } from "@/types";
import { formatCurrency } from "./formatters";

export function getPaymentMethodLabel(
  accounts: Account[],
  accountId: string,
  sourceAccountId?: string
): string {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return "Unknown account";

  if (account.type === "cash" && sourceAccountId) {
    const source = accounts.find((a) => a.id === sourceAccountId);
    return `Cash (from ${source?.name ?? "debit"} withdrawal)`;
  }

  const typeLabels = {
    credit: "Credit Card",
    debit: "Debit Account",
    cash: "Cash Wallet",
  } as const;

  return `${account.name} · ${typeLabels[account.type]}`;
}

export function getCategorySpentThisMonth(
  transactions: Transaction[],
  category: string,
  owner: Person,
  date: Date = new Date()
): number {
  return transactions
    .filter((t) => {
      if (t.type !== "expense") return false;
      if (t.category !== category) return false;
      const txnDate = parseAppDateTime(t.date, t.time, t.timestamp);
      if (!isSameMonth(txnDate, date)) return false;
      const expenseOwner = t.expenseOwner ?? t.beneficiaryPerson ?? t.person;
      return expenseOwner === owner;
    })
    .reduce((sum, t) => sum + t.amount, 0);
}

export function buildExpenseAutoMessage(opts: {
  paidBy: Person;
  amount: number;
  category: string;
  paymentMethod: string;
  expenseOwner?: Person;
  expenseShares?: Partial<Record<Person, number>>;
  plannedAmount?: number;
  categoryRemaining?: number;
  isSplitShare?: boolean;
}): string {
  const {
    paidBy,
    amount,
    category,
    paymentMethod,
    expenseOwner,
    expenseShares,
    plannedAmount,
    categoryRemaining,
    isSplitShare,
  } = opts;

  let msg = `${PERSON_LABELS[paidBy]} paid ${formatCurrency(amount)} for ${category} via ${paymentMethod}`;

  if (expenseShares) {
    const shareParts = (["kushvanth", "grishma"] as Person[])
      .filter((person) => (expenseShares[person] ?? 0) > 0)
      .map((person) => `${PERSON_LABELS[person]} ${formatCurrency(expenseShares[person]!)}`);
    if (shareParts.length > 0) {
      msg += ` (shared: ${shareParts.join(", ")})`;
    }
  } else if (expenseOwner && expenseOwner !== paidBy) {
    msg += ` (${PERSON_LABELS[expenseOwner]}'s expense)`;
  }

  if (isSplitShare) {
    msg += " · split share";
  }

  if (plannedAmount != null && categoryRemaining != null) {
    msg += ` · Budget ${formatCurrency(plannedAmount)}, ${formatCurrency(categoryRemaining)} remaining this month`;
  }

  return msg;
}

export function buildDebtAutoMessage(opts: {
  paidBy: Person;
  amount: number;
  debtName: string;
  paymentMethod: string;
  debtOwner: Person;
  debtRemaining?: number;
}): string {
  const { paidBy, amount, debtName, paymentMethod, debtOwner, debtRemaining } = opts;

  let msg = `${PERSON_LABELS[paidBy]} paid ${formatCurrency(amount)} toward ${debtName} via ${paymentMethod}`;

  if (paidBy !== debtOwner) {
    msg += ` (${PERSON_LABELS[debtOwner]}'s debt)`;
  }

  if (debtRemaining != null) {
    msg += ` · ${formatCurrency(debtRemaining)} still to pay`;
  }

  return msg;
}

export function buildIncomeAutoMessage(opts: {
  person: Person;
  amount: number;
  source: string;
  paymentMethod: string;
}): string {
  return `${PERSON_LABELS[opts.person]} received ${formatCurrency(opts.amount)} from ${opts.source} → deposited to ${opts.paymentMethod}`;
}

export function buildInterCoupleAutoMessage(opts: {
  paidBy: Person;
  benefited: Person;
  amount: number;
}): string {
  return `${PERSON_LABELS[opts.paidBy]} paid ${formatCurrency(opts.amount)} for ${PERSON_LABELS[opts.benefited]}'s share`;
}

export function buildCashWithdrawalMessage(opts: {
  person: Person;
  amount: number;
  fromAccount: string;
  forCategory?: string;
}): string {
  const forLabel = opts.forCategory ? ` for ${opts.forCategory}` : "";
  return `${PERSON_LABELS[opts.person]} withdrew ${formatCurrency(opts.amount)} cash from ${opts.fromAccount}${forLabel}`;
}

export function buildBalanceAdjustmentMessage(opts: {
  person: Person;
  accountName: string;
  notes?: string;
}): string {
  return `${PERSON_LABELS[opts.person]} updated ${opts.accountName} balance${opts.notes ? `: ${opts.notes}` : ""}`;
}

export function getTransactionActor(transaction: Transaction): Person {
  return transaction.paidByPerson ?? transaction.person;
}

export function getTransactionDisplayMessage(transaction: Transaction): string {
  const actor = getTransactionActor(transaction);
  const actorLabel = PERSON_LABELS[actor];

  if (transaction.autoMessage) {
    if (transaction.autoMessage.includes(actorLabel)) {
      return transaction.autoMessage;
    }
    return `${actorLabel} — ${transaction.autoMessage}`;
  }

  const payment = transaction.paymentMethod ? ` via ${transaction.paymentMethod}` : "";
  const category = transaction.category;

  switch (transaction.type) {
    case "income":
      return `${actorLabel} received ${formatCurrency(transaction.amount)}${category ? ` from ${category}` : ""}${payment}`;
    case "expense":
      return `${actorLabel} paid ${formatCurrency(transaction.amount)}${category ? ` for ${category}` : ""}${payment}`;
    case "credit_payment":
    case "debt_payment":
      return `${actorLabel} paid ${formatCurrency(transaction.amount)}${category ? ` toward ${category}` : ""}${payment}`;
    case "cash_withdrawal":
      return `${actorLabel} withdrew ${formatCurrency(transaction.amount)} cash${category ? ` for ${category}` : ""}${payment}`;
    case "cash_deposit":
      return `${actorLabel} deposited ${formatCurrency(transaction.amount)} cash${payment}`;
    case "inter_couple":
      return transaction.beneficiaryPerson
        ? `${actorLabel} paid ${formatCurrency(transaction.amount)} for ${PERSON_LABELS[transaction.beneficiaryPerson]}`
        : `${actorLabel} — between us transfer ${formatCurrency(transaction.amount)}`;
    case "balance_adjustment":
      return `${actorLabel} updated account balance${transaction.notes ? `: ${transaction.notes}` : ""}`;
    default:
      return `${actorLabel} — ${category ?? transaction.type}${payment}`;
  }
}
