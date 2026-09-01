"use client";

import { format } from "date-fns";
import { getAccountsForPerson } from "@/lib/accounts";
import { roundMoney, splitMoney } from "@/lib/money";
import {
  DEFAULT_LEAD_DAYS,
  describeSchedule,
  dueLabel,
  daysUntilDue,
  isDueSoon,
  renderReminderLine,
  type ReminderRepeat,
} from "@/lib/ai/reminders";
import { parseAiUserId } from "@/lib/ai/person";
import {
  buildConfirmationToolResult,
  isToolConfirmed,
  isWriteTool,
  stripConfirmationArg,
} from "@/lib/ai/assistant-confirmation";
import type { AssistantToolCall, AssistantToolResult } from "@/lib/ai/tools";
import {
  matchSpendCategoryFromNote,
  resolveSpendCategoryLabel,
} from "@/lib/spend-categories";
import {
  getMonthlyIncome,
  getMonthlySpendTotal,
  getNetWorth,
  groupExpensesByCategory,
  parseMonthKey,
} from "@/lib/calculations";
import { getInterCoupleSummary } from "@/lib/inter-couple";
import { PERSON_LABELS, type Account, Debt, Person } from "@/types";
import { useAssistantPreferencesStore } from "@/store/assistant-preferences-store";
import { useFinanceStore } from "@/store/finance-store";

function resolveMonthDate(monthArg: unknown): Date {
  if (typeof monthArg === "string" && /^\d{4}-\d{2}$/.test(monthArg.trim())) {
    return parseMonthKey(monthArg.trim());
  }
  return new Date();
}

function resolveToolPerson(fallback: Person, value: unknown): Person | null {
  return parseAiUserId(value) ?? fallback;
}

type ExpenseFor = Person | "both";
type PaidByMode = Person | "split";

function normalizeAccountKey(value: string) {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^green(dog|dote|dhot|dott)$/.test(key)) return "greendot";
  return key;
}

function findAccountForPerson(person: Person, nameOrId?: string): Account | undefined {
  if (!nameOrId) return undefined;
  const all = useFinanceStore.getState().accounts;
  const scoped = getAccountsForPerson(all, person);
  const byId = scoped.find((account) => account.id === nameOrId) ?? all.find((account) => account.id === nameOrId);
  if (byId) return byId;
  const needle = normalizeAccountKey(nameOrId);
  if (!needle) return undefined;
  const match = (account: Account) => {
    const name = normalizeAccountKey(account.name);
    return name.includes(needle) || needle.includes(name);
  };
  return scoped.find(match) ?? all.find(match);
}

function findDebt(person: Person, debtId?: string, debtName?: string): Debt | undefined {
  const debts = useFinanceStore.getState().debts.filter((debt) => debt.person === person);
  if (debtId) {
    const byId = debts.find((debt) => debt.id === debtId);
    if (byId) return byId;
  }
  if (!debtName) return undefined;
  const normalized = debtName.toLowerCase().trim();
  return debts.find(
    (debt) =>
      debt.name.toLowerCase().includes(normalized) ||
      normalized.includes(debt.name.toLowerCase())
  );
}

function ensureIncomeSource(person: Person, sourceName: string) {
  const store = useFinanceStore.getState();
  const existing = store.incomeSources.find(
    (source) =>
      source.person === person && source.name.toLowerCase() === sourceName.toLowerCase()
  );
  if (existing) return existing;
  store.addIncomeSource(person, sourceName.trim());
  return useFinanceStore.getState().incomeSources.find(
    (source) =>
      source.person === person && source.name.toLowerCase() === sourceName.toLowerCase()
  )!;
}

function todayDate() {
  return format(new Date(), "yyyy-MM-dd");
}

function parseExpenseFor(value: unknown, fallback: Person): ExpenseFor {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["both", "both of us", "shared", "split", "we", "us"].includes(normalized)) {
    return "both";
  }
  return parseAiUserId(value) ?? fallback;
}

function parsePaidBy(value: unknown, fallback: Person): PaidByMode {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["split", "both paid", "both", "both of us"].includes(normalized)) {
    return "split";
  }
  return parseAiUserId(value) ?? fallback;
}

function amountsMatchTotal(a: number, b: number, total: number) {
  return Math.abs(a + b - total) < 0.01;
}

function resolveCategoryLabel(
  categoryArg: unknown,
  notesArg: unknown,
  categoryId?: string | null
) {
  const store = useFinanceStore.getState();
  const notes = notesArg ? String(notesArg) : "";
  const category = categoryArg ? String(categoryArg) : "";
  const matched = category
    ? store.spendCategories.find((item) =>
        item.name.toLowerCase().includes(category.toLowerCase())
      )
    : matchSpendCategoryFromNote(notes, store.spendCategories);

  return resolveSpendCategoryLabel(store.spendCategories, matched?.id ?? categoryId ?? null, notes || category);
}

function listAccountsForPerson(person: Person) {
  return getAccountsForPerson(useFinanceStore.getState().accounts, person).map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    balance: account.balance,
    shared: account.shared ?? false,
    person: account.person,
  }));
}

function recordExpenseTool(person: Person, call: AssistantToolCall): AssistantToolResult {
  const amount = Number(call.args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { id: call.id, name: call.name, result: { ok: false, error: "Invalid amount" } };
  }

  const expenseFor = parseExpenseFor(call.args.expense_for, person);
  const paidBySpecified =
    call.args.paid_by != null && String(call.args.paid_by).trim() !== "";
  const sharedExpense = expenseFor === "both";
  if (sharedExpense && !paidBySpecified) {
    return {
      id: call.id,
      name: call.name,
      result: {
        ok: false,
        needs_payer: true,
        error: "Who paid — Kushvanth, Grishma, or both of you?",
      },
    };
  }
  const paidBy = parsePaidBy(call.args.paid_by, person);
  const category = resolveCategoryLabel(call.args.category, call.args.notes);
  const notes = call.args.notes ? String(call.args.notes) : undefined;

  let expenseShares: Partial<Record<Person, number>> | undefined;
  if (sharedExpense) {
    const kShare = Number(call.args.kushvanth_expense_share);
    const gShare = Number(call.args.grishma_expense_share);
    const splitEvenly = call.args.split_expense_evenly !== false;

    if (Number.isFinite(kShare) && Number.isFinite(gShare) && kShare + gShare > 0) {
      if (!amountsMatchTotal(kShare, gShare, amount)) {
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: false,
            needs_expense_split: true,
            error: `Expense shares must add to $${amount.toFixed(2)}.`,
          },
        };
      }
      expenseShares = { kushvanth: kShare, grishma: gShare };
    } else if (splitEvenly) {
      // Cent-exact so the two shares add back to the bill exactly.
      const [kushvanth, grishma] = splitMoney(amount, 2);
      expenseShares = { kushvanth, grishma };
    } else {
      return {
        id: call.id,
        name: call.name,
        result: {
          ok: false,
          needs_expense_split: true,
          error: "How should the expense be split between Kushvanth and Grishma?",
        },
      };
    }
  }

  const expenseOwner = sharedExpense ? undefined : (expenseFor as Person);

  if (paidBy === "split") {
    let kPaid = Number(call.args.kushvanth_paid_amount);
    let gPaid = Number(call.args.grishma_paid_amount);

    if (!Number.isFinite(kPaid) || !Number.isFinite(gPaid) || kPaid + gPaid <= 0) {
      const [halfK] = splitMoney(amount, 2);
      kPaid = Number.isFinite(kPaid) && kPaid > 0 ? kPaid : halfK;
      gPaid = Number.isFinite(gPaid) && gPaid > 0 ? gPaid : roundMoney(amount - kPaid);
    }

    if (!amountsMatchTotal(kPaid, gPaid, amount)) {
      return {
        id: call.id,
        name: call.name,
        result: {
          ok: false,
          needs_payment_split: true,
          error: `Payment amounts must add to $${amount.toFixed(2)}.`,
        },
      };
    }

    const payments: Array<{
      person: Person;
      amount: number;
      accountId: string;
      cashSourceAccountId?: string;
    }> = [];

    const payers: Array<{ person: Person; paid: number; accountIdKey: string; accountNameKey: string; cashKey: string }> = [
      {
        person: "kushvanth",
        paid: kPaid,
        accountIdKey: "kushvanth_account_id",
        accountNameKey: "kushvanth_account_name",
        cashKey: "kushvanth_cash_source_account_id",
      },
      {
        person: "grishma",
        paid: gPaid,
        accountIdKey: "grishma_account_id",
        accountNameKey: "grishma_account_name",
        cashKey: "grishma_cash_source_account_id",
      },
    ];

    for (const entry of payers) {
      if (entry.paid <= 0) continue;

      const account =
        findAccountForPerson(
          entry.person,
          call.args[entry.accountIdKey]
            ? String(call.args[entry.accountIdKey])
            : call.args[entry.accountNameKey]
              ? String(call.args[entry.accountNameKey])
              : undefined
        ) ?? undefined;

      if (!account) {
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: false,
            needs_account: true,
            for_person: entry.person,
            error: `Which account did ${entry.person === "kushvanth" ? "Kushvanth" : "Grishma"} pay $${entry.paid.toFixed(2)} from?`,
            accounts: listAccountsForPerson(entry.person),
          },
        };
      }

      const cashSourceId = call.args[entry.cashKey]
        ? String(call.args[entry.cashKey])
        : undefined;

      if (account.type === "cash" && account.balance < entry.paid && !cashSourceId) {
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: false,
            needs_cash_source: true,
            for_person: entry.person,
            error: `Cash wallet has $${account.balance.toFixed(2)}. Which debit account did the cash come from?`,
            accounts: listAccountsForPerson(entry.person).filter((item) => item.type === "debit"),
          },
        };
      }

      payments.push({
        person: entry.person,
        amount: entry.paid,
        accountId: account.id,
        cashSourceAccountId: cashSourceId,
      });
    }

    if (payments.length === 0) {
      return {
        id: call.id,
        name: call.name,
        result: {
          ok: false,
          needs_payment_split: true,
          error: "Who paid how much — Kushvanth, Grishma, or both?",
        },
      };
    }

    useFinanceStore.getState().spendSplit({
      category,
      expenseOwner,
      expenseShares,
      notes,
      payments,
    });

    return {
      id: call.id,
      name: call.name,
      result: {
        ok: true,
        saved: true,
        message: `Recorded $${amount.toFixed(2)} split payment${sharedExpense ? " shared between you both" : ""}.`,
        category,
        expense_for: expenseFor,
        paid_by: "split",
      },
    };
  }

  const payer = paidBy as Person;
  const account =
    findAccountForPerson(
      payer,
      call.args.account_id
        ? String(call.args.account_id)
        : call.args.account_name
          ? String(call.args.account_name)
          : undefined
    ) ?? undefined;

  if (!account) {
    return {
      id: call.id,
      name: call.name,
      result: {
        ok: false,
        needs_account: true,
        for_person: payer,
        error: `Which account did ${payer === "kushvanth" ? "Kushvanth" : "Grishma"} pay from?`,
        accounts: listAccountsForPerson(payer),
      },
    };
  }

  if (
    account.type === "cash" &&
    account.balance < amount &&
    !call.args.cash_source_account_id &&
    !call.args.cash_source_account_name
  ) {
    return {
      id: call.id,
      name: call.name,
      result: {
        ok: false,
        needs_cash_source: true,
        for_person: payer,
        error: `Cash wallet has $${account.balance.toFixed(2)}. Which debit account did the cash come from?`,
        accounts: listAccountsForPerson(payer).filter((item) => item.type === "debit"),
      },
    };
  }

  const cashSourceAccount =
    findAccountForPerson(
      payer,
      call.args.cash_source_account_id
        ? String(call.args.cash_source_account_id)
        : call.args.cash_source_account_name
          ? String(call.args.cash_source_account_name)
          : undefined
    ) ?? undefined;

  const beneficiaryPerson =
    !sharedExpense && expenseOwner && expenseOwner !== payer ? expenseOwner : undefined;

  useFinanceStore.getState().spend({
    person: payer,
    amount,
    accountId: account.id,
    cashSourceAccountId: cashSourceAccount?.id,
    category,
    notes,
    beneficiaryPerson,
    expenseOwner,
    expenseShares,
  });

  const updated = useFinanceStore.getState().accounts.find((item) => item.id === account.id);

  let message = `Recorded $${amount.toFixed(2)}`;
  if (category) message += ` for ${category}`;
  message += ` paid by ${payer === "kushvanth" ? "Kushvanth" : "Grishma"} from ${account.name}.`;
  if (sharedExpense) message += " Split between both of you.";
  else if (beneficiaryPerson) {
    message += ` Expense for ${beneficiaryPerson === "kushvanth" ? "Kushvanth" : "Grishma"}.`;
  }

  return {
    id: call.id,
    name: call.name,
    result: {
      ok: true,
      saved: true,
      message,
      new_balance: updated?.balance,
      account_name: account.name,
    },
  };
}

export function executeAssistantTool(
  person: Person,
  call: AssistantToolCall
): AssistantToolResult {
  if (isWriteTool(call.name) && !isToolConfirmed(call.args)) {
    return {
      id: call.id,
      name: call.name,
      result: buildConfirmationToolResult(call),
    };
  }

  const args = isWriteTool(call.name) ? stripConfirmationArg(call.args) : call.args;
  const effectiveCall = { ...call, args };

  const store = useFinanceStore.getState();

  try {
    switch (effectiveCall.name) {
      case "list_accounts": {
        const forPerson = parseAiUserId(call.args.for_person) ?? person;
        return {
          id: call.id,
          name: call.name,
          result: { ok: true, for_person: forPerson, accounts: listAccountsForPerson(forPerson) },
        };
      }

      case "list_spend_categories": {
        const categories = store.spendCategories.map((category) => ({
          id: category.id,
          name: category.name,
          keywords: category.keywords ?? [],
        }));
        return { id: call.id, name: call.name, result: { ok: true, categories } };
      }

      case "list_income_sources": {
        const sources = store.incomeSources.map((source) => ({
          id: source.id,
          name: source.name,
          person: source.person,
        }));
        return { id: call.id, name: call.name, result: { ok: true, sources } };
      }

      case "record_income": {
        const amount = Number(call.args.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Invalid amount" } };
        }

        const sourceName = String(call.args.source_name ?? "Income");
        const forPerson = parseAiUserId(args.for_person) ?? person;
        const depositAccount =
          findAccountForPerson(
            forPerson,
            args.deposit_account_id
              ? String(args.deposit_account_id)
              : args.deposit_account_name
                ? String(args.deposit_account_name)
                : undefined
          ) ?? undefined;

        if (!depositAccount) {
          return {
            id: effectiveCall.id,
            name: effectiveCall.name,
            result: {
              ok: false,
              needs_account: true,
              error: "Which account was the money deposited into?",
              accounts: listAccountsForPerson(forPerson),
            },
          };
        }

        const source = ensureIncomeSource(forPerson, sourceName);
        store.addIncome({
          person: forPerson,
          sourceId: source.id,
          amount,
          date: call.args.date ? String(call.args.date) : todayDate(),
          notes: call.args.notes ? String(call.args.notes) : undefined,
          depositType: depositAccount.type === "cash" ? "cash" : "debit",
          depositAccountId: depositAccount.id,
        });

        const updated = useFinanceStore.getState().accounts.find(
          (account) => account.id === depositAccount.id
        );

        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Recorded $${amount.toFixed(2)} from ${sourceName} into ${depositAccount.name}.`,
            new_balance: updated?.balance,
            account_name: depositAccount.name,
          },
        };
      }

      case "record_expense":
        return recordExpenseTool(person, effectiveCall);

      case "add_debt": {
        const name = String(call.args.name ?? "").trim();
        const amount = Number(call.args.amount);
        if (!name) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Debt name required" } };
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Invalid amount" } };
        }

        store.addDebt({
          person,
          name,
          amount,
          notes: call.args.notes ? String(call.args.notes) : undefined,
        });

        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Added debt "${name}" for $${amount.toFixed(2)}.`,
          },
        };
      }

      case "add_account": {
        const name = String(call.args.name ?? "").trim();
        const rawType = String(call.args.account_type ?? "").toLowerCase().trim();
        const accountType =
          rawType === "credit" || rawType === "debit" || rawType === "cash" ? rawType : null;

        if (!name) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Account name required" } };
        }
        if (!accountType) {
          return {
            id: call.id,
            name: call.name,
            result: { ok: false, error: "Is it a debit account, a credit card, or cash?" },
          };
        }

        // Creating a second "GreenDot" would silently split their history, so
        // match on name the same way the rest of the app resolves accounts.
        const existing = store.accounts.find(
          (account) => account.name.toLowerCase().trim() === name.toLowerCase()
        );
        if (existing) {
          return {
            id: call.id,
            name: call.name,
            result: {
              ok: false,
              already_exists: true,
              error: `"${existing.name}" already exists.`,
            },
          };
        }

        const owner = parseAiUserId(call.args.for_person) ?? person;
        const startingBalance = Number(call.args.starting_balance);
        const creditLimit = Number(call.args.credit_limit);

        store.addAccount({
          person: owner,
          name,
          type: accountType,
          balance: Number.isFinite(startingBalance) ? roundMoney(startingBalance) : 0,
          ...(accountType === "credit" && Number.isFinite(creditLimit)
            ? { creditLimit: roundMoney(creditLimit) }
            : {}),
          ...(call.args.shared === true ? { shared: true } : {}),
        });

        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Added ${accountType} account "${name}".`,
          },
        };
      }

      case "record_debt_payment": {
        const amount = Number(call.args.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Invalid amount" } };
        }

        const debt = findDebt(
          person,
          call.args.debt_id ? String(call.args.debt_id) : undefined,
          call.args.debt_name ? String(call.args.debt_name) : undefined
        );

        if (!debt) {
          const debts = store.debts
            .filter((item) => item.person === person)
            .map((item) => ({ id: item.id, name: item.name, amount: item.amount }));
          return {
            id: call.id,
            name: call.name,
            result: {
              ok: false,
              needs_debt: true,
              error: "Which debt is this payment for?",
              debts,
            },
          };
        }

        store.recordDebtPayment(
          debt.id,
          amount,
          call.args.notes ? String(call.args.notes) : undefined
        );

        const updated = useFinanceStore.getState().debts.find((item) => item.id === debt.id);

        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Recorded $${amount.toFixed(2)} payment toward ${debt.name}.`,
            remaining: updated?.amount ?? 0,
          },
        };
      }

      case "pay_debt_from_account": {
        const amount = Number(call.args.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Invalid amount" } };
        }

        const debt = findDebt(
          person,
          call.args.debt_id ? String(call.args.debt_id) : undefined,
          call.args.debt_name ? String(call.args.debt_name) : undefined
        );
        const account = findAccountForPerson(
          person,
          call.args.from_account_id
            ? String(call.args.from_account_id)
            : call.args.from_account_name
              ? String(call.args.from_account_name)
              : undefined
        );

        if (!debt) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Debt not found" } };
        }
        if (!account) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Account not found" } };
        }

        store.payDebt(
          debt.id,
          amount,
          account.id,
          call.args.notes ? String(call.args.notes) : undefined
        );

        const updatedDebt = useFinanceStore.getState().debts.find((item) => item.id === debt.id);

        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Paid $${amount.toFixed(2)} toward ${debt.name} from ${account.name}.`,
            remaining: updatedDebt?.amount ?? 0,
          },
        };
      }

      case "adjust_account_balance": {
        const newBalance = Number(args.new_balance);
        if (!Number.isFinite(newBalance)) {
          return {
            id: call.id,
            name: call.name,
            result: { ok: false, error: "What should the new balance be?" },
          };
        }

        const accountNameOrId = args.account_id
          ? String(args.account_id)
          : args.account_name
            ? String(args.account_name)
            : undefined;

        if (!accountNameOrId) {
          return {
            id: call.id,
            name: call.name,
            result: {
              ok: false,
              needs_account: true,
              error: "Which account should I update — Green Dot, Chime, or another?",
              accounts: listAccountsForPerson(person),
            },
          };
        }

        const account = findAccountForPerson(person, accountNameOrId);

        if (!account) {
          return {
            id: call.id,
            name: call.name,
            result: {
              ok: false,
              needs_account: true,
              error: "Which account should I update?",
              accounts: listAccountsForPerson(person),
            },
          };
        }

        const previous = account.balance;
        store.adjustAccountBalance(
          account.id,
          newBalance,
          args.notes ? String(args.notes) : "Updated from AI"
        );
        const updated = useFinanceStore.getState().accounts.find((item) => item.id === account.id);

        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            account_name: account.name,
            previous_balance: previous,
            new_balance: updated?.balance ?? newBalance,
            message: `Saved. ${account.name} is now $${(updated?.balance ?? newBalance).toFixed(2)}. Check Accounts and History.`,
          },
        };
      }

      case "calculate_monthly_summary": {
        const forPerson = resolveToolPerson(person, args.for_person);
        if (!forPerson) {
          return {
            id: call.id,
            name: call.name,
            result: { ok: false, error: "for_person must be kushvanth or grishma" },
          };
        }
        const monthDate = resolveMonthDate(args.month);
        const income = getMonthlyIncome(store.incomeEntries, forPerson, monthDate);
        const spend = getMonthlySpendTotal(
          store.transactions,
          forPerson,
          monthDate,
          store.interCoupleHistory
        );
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            person: forPerson,
            month: format(monthDate, "yyyy-MM"),
            income_usd: income,
            spend_usd: spend,
            net_usd: income - spend,
            summary: `${PERSON_LABELS[forPerson]}: income $${income.toFixed(2)}, spend $${spend.toFixed(2)}, net $${(income - spend).toFixed(2)} for ${format(monthDate, "MMMM yyyy")}.`,
          },
        };
      }

      case "calculate_net_worth": {
        const forPerson = args.for_person ? parseAiUserId(args.for_person) : null;
        const netWorth = getNetWorth(store.accounts, store.debts, forPerson);
        const assets = store.accounts
          .filter((a) => !forPerson || a.shared || a.person === forPerson)
          .filter((a) => a.type !== "credit")
          .reduce((sum, a) => sum + a.balance, 0);
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            for_person: forPerson ?? "household",
            net_worth_usd: netWorth,
            liquid_assets_usd: assets,
            summary: `Net worth${forPerson ? ` for ${PERSON_LABELS[forPerson]}` : " (household)"}: $${netWorth.toFixed(2)}.`,
          },
        };
      }

      case "calculate_category_breakdown": {
        const forPerson = resolveToolPerson(person, args.for_person);
        if (!forPerson) {
          return {
            id: call.id,
            name: call.name,
            result: { ok: false, error: "for_person must be kushvanth or grishma" },
          };
        }
        const monthDate = resolveMonthDate(args.month);
        const monthTx = store.transactions.filter((tx) => {
          if (tx.type !== "expense") return false;
          return tx.date.startsWith(format(monthDate, "yyyy-MM"));
        });
        const breakdown = groupExpensesByCategory(monthTx, forPerson);
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            person: forPerson,
            month: format(monthDate, "yyyy-MM"),
            categories: breakdown,
          },
        };
      }

      case "calculate_between_us_balance": {
        const summary = getInterCoupleSummary(store.interCoupleBalance);
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            balance_usd: store.interCoupleBalance,
            amount_owed: summary.amount,
            label: summary.label,
            summary: summary.label,
          },
        };
      }

      case "preview_expense_split": {
        const amount = Number(args.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return { id: call.id, name: call.name, result: { ok: false, error: "Invalid amount" } };
        }
        const splitEvenly = args.split_evenly !== false;
        let kShare = Number(args.kushvanth_share);
        let gShare = Number(args.grishma_share);
        if (splitEvenly || !Number.isFinite(kShare) || !Number.isFinite(gShare)) {
          [kShare, gShare] = splitMoney(amount, 2);
        }
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            total_usd: amount,
            kushvanth_share: kShare,
            grishma_share: gShare,
            summary: `Split $${amount.toFixed(2)}: Kushvanth $${kShare.toFixed(2)}, Grishma $${gShare.toFixed(2)}.`,
          },
        };
      }

      case "save_behavior_preference": {
        const instruction = String(args.instruction ?? "").trim();
        if (!instruction) {
          return { id: call.id, name: call.name, result: { ok: false, error: "instruction required" } };
        }
        useAssistantPreferencesStore.getState().addBehaviorInstruction(instruction);
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Got it — I'll remember: "${instruction.slice(0, 120)}"`,
          },
        };
      }

      case "save_reminder": {
        const reminder = String(args.reminder ?? "").trim();
        if (!reminder) {
          return { id: call.id, name: call.name, result: { ok: false, error: "reminder required" } };
        }
        const when = args.when ? String(args.when).trim() : "";
        const timezone = args.timezone ? String(args.timezone).trim() : "";
        // Keep only what does not fit a real field, so the text stays the
        // user's words and the schedule lives as data.
        const extras = [when, timezone ? `tz:${timezone}` : ""].filter(Boolean).join(" · ");
        const text = extras ? `${reminder} (${extras})` : reminder;

        const asNumber = (value: unknown, min: number, max: number) => {
          const n = Number(value);
          return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
        };
        const rawRepeat = String(args.repeat ?? "").toLowerCase().trim();
        const repeat: ReminderRepeat =
          rawRepeat === "weekly" || rawRepeat === "monthly" || rawRepeat === "yearly"
            ? rawRepeat
            : "once";
        const time = /^\d{1,2}:\d{2}$/.test(String(args.time ?? "").trim())
          ? String(args.time).trim()
          : undefined;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? "").trim())
          ? String(args.date).trim()
          : undefined;

        useAssistantPreferencesStore.getState().addStructuredReminder({
          text,
          done: false,
          repeat,
          leadDays: asNumber(args.lead_days, 0, 60) ?? DEFAULT_LEAD_DAYS,
          ...(repeat === "once" && date ? { date } : {}),
          ...(repeat === "weekly" ? { weekday: asNumber(args.weekday, 0, 6) } : {}),
          ...(repeat === "monthly" || repeat === "yearly"
            ? { dayOfMonth: asNumber(args.day_of_month, 1, 31) }
            : {}),
          ...(repeat === "yearly" ? { month: asNumber(args.month, 1, 12) } : {}),
          ...(time ? { time } : {}),
        });
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            // Read back the schedule too, so a mis-heard cycle is caught now
            // rather than the day a bill is missed.
            message: `Saved. I'll remember: "${text.slice(0, 140)}" — ${describeSchedule({
              id: "new",
              text,
              done: false,
              repeat,
              leadDays: asNumber(args.lead_days, 0, 60) ?? DEFAULT_LEAD_DAYS,
              ...(repeat === "once" && date ? { date } : {}),
              ...(repeat === "weekly" ? { weekday: asNumber(args.weekday, 0, 6) } : {}),
              ...(repeat === "monthly" || repeat === "yearly"
                ? { dayOfMonth: asNumber(args.day_of_month, 1, 31) }
                : {}),
              ...(repeat === "yearly" ? { month: asNumber(args.month, 1, 12) } : {}),
              ...(time ? { time } : {}),
            })}`,
          },
        };
      }

      case "update_reminder": {
        const match = String(args.match ?? "").trim().toLowerCase();
        const store = useAssistantPreferencesStore.getState();
        // Match every candidate, not the first. Changing the wrong reminder
        // because two share a word is silent damage the user would not see.
        const hits = match
          ? store.structuredReminders.filter((item) => item.text.toLowerCase().includes(match))
          : [];
        if (hits.length > 1) {
          return {
            id: call.id,
            name: call.name,
            result: {
              ok: false,
              error: `"${args.match ?? ""}" matches ${hits.length} reminders: ${hits
                .map((item) => `"${item.text}"`)
                .join(", ")}. Ask which one they mean.`,
            },
          };
        }
        const target = hits[0];
        if (!match || !target) {
          return {
            id: call.id,
            name: call.name,
            result: {
              ok: false,
              error: `No reminder matched "${args.match ?? ""}". Call list_reminders and use the exact wording.`,
            },
          };
        }

        const asNumber = (value: unknown, min: number, max: number) => {
          const n = Number(value);
          return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
        };
        const rawRepeat = String(args.repeat ?? "").toLowerCase().trim();
        const repeat: ReminderRepeat | undefined =
          rawRepeat === "once" || rawRepeat === "weekly" || rawRepeat === "monthly" || rawRepeat === "yearly"
            ? rawRepeat
            : undefined;

        const updates: Partial<typeof target> = {
          ...(args.new_text ? { text: String(args.new_text).trim() } : {}),
          ...(repeat ? { repeat } : {}),
          ...(args.day_of_month != null ? { dayOfMonth: asNumber(args.day_of_month, 1, 31) } : {}),
          ...(args.weekday != null ? { weekday: asNumber(args.weekday, 0, 6) } : {}),
          ...(args.month != null ? { month: asNumber(args.month, 1, 12) } : {}),
          ...(/^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? "")) ? { date: String(args.date) } : {}),
          ...(/^\d{1,2}:\d{2}$/.test(String(args.time ?? "")) ? { time: String(args.time) } : {}),
          ...(args.lead_days != null ? { leadDays: asNumber(args.lead_days, 0, 60) ?? target.leadDays } : {}),
        };

        store.updateStructuredReminder(target.id, updates);
        const after = { ...target, ...updates };
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Updated: "${after.text}" — ${describeSchedule(after)}.`,
          },
        };
      }

      case "delete_reminder": {
        const match = String(args.match ?? "").trim().toLowerCase();
        const store = useAssistantPreferencesStore.getState();
        const hits = match
          ? store.structuredReminders.filter((item) => item.text.toLowerCase().includes(match))
          : [];
        if (hits.length > 1) {
          return {
            id: call.id,
            name: call.name,
            result: {
              ok: false,
              error: `"${args.match ?? ""}" matches ${hits.length} reminders: ${hits
                .map((item) => `"${item.text}"`)
                .join(", ")}. Ask which one to remove.`,
            },
          };
        }
        const target = hits[0];
        if (!match || !target) {
          return {
            id: call.id,
            name: call.name,
            result: { ok: false, error: `No reminder matched "${args.match ?? ""}".` },
          };
        }
        store.deleteStructuredReminder(target.id);
        return {
          id: call.id,
          name: call.name,
          result: { ok: true, saved: true, message: `Removed: "${target.text}".` },
        };
      }

      case "list_behavior_preferences": {
        const rules = useAssistantPreferencesStore.getState().behaviorInstructions;
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            count: rules.length,
            rules,
            summary: rules.length === 0 ? "No saved rules." : rules.join("; "),
          },
        };
      }

      case "delete_behavior_preference": {
        const match = String(args.match ?? "").trim().toLowerCase();
        const store = useAssistantPreferencesStore.getState();
        const rules = store.behaviorInstructions;
        const target = rules.find((line) => line.toLowerCase().includes(match));
        if (!match || !target) {
          return {
            id: call.id,
            name: call.name,
            result: { ok: false, error: `No rule matched "${args.match ?? ""}".` },
          };
        }
        store.setBehaviorInstructions(rules.filter((line) => line !== target));
        void store.syncToServer();
        return {
          id: call.id,
          name: call.name,
          result: { ok: true, saved: true, message: `Stopped following: "${target}".` },
        };
      }

      case "list_reminders": {
        const reminders = useAssistantPreferencesStore.getState().reminders;
        const pending = reminders.filter((line) => !line.toUpperCase().startsWith("[DONE]"));
        const done = reminders.filter((line) => line.toUpperCase().startsWith("[DONE]"));
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            count: reminders.length,
            pending,
            done,
            reminders,
            summary:
              reminders.length === 0
                ? "No saved reminders yet."
                : `${pending.length} pending, ${done.length} done. Pending: ${pending.join("; ") || "none"}`,
          },
        };
      }

      case "mark_reminder_done": {
        const match = String(args.reminder ?? "").trim();
        const marked = useAssistantPreferencesStore.getState().markReminderDone(match);
        if (!marked) {
          return {
            id: call.id,
            name: call.name,
            result: { ok: false, error: `No pending reminder matched "${match}".` },
          };
        }
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Marked done: ${marked.replace(/^\[DONE\]\s*/i, "")}`,
          },
        };
      }

      case "get_daily_briefing": {
        const now = new Date();
        const day = now.getDate();
        const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
        const dateLabel = now.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "America/Chicago",
        });
        // Reminders carry real schedules now, so what is due is CALCULATED.
        // This used to substring-match the day number against the sentence,
        // which fired on any reminder that merely contained those digits.
        const structured = useAssistantPreferencesStore.getState().structuredReminders;
        const openItems = structured.filter((item) => !item.done);
        const dueNow = openItems
          .filter((item) => isDueSoon(item, now))
          .map((item) => ({
            reminder: item.text,
            due: dueLabel(item, now),
            days_away: daysUntilDue(item, now),
          }))
          .sort((a, b) => (a.days_away ?? 99) - (b.days_away ?? 99));
        const pending = openItems.map(renderReminderLine);
        const undated = openItems.filter((item) => daysUntilDue(item, now) == null).length;

        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            today: dateLabel,
            day_of_month: day,
            weekday,
            timezone: "America/Chicago (US Central)",
            pending_reminders: pending,
            due_now: dueNow,
            undated_count: undated,
            summary:
              pending.length === 0
                ? `Today is ${dateLabel}. No pending reminders.`
                : dueNow.length === 0
                  ? `Today is ${dateLabel}. Nothing is due within its reminder window. ${pending.length} pending overall.`
                  : `Today is ${dateLabel}. Due now: ${dueNow
                      .map((item) => `${item.reminder} (${item.due})`)
                      .join("; ")}.`,
          },
        };
      }

      default:
        return {
          id: call.id,
          name: call.name,
          result: { ok: false, error: `Unknown tool: ${call.name}` },
        };
    }
  } catch (error) {
    return {
      id: call.id,
      name: call.name,
      result: {
        ok: false,
        error: error instanceof Error ? error.message : "Tool execution failed",
      },
    };
  }
}

export function executeAssistantTools(
  person: Person,
  calls: AssistantToolCall[]
): AssistantToolResult[] {
  return calls.map((call) => executeAssistantTool(person, call));
}
