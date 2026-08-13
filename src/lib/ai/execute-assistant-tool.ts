"use client";

import { format } from "date-fns";
import { getAccountsForPerson } from "@/lib/accounts";
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
      const half = amount / 2;
      expenseShares = { kushvanth: half, grishma: half };
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
      const half = amount / 2;
      kPaid = Number.isFinite(kPaid) && kPaid > 0 ? kPaid : half;
      gPaid = Number.isFinite(gPaid) && gPaid > 0 ? gPaid : amount - kPaid;
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
          kShare = amount / 2;
          gShare = amount / 2;
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
        const extras = [when, timezone ? `tz:${timezone}` : ""].filter(Boolean).join(" · ");
        const line = extras ? `${reminder} (${extras})` : reminder;
        useAssistantPreferencesStore.getState().addReminder(line);
        return {
          id: call.id,
          name: call.name,
          result: {
            ok: true,
            saved: true,
            message: `Saved. I'll remember: "${line.slice(0, 160)}"`,
          },
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
        const reminders = useAssistantPreferencesStore.getState().reminders;
        const pending = reminders.filter((line) => !line.toUpperCase().startsWith("[DONE]"));
        const dueToday = pending.filter((line) => {
          const lower = line.toLowerCase();
          return (
            lower.includes(` ${day}`) ||
            lower.includes(`${day}st`) ||
            lower.includes(`${day}nd`) ||
            lower.includes(`${day}rd`) ||
            lower.includes(`${day}th`) ||
            lower.includes(weekday.toLowerCase()) ||
            lower.includes("today")
          );
        });
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
            likely_due_today: dueToday,
            summary:
              pending.length === 0
                ? `Today is ${dateLabel}. No pending reminders.`
                : `Today is ${dateLabel}. ${dueToday.length} item(s) look due around today. ${pending.length} pending overall.`,
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
