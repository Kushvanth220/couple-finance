"use client";

import { useState, useMemo } from "react";
import {
  ArrowRight,
  Banknote,
  ChevronDown,
  CreditCard,
  Wallet,
} from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { PersonTabs } from "@/components/ui/person-tabs";
import { useFinanceStore } from "@/store/finance-store";
import { getMonthExpenses } from "@/lib/calculations";
import { formatCurrency } from "@/lib/formatters";
import { getMonthlyExpensePaid, getMonthlyExpenseProgress } from "@/lib/monthly-expense-tracker";
import { getInterCoupleUpdatesFromShares } from "@/lib/transaction-reversal";
import { describeInterCoupleFromSpend } from "@/lib/inter-couple";
import { PERSON_LABELS, type Account, type Debt, type MonthlyExpense, type Person } from "@/types";
import { cn } from "@/lib/utils";

type Step = "details" | "payment" | "cash-source" | "done";
type PaidByMode = "kushvanth" | "grishma" | "split";
type CategoryMode = "bills" | "debts" | "custom";

type CategorySelection =
  | { type: "expense"; item: MonthlyExpense }
  | { type: "debt"; item: Debt }
  | { type: "custom"; name: string; owner: Person | "both" };

type ExpenseOwner = Person | "both";

interface PaymentSelection {
  person: Person;
  amount: number;
  accountId: string;
  cashSourceAccountId?: string;
}

function expenseSubLine(expense: MonthlyExpense, transactions: ReturnType<typeof useFinanceStore.getState>["transactions"]) {
  if (expense.isVariable) return "Variable";
  const progress = getMonthlyExpenseProgress(expense, transactions);
  if (!progress) {
    return expense.amount != null ? formatCurrency(expense.amount) : "—";
  }
  return `${formatCurrency(progress.remainingThisMonth)} left`;
}

function getOwner(selection: CategorySelection | null): ExpenseOwner {
  if (!selection) return "kushvanth";
  if (selection.type === "custom") return selection.owner;
  return selection.item.person;
}

function isSharedExpense(selection: CategorySelection | null): boolean {
  return selection?.type === "custom" && selection.owner === "both";
}

function getLabel(selection: CategorySelection | null): string {
  if (!selection) return "";
  if (selection.type === "custom") return selection.name;
  return selection.item.name;
}

function isDebt(selection: CategorySelection | null): boolean {
  return selection?.type === "debt";
}

export default function SpendPage() {
  const {
    accounts,
    debts,
    monthlyExpenses,
    transactions,
    spend,
    spendSplit,
    payDebt,
    payDebtForOther,
  } = useFinanceStore();

  const [step, setStep] = useState<Step>("details");
  const [amount, setAmount] = useState("");
  const [selection, setSelection] = useState<CategorySelection | null>(null);
  const [customName, setCustomName] = useState("");
  const [customOwner, setCustomOwner] = useState<ExpenseOwner>("kushvanth");
  const [paidByMode, setPaidByMode] = useState<PaidByMode>("kushvanth");
  const [kushShare, setKushShare] = useState("");
  const [grishShare, setGrishShare] = useState("");
  const [expenseShareKush, setExpenseShareKush] = useState("");
  const [expenseShareGrish, setExpenseShareGrish] = useState("");
  const [notes, setNotes] = useState("");
  const [categoryPerson, setCategoryPerson] = useState<Person>("kushvanth");
  const [categoryMode, setCategoryMode] = useState<CategoryMode>("bills");
  const [showNotes, setShowNotes] = useState(false);

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [pendingCashFor, setPendingCashFor] = useState<Person | null>(null);
  const [splitPayments, setSplitPayments] = useState<Partial<Record<Person, PaymentSelection>>>({});

  const parsedAmount = parseFloat(amount) || 0;
  const expenseOwner = getOwner(selection);
  const sharedExpense = isSharedExpense(selection);
  const categoryLabel = getLabel(selection);
  const payingDebt = isDebt(selection);

  const expenseCategories = useMemo(() => {
    const kush = getMonthExpenses(monthlyExpenses, "kushvanth");
    const grish = getMonthExpenses(monthlyExpenses, "grishma");
    return { kush, grish };
  }, [monthlyExpenses]);

  const debtCategories = useMemo(() => ({
    kush: debts.filter((d) => d.person === "kushvanth"),
    grish: debts.filter((d) => d.person === "grishma"),
  }), [debts]);

  const reset = () => {
    setStep("details");
    setAmount("");
    setSelection(null);
    setCustomName("");
    setCustomOwner("kushvanth");
    setPaidByMode("kushvanth");
    setKushShare("");
    setGrishShare("");
    setExpenseShareKush("");
    setExpenseShareGrish("");
    setNotes("");
    setSelectedAccount(null);
    setPendingCashFor(null);
    setSplitPayments({});
    setCategoryPerson("kushvanth");
    setCategoryMode("bills");
    setShowNotes(false);
  };

  const handleCategoryModeChange = (mode: CategoryMode) => {
    setCategoryMode(mode);
    if (mode === "custom") {
      setSelection({ type: "custom", name: customName, owner: customOwner });
    } else if (selection?.type === "custom") {
      setSelection(null);
      setCustomName("");
    }
  };

  const handleCategoryPersonChange = (person: Person) => {
    setCategoryPerson(person);
    if (
      selection &&
      selection.type !== "custom" &&
      selection.item.person !== person
    ) {
      setSelection(null);
    }
  };

  const selectionSummary = useMemo(() => {
    if (!selection) return null;
    if (selection.type === "custom") {
      return customName.trim() ? customName.trim() : "Something else";
    }
    return selection.item.name;
  }, [selection, customName]);

  const selectionMeta = useMemo(() => {
    if (!selection) return null;
    if (selection.type === "custom") {
      return customOwner === "both"
        ? "Custom · both of you"
        : `Custom · ${PERSON_LABELS[customOwner]}`;
    }
    if (selection.type === "debt") {
      return `Debt · ${PERSON_LABELS[selection.item.person]}`;
    }
    return `Monthly bill · ${PERSON_LABELS[selection.item.person]}`;
  }, [selection, customOwner]);

  const selectExpense = (expense: MonthlyExpense) => {
    setCategoryPerson(expense.person);
    setCategoryMode("bills");
    setSelection({ type: "expense", item: expense });
    setCustomName("");
    if (!amount.trim() && expense.amount != null) {
      setAmount(String(expense.amount));
      if (paidByMode !== "split") {
        applySplitAmounts(expense.amount, paidByMode);
      }
    }
  };

  const selectDebt = (debt: Debt) => {
    setCategoryPerson(debt.person);
    setCategoryMode("debts");
    setSelection({ type: "debt", item: debt });
    setCustomName("");
    if (!amount.trim()) {
      setAmount(String(debt.amount));
      if (paidByMode !== "split") {
        applySplitAmounts(debt.amount, paidByMode);
      }
    }
  };

  const applySplitAmounts = (total: number, mode: PaidByMode, resetSplit = false) => {
    if (mode === "kushvanth") {
      setKushShare(String(total));
      setGrishShare("0");
    } else if (mode === "grishma") {
      setKushShare("0");
      setGrishShare(String(total));
    } else if (resetSplit || (kushShare === "" && grishShare === "")) {
      const half = total / 2;
      setKushShare(String(half));
      setGrishShare(String(half));
    }
  };

  const applyEvenExpenseSplit = (total: number) => {
    const half = total / 2;
    setExpenseShareKush(String(half));
    setExpenseShareGrish(String(half));
  };

  const handleAmountChange = (val: string) => {
    setAmount(val);
    const num = parseFloat(val) || 0;
    if (sharedExpense) {
      applyEvenExpenseSplit(num);
    } else if (paidByMode !== "split") {
      applySplitAmounts(num, paidByMode);
    } else if (paidByMode === "split") {
      applySplitAmounts(num, "split", kushShare === "" && grishShare === "");
    }
  };

  const handlePaidByChange = (mode: PaidByMode) => {
    setPaidByMode(mode);
    setSplitPayments({});
    if (parsedAmount <= 0) return;
    if (mode === "split") {
      applySplitAmounts(parsedAmount, "split", true);
    } else if (!sharedExpense) {
      applySplitAmounts(parsedAmount, mode);
    }
  };

  const handleExpenseShareKushChange = (val: string) => {
    setExpenseShareKush(val);
  };

  const handleExpenseShareGrishChange = (val: string) => {
    setExpenseShareGrish(val);
  };

  const handleKushShareChange = (val: string) => {
    setKushShare(val);
    setSplitPayments({});
  };

  const handleGrishShareChange = (val: string) => {
    setGrishShare(val);
    setSplitPayments({});
  };

  const applyEvenSplit = () => {
    if (parsedAmount <= 0) return;
    applySplitAmounts(parsedAmount, "split", true);
    setSplitPayments({});
  };

  const applyEvenExpenseSplitAction = () => {
    if (parsedAmount <= 0) return;
    applyEvenExpenseSplit(parsedAmount);
  };

  const isCategoryValid =
    selection?.type === "expense" ||
    selection?.type === "debt" ||
    (selection?.type === "custom" && customName.trim().length > 0);

  const kushAmount = parseFloat(kushShare) || 0;
  const grishAmount = parseFloat(grishShare) || 0;
  const expenseShareKushAmt = parseFloat(expenseShareKush) || 0;
  const expenseShareGrishAmt = parseFloat(expenseShareGrish) || 0;

  const paymentSharesValid =
    paidByMode !== "split" ||
    (kushAmount + grishAmount > 0 &&
      Math.abs(kushAmount + grishAmount - parsedAmount) < 0.01);

  const expenseSharesValid =
    !sharedExpense ||
    (expenseShareKushAmt + expenseShareGrishAmt > 0 &&
      Math.abs(expenseShareKushAmt + expenseShareGrishAmt - parsedAmount) < 0.01);

  const sharesValid = paymentSharesValid && expenseSharesValid;

  const splitRemaining = parsedAmount - kushAmount - grishAmount;
  const expenseSplitRemaining = parsedAmount - expenseShareKushAmt - expenseShareGrishAmt;

  const categoryProgress = useMemo(() => {
    if (selection?.type === "expense" && selection.item.amount != null && !selection.item.isVariable) {
      const expense = selection.item;
      const spent = getMonthlyExpensePaid(transactions, expense);
      const planned = expense.amount!;
      const remaining = Math.max(0, planned - spent - parsedAmount);
      return {
        label: expense.name,
        planned,
        spent,
        thisPayment: parsedAmount,
        remaining,
        isDebt: false,
      };
    }
    if (selection?.type === "debt") {
      const debt = selection.item;
      const remaining = Math.max(0, debt.amount - parsedAmount);
      return {
        label: debt.name,
        planned: debt.amount,
        spent: 0,
        thisPayment: parsedAmount,
        remaining,
        isDebt: true,
      };
    }
    return null;
  }, [selection, transactions, parsedAmount]);

  const spendMeta = useMemo(() => {
    if (selection?.type === "expense" && selection.item.amount != null) {
      return {
        monthlyExpenseId: selection.item.id,
        plannedAmount: selection.item.amount,
        expenseOwner: selection.item.person as Person,
      };
    }
    if (sharedExpense) {
      return { expenseOwner: undefined as Person | undefined };
    }
    return { expenseOwner: expenseOwner === "both" ? undefined : expenseOwner };
  }, [selection, expenseOwner, sharedExpense]);

  const handleDetailsNext = () => {
    if (!isCategoryValid || parsedAmount <= 0 || !sharesValid) return;
    if (selection?.type === "custom") {
      setSelection({ type: "custom", name: customName.trim(), owner: customOwner });
    }
    setSplitPayments({});
    setStep("payment");
  };

  const getPersonAccounts = (person: Person) => accounts.filter((a) => a.person === person);
  const getDebitAccounts = (person: Person) => getPersonAccounts(person).filter((a) => a.type === "debit");
  const getCashAccount = (person: Person) => getPersonAccounts(person).find((a) => a.type === "cash");

  const activePayers = useMemo((): Person[] => {
    if (paidByMode === "kushvanth") return ["kushvanth"];
    if (paidByMode === "grishma") return ["grishma"];
    const list: Person[] = [];
    if (kushAmount > 0) list.push("kushvanth");
    if (grishAmount > 0) list.push("grishma");
    return list;
  }, [paidByMode, kushAmount, grishAmount]);

  const getShareForPerson = (person: Person) =>
    person === "kushvanth" ? kushAmount : grishAmount;

  const handleSelectAccount = (account: Account, forPerson: Person) => {
    const share = getShareForPerson(forPerson);

    if (paidByMode === "split") {
      if (account.type === "cash") {
        setPendingCashFor(forPerson);
        setSelectedAccount(account);
        setStep("cash-source");
      } else {
        setSplitPayments((prev) => ({
          ...prev,
          [forPerson]: { person: forPerson, amount: share, accountId: account.id },
        }));
      }
    } else {
      setSelectedAccount(account);
      if (account.type === "cash") {
        setPendingCashFor(forPerson);
        setStep("cash-source");
      } else {
        confirmTransaction(forPerson, account.id);
      }
    }
  };

  const handleCashSource = (sourceId: string | null) => {
    const forPerson = pendingCashFor!;
    const cashAccount = getCashAccount(forPerson);
    if (!cashAccount) return;

    if (paidByMode === "split") {
      setSplitPayments((prev) => ({
        ...prev,
        [forPerson]: {
          person: forPerson,
          amount: getShareForPerson(forPerson),
          accountId: cashAccount.id,
          cashSourceAccountId: sourceId ?? undefined,
        },
      }));
      setStep("payment");
      setSelectedAccount(null);
      setPendingCashFor(null);
    } else {
      confirmTransaction(forPerson, cashAccount.id, sourceId ?? undefined);
    }
  };

  const confirmSplit = () => {
    const label = categoryLabel || customName.trim();
    const payments = (["kushvanth", "grishma"] as Person[])
      .map((p) => splitPayments[p])
      .filter((p): p is PaymentSelection => !!p && p.amount > 0);

    if (payments.length === 0) return;

    if (payingDebt && selection?.type === "debt") {
      const debt = selection.item;
      for (const payment of payments) {
        if (payment.person !== debt.person) {
          payDebtForOther({
            paidBy: payment.person,
            debtId: debt.id,
            amount: payment.amount,
            fromAccountId: payment.accountId,
            cashSourceAccountId: payment.cashSourceAccountId,
          });
        } else {
          payDebt(debt.id, payment.amount, payment.accountId);
        }
      }
    } else {
      spendSplit({
        category: label,
        expenseOwner: sharedExpense ? undefined : (expenseOwner as Person),
        expenseShares: getExpenseShares(),
        notes: notes || undefined,
        payments,
        monthlyExpenseId: spendMeta.monthlyExpenseId,
        plannedAmount: spendMeta.plannedAmount ?? undefined,
      });
    }
    setStep("done");
  };

  const getExpenseShares = () => {
    if (!sharedExpense) return undefined;
    return {
      kushvanth: expenseShareKushAmt,
      grishma: expenseShareGrishAmt,
    };
  };

  const betweenUsPreview = useMemo(() => {
    if (parsedAmount <= 0) return null;

    if (sharedExpense && expenseSharesValid) {
      const shares = {
        kushvanth: expenseShareKushAmt,
        grishma: expenseShareGrishAmt,
      };
      if (paidByMode === "split") return null;
      return getInterCoupleUpdatesFromShares(paidByMode, shares).map(({ benefited, amount }) =>
        describeInterCoupleFromSpend(paidByMode, benefited, amount)
      );
    }

    if (
      !sharedExpense &&
      expenseOwner !== "both" &&
      paidByMode !== "split" &&
      paidByMode !== expenseOwner
    ) {
      return [describeInterCoupleFromSpend(paidByMode, expenseOwner as Person, parsedAmount)];
    }

    return null;
  }, [
    parsedAmount,
    sharedExpense,
    expenseSharesValid,
    expenseShareKushAmt,
    expenseShareGrishAmt,
    paidByMode,
    expenseOwner,
  ]);

  const expenseOwnerLabel =
    expenseOwner === "both"
      ? "Both of us"
      : PERSON_LABELS[expenseOwner as Person];

  const confirmTransaction = (
    payer: Person,
    accountId: string,
    cashSourceAccountId?: string
  ) => {
    const label = categoryLabel || customName.trim();

    if (payingDebt && selection?.type === "debt") {
      const debt = selection.item;
      if (payer !== debt.person) {
        payDebtForOther({
          paidBy: payer,
          debtId: debt.id,
          amount: parsedAmount,
          fromAccountId: accountId,
          cashSourceAccountId,
        });
      } else {
        payDebt(debt.id, parsedAmount, accountId);
      }
    } else {
      spend({
        person: payer,
        amount: parsedAmount,
        accountId,
        cashSourceAccountId,
        category: label,
        notes: notes || undefined,
        beneficiaryPerson:
          sharedExpense
            ? undefined
            : payer !== expenseOwner && expenseOwner !== "both"
              ? (expenseOwner as Person)
              : undefined,
        expenseShares: getExpenseShares(),
        monthlyExpenseId: spendMeta.monthlyExpenseId,
        plannedAmount: spendMeta.plannedAmount ?? undefined,
        expenseOwner: spendMeta.expenseOwner,
      });
    }
    setStep("done");
  };

  const splitReady =
    paidByMode === "split" &&
    sharesValid &&
    activePayers.every((p) => {
      const share = getShareForPerson(p);
      return share <= 0 || !!splitPayments[p];
    });

  const singlePayer = paidByMode !== "split" ? paidByMode : null;

  const renderAccountPicker = (person: Person) => {
    const share = getShareForPerson(person);
    const personAccounts = getPersonAccounts(person);
    const done = paidByMode === "split" && !!splitPayments[person];

    return (
      <div key={person} className="space-y-1.5">
        <p className="text-xs font-medium px-1 flex items-center justify-between">
          {PERSON_LABELS[person]} · {formatCurrency(paidByMode === "split" ? share : parsedAmount)}
          {done && <span className="text-[#34c759] text-[10px]">✓</span>}
        </p>
        {(!done || paidByMode !== "split") && (
          <>
            {personAccounts.filter((a) => a.type === "credit").map((a) => (
              <GlassCard
                key={a.id}
                onClick={() => handleSelectAccount(a, person)}
                className="flex justify-between py-2 px-3 cursor-pointer"
              >
                <span className="text-sm font-medium">
                  <CreditCard className="w-3.5 h-3.5 inline mr-1.5" />
                  {a.name}
                </span>
                <span className="text-[11px] text-muted">
                  {formatCurrency((a.creditLimit ?? 0) - a.balance)} left
                </span>
              </GlassCard>
            ))}
            {personAccounts.filter((a) => a.type === "debit").map((a) => (
              <GlassCard
                key={a.id}
                onClick={() => handleSelectAccount(a, person)}
                className="flex justify-between py-2 px-3 cursor-pointer"
              >
                <span className="text-sm font-medium">
                  <Wallet className="w-3.5 h-3.5 inline mr-1.5" />
                  {a.name}
                </span>
                <span className="text-[11px] text-muted">{formatCurrency(a.balance)}</span>
              </GlassCard>
            ))}
            {getCashAccount(person) && (
              <GlassCard
                onClick={() => handleSelectAccount(getCashAccount(person)!, person)}
                className="flex justify-between py-2 px-3 cursor-pointer"
              >
                <span className="text-sm font-medium">
                  <Banknote className="w-3.5 h-3.5 inline mr-1.5" />
                  Cash
                </span>
                <span className="text-[11px] text-muted">
                  {formatCurrency(getCashAccount(person)!.balance)}
                </span>
              </GlassCard>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-fade-in-up max-w-lg mx-auto pb-2">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Spend</h2>
        <p className="text-muted text-sm mt-0.5">Record a payment</p>
      </div>

      {step === "details" && (
        <GlassCard strong className="space-y-3 p-4">
          <div className="flex items-center justify-center gap-1 py-1">
            <span className="text-2xl font-light text-muted">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0"
              className="text-4xl font-bold bg-transparent outline-none w-36 text-center"
              autoFocus
            />
          </div>

          {categoryProgress && parsedAmount > 0 && (
            <div className="rounded-xl bg-[#007aff]/5 border border-[#007aff]/20 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold truncate">{categoryProgress.label}</span>
                <span className="text-[#34c759] font-semibold shrink-0">
                  {formatCurrency(categoryProgress.remaining)} left
                </span>
              </div>
              {!categoryProgress.isDebt && (
                <div className="mt-1.5 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#007aff] rounded-full"
                    style={{
                      width: `${Math.min(
                        100,
                        ((categoryProgress.spent + categoryProgress.thisPayment) /
                          categoryProgress.planned) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {selectionSummary && (
              <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/10 px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{selectionSummary}</p>
                  {selectionMeta && <p className="text-[11px] text-muted truncate">{selectionMeta}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelection(null);
                    setCustomName("");
                  }}
                  className="text-[11px] text-[#007aff] font-medium shrink-0"
                >
                  Change
                </button>
              </div>
            )}

            <PersonTabs value={categoryPerson} onChange={handleCategoryPersonChange} />

            <div className="glass rounded-xl p-0.5 flex gap-0.5">
              {(
                [
                  { id: "bills" as CategoryMode, label: "Bills" },
                  { id: "debts" as CategoryMode, label: "Debt" },
                  { id: "custom" as CategoryMode, label: "Custom" },
                ]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleCategoryModeChange(id)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs font-medium transition-all",
                    categoryMode === id ? "bg-[#007aff] text-white" : "text-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {categoryMode === "bills" && (
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                {(categoryPerson === "kushvanth"
                  ? expenseCategories.kush
                  : expenseCategories.grish
                ).map((expense) => (
                  <CategoryButton
                    key={expense.id}
                    label={expense.name}
                    sub={expenseSubLine(expense, transactions)}
                    tag="Bill"
                    selected={selection?.type === "expense" && selection.item.id === expense.id}
                    onClick={() => selectExpense(expense)}
                  />
                ))}
              </div>
            )}

            {categoryMode === "debts" && (
              <>
                {(categoryPerson === "kushvanth" ? debtCategories.kush : debtCategories.grish)
                  .length === 0 ? (
                  <p className="text-xs text-muted px-1 py-2 text-center">No debts listed.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                    {(categoryPerson === "kushvanth"
                      ? debtCategories.kush
                      : debtCategories.grish
                    ).map((debt) => (
                      <CategoryButton
                        key={debt.id}
                        label={debt.name}
                        sub={`${formatCurrency(debt.amount)} owed`}
                        tag="Debt"
                        selected={selection?.type === "debt" && selection.item.id === debt.id}
                        onClick={() => selectDebt(debt)}
                        variant="debt"
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {categoryMode === "custom" && (
              <div className="space-y-2 rounded-xl border border-[#007aff]/20 bg-[#007aff]/5 p-3">
                <input
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    setSelection({ type: "custom", name: e.target.value, owner: customOwner });
                  }}
                  placeholder="What was it? e.g. Groceries"
                  className="w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
                />

                <div>
                  <p className="text-[11px] text-muted px-1 mb-1">Who is this for?</p>
                  <div className="glass rounded-xl p-0.5 flex gap-0.5">
                    {(
                      [
                        { id: "kushvanth" as ExpenseOwner, label: PERSON_LABELS.kushvanth },
                        { id: "grishma" as ExpenseOwner, label: PERSON_LABELS.grishma },
                        { id: "both" as ExpenseOwner, label: "Both" },
                      ]
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setCustomOwner(id);
                          setSelection({ type: "custom", name: customName, owner: id });
                          if (id === "both" && parsedAmount > 0) {
                            applyEvenExpenseSplit(parsedAmount);
                          } else if (id !== "both") {
                            setExpenseShareKush("");
                            setExpenseShareGrish("");
                          }
                        }}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                          customOwner === id ? "bg-[#007aff] text-white" : "text-muted"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {sharedExpense && (
                  <CompactSplitInputs
                    kushLabel={`${PERSON_LABELS.kushvanth}'s part`}
                    grishLabel={`${PERSON_LABELS.grishma}'s part`}
                    kushValue={expenseShareKush}
                    grishValue={expenseShareGrish}
                    onKushChange={handleExpenseShareKushChange}
                    onGrishChange={handleExpenseShareGrishChange}
                    total={parsedAmount}
                    kushAmt={expenseShareKushAmt}
                    grishAmt={expenseShareGrishAmt}
                    valid={expenseSharesValid}
                    remaining={expenseSplitRemaining}
                    onEvenSplit={applyEvenExpenseSplitAction}
                  />
                )}
              </div>
            )}
          </div>

          {betweenUsPreview && betweenUsPreview.length > 0 && (
            <div className="rounded-xl bg-[#af52de]/5 border border-[#af52de]/20 px-3 py-2">
              <p className="text-[10px] font-semibold text-[#af52de] mb-0.5">Between Us</p>
              {betweenUsPreview.map((line) => (
                <p key={line} className="text-xs leading-snug">
                  {line}
                </p>
              ))}
            </div>
          )}

          <div>
            <p className="text-[11px] text-muted px-1 mb-1">Who paid?</p>
            <div className="glass rounded-xl p-0.5 flex gap-0.5">
              {(
                [
                  { id: "kushvanth" as PaidByMode, label: PERSON_LABELS.kushvanth },
                  { id: "grishma" as PaidByMode, label: PERSON_LABELS.grishma },
                  { id: "split" as PaidByMode, label: "Both paid" },
                ]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handlePaidByChange(id)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                    paidByMode === id ? "bg-[#007aff] text-white" : "text-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {paidByMode === "split" && (
              <div className="mt-2">
                <CompactSplitInputs
                  kushLabel={`${PERSON_LABELS.kushvanth} paid`}
                  grishLabel={`${PERSON_LABELS.grishma} paid`}
                  kushValue={kushShare}
                  grishValue={grishShare}
                  onKushChange={handleKushShareChange}
                  onGrishChange={handleGrishShareChange}
                  total={parsedAmount}
                  kushAmt={kushAmount}
                  grishAmt={grishAmount}
                  valid={paymentSharesValid}
                  remaining={splitRemaining}
                  onEvenSplit={applyEvenSplit}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-[#007aff] font-medium px-1"
          >
            <ChevronDown className={cn("w-3 h-3 transition-transform", showNotes && "rotate-180")} />
            {showNotes ? "Hide note" : "Add note (optional)"}
          </button>
          {showNotes && (
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note..."
              className="w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
          )}

          <GlassButton
            size="lg"
            className="w-full"
            disabled={!isCategoryValid || parsedAmount <= 0 || !sharesValid}
            onClick={handleDetailsNext}
          >
            Continue <ArrowRight className="w-4 h-4" />
          </GlassButton>
        </GlassCard>
      )}

      {step === "payment" && (
        <div className="space-y-3">
          <GlassCard className="text-center py-2 px-3">
            <p className="text-xs text-muted truncate">{categoryLabel}</p>
            <p className="text-2xl font-bold">{formatCurrency(parsedAmount)}</p>
            <p className="text-[11px] text-muted mt-0.5">
              {paidByMode === "split"
                ? `Both paid · ${expenseOwnerLabel}`
                : `${PERSON_LABELS[paidByMode]} paid · ${expenseOwnerLabel}`}
            </p>
          </GlassCard>

          {paidByMode === "split"
            ? activePayers.map((p) => renderAccountPicker(p))
            : renderAccountPicker(singlePayer!)}

          {splitReady && (
            <GlassButton size="lg" className="w-full" onClick={confirmSplit}>
              Confirm Payment
            </GlassButton>
          )}

          <GlassButton variant="ghost" className="w-full" onClick={() => setStep("details")}>
            Back
          </GlassButton>
        </div>
      )}

      {step === "cash-source" && pendingCashFor && (
        <div className="space-y-2">
          <GlassCard className="text-center py-3 px-3">
            <p className="text-sm font-semibold">Cash from which account?</p>
            <p className="text-xs text-muted">{PERSON_LABELS[pendingCashFor]}</p>
          </GlassCard>

          {getDebitAccounts(pendingCashFor).map((account) => (
            <GlassCard
              key={account.id}
              onClick={() => handleCashSource(account.id)}
              className="flex justify-between py-2.5 px-3 cursor-pointer"
            >
              <span className="text-sm font-medium">{account.name}</span>
              <span className="text-xs text-muted">{formatCurrency(account.balance)}</span>
            </GlassCard>
          ))}

          <GlassCard
            onClick={() => handleCashSource(null)}
            className="flex justify-between py-2.5 px-3 cursor-pointer"
          >
            <span className="text-sm font-medium">Existing Cash Wallet</span>
          </GlassCard>

          <GlassButton variant="ghost" className="w-full" onClick={() => setStep("payment")}>
            Back
          </GlassButton>
        </div>
      )}

      {step === "done" && (
        <GlassCard strong className="text-center space-y-3 py-6 px-4">
          <div className="w-12 h-12 rounded-full bg-[#34c759]/20 flex items-center justify-center mx-auto">
            <span className="text-2xl">✓</span>
          </div>
          <h3 className="text-lg font-semibold">Payment Recorded</h3>
          <p className="text-sm text-muted">
            {formatCurrency(parsedAmount)} · {categoryLabel}
          </p>
          {categoryProgress && (
            <p className="text-xs">
              {categoryProgress.isDebt ? "Still to pay" : "Left this month"}:{" "}
              <span className="font-semibold text-[#34c759]">
                {formatCurrency(categoryProgress.remaining)}
              </span>
            </p>
          )}
          <GlassButton size="lg" className="w-full" onClick={reset}>
            New Payment
          </GlassButton>
        </GlassCard>
      )}
    </div>
  );
}

function CompactSplitInputs({
  kushLabel,
  grishLabel,
  kushValue,
  grishValue,
  onKushChange,
  onGrishChange,
  total,
  kushAmt,
  grishAmt,
  valid,
  remaining,
  onEvenSplit,
}: {
  kushLabel: string;
  grishLabel: string;
  kushValue: string;
  grishValue: string;
  onKushChange: (val: string) => void;
  onGrishChange: (val: string) => void;
  total: number;
  kushAmt: number;
  grishAmt: number;
  valid: boolean;
  remaining: number;
  onEvenSplit: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-muted px-0.5 truncate">{kushLabel}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={kushValue}
            onChange={(e) => onKushChange(e.target.value)}
            placeholder="0"
            className="glass rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-muted px-0.5 truncate">{grishLabel}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={grishValue}
            onChange={(e) => onGrishChange(e.target.value)}
            placeholder="0"
            className="glass rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
          />
        </label>
      </div>
      {total > 0 && (
        <>
          <div className="flex items-center justify-between px-0.5 text-[10px]">
            <span className="text-muted">
              {formatCurrency(kushAmt + grishAmt)} / {formatCurrency(total)}
            </span>
            {!valid ? (
              <span className="text-[#ff3b30] font-medium">
                {remaining > 0
                  ? `${formatCurrency(remaining)} left`
                  : `${formatCurrency(Math.abs(remaining))} over`}
              </span>
            ) : (
              <span className="text-[#34c759] font-medium">✓</span>
            )}
          </div>
          <button
            type="button"
            onClick={onEvenSplit}
            className="text-[10px] text-[#007aff] font-medium px-0.5"
          >
            50 / 50 ({formatCurrency(total / 2)} each)
          </button>
        </>
      )}
    </div>
  );
}

function CategoryButton({
  label,
  sub,
  tag,
  selected,
  onClick,
  variant = "expense",
}: {
  label: string;
  sub: string;
  tag?: string;
  selected: boolean;
  onClick: () => void;
  variant?: "expense" | "debt";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-2 py-2 text-left text-xs transition-all border min-h-[52px] flex flex-col justify-between",
        selected
          ? "ring-2 ring-[#007aff] bg-[#007aff]/10 border-[#007aff]/40 shadow-sm"
          : "glass border-transparent hover:border-white/20 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]",
        variant === "debt" && !selected && "border-[#ff3b30]/10"
      )}
    >
      <div className="flex items-start justify-between gap-1 w-full">
        <p className="font-medium leading-tight line-clamp-2 text-[11px]">{label}</p>
        {tag ? (
          <span
            className={cn(
              "text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md shrink-0",
              variant === "debt"
                ? "bg-[#ff3b30]/15 text-[#ff3b30]"
                : "bg-black/5 dark:bg-white/10 text-muted"
            )}
          >
            {tag}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "text-[10px] mt-1",
          variant === "debt" ? "text-[#ff9500] font-medium" : "text-muted"
        )}
      >
        {sub}
      </p>
    </button>
  );
}
