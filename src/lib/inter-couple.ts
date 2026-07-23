import { formatCurrency } from "./formatters";
import { recalculateInterCoupleState } from "./transaction-reversal";
import { PERSON_LABELS, type InterCoupleEntry, type Person, type Transaction } from "@/types";

/** Plain-language summary for the Between Us balance card. */
export function getInterCoupleSummary(balance: number) {
  if (balance > 0) {
    return {
      amount: balance,
      label: `${PERSON_LABELS.grishma} should pay ${PERSON_LABELS.kushvanth} back`,
    };
  }
  if (balance < 0) {
    return {
      amount: Math.abs(balance),
      label: `${PERSON_LABELS.kushvanth} should pay ${PERSON_LABELS.grishma} back`,
    };
  }
  return { amount: 0, label: "You're all even!" };
}

/** Shown on Spend before confirming a shared or cross-person payment. */
export function describeInterCoupleFromSpend(
  paidBy: Person,
  benefited: Person,
  amount: number
) {
  return `${PERSON_LABELS[paidBy]} paid ${formatCurrency(amount)} for ${PERSON_LABELS[benefited]} — ${PERSON_LABELS[benefited]} should pay back ${formatCurrency(amount)}`;
}

export const CREDIT_LABELS = {
  cardBalance: "Card balance",
  currentBalance: "Current card balance",
  initialBalance: "Starting card balance",
  leftToSpend: "Left to spend",
  limit: "Credit limit",
  percentUsed: "used",
} as const;

/** Recompute running balances from full history (newest first). */
export function getDisplayInterCoupleHistory(history: InterCoupleEntry[]) {
  return recalculateInterCoupleState(history).interCoupleHistory;
}

/** Find the main History transaction linked to a Between Us entry. */
export function isExternalBetweenUsTransaction(transaction: Transaction): boolean {
  return transaction.type === "inter_couple" && transaction.category === "External";
}

export function resolveLinkedTransactionId(
  entry: InterCoupleEntry,
  transactions: Transaction[]
): string | undefined {
  if (entry.autoMessage === "Starting balance") return undefined;

  if (entry.sourceTransactionId) {
    const linked = transactions.find((t) => t.id === entry.sourceTransactionId);
    if (linked) return linked.id;
  }

  const match = transactions.find((transaction) => {
    if (transaction.date !== entry.date || transaction.time !== entry.time) return false;
    if (Math.abs(transaction.amount - entry.amount) >= 0.02) return false;

    const paidBy = transaction.paidByPerson ?? transaction.person;
    if (paidBy !== entry.paidBy) return false;

    if (transaction.type === "inter_couple") {
      return transaction.beneficiaryPerson === entry.benefited;
    }

    if (transaction.expenseShares) {
      const share = transaction.expenseShares[entry.benefited] ?? 0;
      return share > 0 && Math.abs(share - entry.amount) < 0.02;
    }

    return (
      transaction.beneficiaryPerson === entry.benefited ||
      transaction.expenseOwner === entry.benefited
    );
  });

  return match?.id;
}
