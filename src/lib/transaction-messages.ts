import { displayText } from "@/lib/branding";
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

export function buildDebtNotePaymentMessage(opts: {
  debtOwner: Person;
  amountPaid: number;
  debtName: string;
  debtRemaining: number;
  cleared?: boolean;
  notes?: string;
}): string {
  const { debtOwner, amountPaid, debtName, debtRemaining, cleared, notes } = opts;

  let msg = cleared
    ? `${PERSON_LABELS[debtOwner]} cleared ${debtName} (${formatCurrency(amountPaid)} paid off)`
    : `${PERSON_LABELS[debtOwner]} paid ${formatCurrency(amountPaid)} toward ${debtName} · ${formatCurrency(debtRemaining)} left`;

  if (notes?.trim()) {
    msg += ` — ${notes.trim()}`;
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

/** Cash or transfers outside linked bank accounts (Between Us custom add). */
export function buildExternalBetweenUsMessage(opts: {
  paidBy: Person;
  benefited: Person;
  amount: number;
}): string {
  return `${PERSON_LABELS[opts.paidBy]} gave ${formatCurrency(opts.amount)} to ${PERSON_LABELS[opts.benefited]} (outside accounts)`;
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

function appendNotesIfMissingRaw(message: string, notes?: string): string {
  // Notes are his own words and can name her; swap on display like the rest.
  const note = notes?.trim();
  if (!note) return message;
  if (message.toLowerCase().includes(note.toLowerCase())) return message;
  return `${message} — ${note}`;
}

function appendNotesIfMissing(message: string, notes?: string): string {
  return displayText(appendNotesIfMissingRaw(message, notes));
}

export function getTransactionDisplayMessage(transaction: Transaction): string {
  const actor = getTransactionActor(transaction);
  const actorLabel = PERSON_LABELS[actor];

  if (transaction.autoMessage) {
    // Stored records carry the name as it was when they were written; the swap
    // happens here so every screen that shows a transaction agrees, without
    // rewriting a single row.
    const stored = displayText(transaction.autoMessage);
    let message = stored.includes(actorLabel) ? stored : `${actorLabel} — ${stored}`;

    if (
      transaction.type === "inter_couple" &&
      transaction.category === "External" &&
      transaction.notes &&
      !message.includes(transaction.notes)
    ) {
      message = `${message} — ${transaction.notes}`;
    }

    return appendNotesIfMissing(message, transaction.notes);
  }

  const payment = transaction.paymentMethod ? ` via ${transaction.paymentMethod}` : "";
  const category = transaction.category;

  let message: string;

  switch (transaction.type) {
    case "income":
      message = `${actorLabel} received ${formatCurrency(transaction.amount)}${category ? ` from ${category}` : ""}${payment}`;
      break;
    case "expense":
      message = `${actorLabel} paid ${formatCurrency(transaction.amount)}${category ? ` for ${category}` : ""}${payment}`;
      break;
    case "credit_payment":
    case "debt_payment":
      message = `${actorLabel} paid ${formatCurrency(transaction.amount)}${category ? ` toward ${category}` : ""}${payment}`;
      break;
    case "cash_withdrawal":
      message = `${actorLabel} withdrew ${formatCurrency(transaction.amount)} cash${category ? ` for ${category}` : ""}${payment}`;
      break;
    case "cash_deposit":
      message = `${actorLabel} deposited ${formatCurrency(transaction.amount)} cash${payment}`;
      break;
    case "inter_couple":
      if (transaction.notes && transaction.category === "External") {
        message = `${actorLabel} gave ${formatCurrency(transaction.amount)} to ${
          transaction.beneficiaryPerson
            ? PERSON_LABELS[transaction.beneficiaryPerson]
            : "partner"
        } — ${transaction.notes}`;
      } else {
        message = transaction.beneficiaryPerson
          ? `${actorLabel} paid ${formatCurrency(transaction.amount)} for ${PERSON_LABELS[transaction.beneficiaryPerson]}`
          : `${actorLabel} — between us transfer ${formatCurrency(transaction.amount)}`;
      }
      break;
    case "balance_adjustment":
      message = `${actorLabel} updated account balance${transaction.notes ? `: ${transaction.notes}` : ""}`;
      break;
    default:
      message = `${actorLabel} — ${category ?? transaction.type}${payment}`;
  }

  return appendNotesIfMissing(message, transaction.notes);
}
