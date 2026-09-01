import type { AssistantToolCall } from "@/lib/ai/tools";
import { parseAiUserId } from "@/lib/ai/person";
import { PERSON_LABELS } from "@/types";

export const ASSISTANT_WRITE_TOOLS = new Set([
  "record_income",
  "record_expense",
  "add_debt",
  "record_debt_payment",
  "pay_debt_from_account",
  "adjust_account_balance",
  "add_account",
]);

export function isWriteTool(name: string): boolean {
  return ASSISTANT_WRITE_TOOLS.has(name);
}

export function isToolConfirmed(args: Record<string, unknown>): boolean {
  return args.user_confirmed === true || args.user_confirmed === "true";
}

export function stripConfirmationArg(args: Record<string, unknown>): Record<string, unknown> {
  const { user_confirmed, ...rest } = args;
  return rest;
}

/**
 * Consent belongs to the person, never to the model. A tool call produced by an
 * LLM (or inferred from speech) can arrive already claiming `user_confirmed`,
 * which would save real money with nothing shown on screen. Strip that claim so
 * the write is forced back through the app's own confirmation UI, where the
 * amount is displayed and a human agrees to that exact item.
 */
export function asProposedWrite(call: AssistantToolCall): AssistantToolCall {
  if (!isWriteTool(call.name) || !isToolConfirmed(call.args)) return call;
  return { ...call, args: stripConfirmationArg(call.args) };
}

function personLabel(value: unknown, fallback = "someone") {
  const parsed = parseAiUserId(value);
  return parsed ? PERSON_LABELS[parsed] : fallback;
}

export const EXPENSE_PERSON_CHIPS = [
  { id: "kushvanth" as const, label: PERSON_LABELS.kushvanth },
  { id: "grishma" as const, label: PERSON_LABELS.grishma },
  { id: "both" as const, label: "Both" },
];

export function withExpensePerson(
  args: Record<string, unknown>,
  person: (typeof EXPENSE_PERSON_CHIPS)[number]["id"]
): Record<string, unknown> {
  if (person === "both") {
    return { ...args, expense_for: "both" };
  }
  return {
    ...args,
    expense_for: person,
    paid_by: args.paid_by ?? person,
  };
}

export const EXPENSE_PAID_BY_CHIPS = [
  { id: "kushvanth" as const, label: "Kushvanth paid" },
  { id: "grishma" as const, label: "Grishma paid" },
  { id: "split" as const, label: "Both paid" },
];

export function withPaidBy(
  args: Record<string, unknown>,
  paidBy: (typeof EXPENSE_PAID_BY_CHIPS)[number]["id"]
): Record<string, unknown> {
  return { ...args, paid_by: paidBy };
}

export function expenseWriteNeedsPayer(call: AssistantToolCall): boolean {
  if (call.name !== "record_expense") return false;
  const paidBy = String(call.args.paid_by ?? "").toLowerCase().trim();
  if (paidBy === "kushvanth" || paidBy === "grishma" || paidBy === "split") return false;
  return String(call.args.expense_for ?? "") === "both";
}

export function writeToolNeedsAccount(call: AssistantToolCall): boolean {
  const args = call.args;
  switch (call.name) {
    case "record_expense":
      return !args.account_name && !args.account_id;
    case "record_income":
      return !args.deposit_account_name && !args.deposit_account_id;
    case "adjust_account_balance":
      return !args.account_name && !args.account_id;
    case "pay_debt_from_account":
      return !args.from_account_name && !args.from_account_id;
    default:
      return false;
  }
}

export function accountChoicePrompt(
  callName: string,
  kind: "pay-from" | "cash-source"
): string {
  if (kind === "cash-source") {
    return "Cash wallet is low — which account did the cash come from?";
  }
  if (callName === "record_income") return "Which account was the money deposited into?";
  return "Which account?";
}

export function withPickedAccount(
  call: AssistantToolCall,
  account: { id: string; name: string },
  kind: "pay-from" | "cash-source"
): AssistantToolCall {
  if (kind === "cash-source") {
    return {
      ...call,
      args: {
        ...call.args,
        cash_source_account_id: account.id,
        cash_source_account_name: account.name,
      },
    };
  }
  if (call.name === "record_income") {
    return {
      ...call,
      args: {
        ...call.args,
        deposit_account_id: account.id,
        deposit_account_name: account.name,
      },
    };
  }
  if (call.name === "pay_debt_from_account") {
    return {
      ...call,
      args: {
        ...call.args,
        from_account_id: account.id,
        from_account_name: account.name,
      },
    };
  }
  return {
    ...call,
    args: {
      ...call.args,
      account_id: account.id,
      account_name: account.name,
    },
  };
}

export function sortAccountChips<T extends { name: string }>(chips: T[]): T[] {
  const rank = (name: string) => {
    const key = name.toLowerCase();
    if (key.includes("green")) return 0;
    if (key.includes("cash")) return 1;
    if (key.includes("chime")) return 2;
    return 3;
  };
  return [...chips].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

function moneyLabel(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "this amount";
}

export function buildToolConfirmationPreview(call: AssistantToolCall): string {
  const args = call.args;

  switch (call.name) {
    case "record_income": {
      return `Record ${moneyLabel(args.amount)} income from ${String(args.source_name ?? "income")} into ${String(args.deposit_account_name ?? args.deposit_account_id ?? "an account")}.`;
    }
    case "record_expense": {
      const category = args.category ? ` for ${args.category}` : "";
      const expenseFor =
        args.expense_for === "both"
          ? "split between both of you"
          : `${personLabel(args.expense_for, "someone")}'s expense`;
      const paidBy =
        args.paid_by === "split"
          ? "both of you paying"
          : args.paid_by
            ? `${personLabel(args.paid_by, "someone")} paying`
            : "who paid?";
      const account = args.account_name ?? args.account_id ?? "selected account";
      return `Log ${moneyLabel(args.amount)}${category} — ${expenseFor}, ${paidBy} from ${account}.`;
    }
    case "add_debt":
      return `Add debt "${String(args.name)}" for ${moneyLabel(args.amount)}.`;
    case "record_debt_payment":
      return `Record ${moneyLabel(args.amount)} payment toward ${String(args.debt_name ?? args.debt_id ?? "a debt")}.`;
    case "pay_debt_from_account":
      return `Pay ${moneyLabel(args.amount)} toward ${String(args.debt_name ?? args.debt_id ?? "a debt")} from ${String(args.from_account_name ?? args.from_account_id ?? "an account")}.`;
    case "adjust_account_balance":
      return `Set ${String(args.account_name ?? args.account_id ?? "the account")} balance to ${moneyLabel(args.new_balance)}.`;
    case "add_account": {
      const kind = String(args.account_type ?? "account");
      const opening = Number(args.starting_balance);
      const balance = Number.isFinite(opening) && opening !== 0 ? ` starting at ${moneyLabel(opening)}` : "";
      return `Add a new ${kind} account "${String(args.name ?? "account")}"${balance}.`;
    }
    default:
      return `Save this ${call.name.replace(/_/g, " ")} action.`;
  }
}

export function spokenSaveConfirmation(call: AssistantToolCall): string {
  switch (call.name) {
    case "record_expense":
      return "The expenses are recorded.";
    case "record_income":
      return "The income is recorded.";
    case "adjust_account_balance":
      return "The balance is updated.";
    case "add_account":
      return "The account is added.";
    case "save_reminder":
      return "Got it.";
    default:
      return "Got it.";
  }
}

export function buildConfirmationToolResult(call: AssistantToolCall) {
  const preview = buildToolConfirmationPreview(call);
  return {
    ok: false,
    status: "needs_confirmation",
    preview,
    message: `Not saved yet. Say aloud: "${preview} Is that right?" Wait for yes, then call ${call.name} again with user_confirmed true.`,
  };
}
