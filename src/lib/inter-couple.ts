import { formatCurrency } from "./formatters";
import { PERSON_LABELS, type Person } from "@/types";

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
