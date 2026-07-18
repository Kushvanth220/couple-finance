"use client";

import { useState, useMemo } from "react";
import {
  ArrowRight,
  Banknote,
  CreditCard,
  Wallet,
} from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
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
  };

  const selectExpense = (expense: MonthlyExpense) => {
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
    setSelection({ type: "debt", item: debt });
    setCustomName("");
    if (!amount.trim()) {
      setAmount(String(debt.amount));
      if (paidByMode !== "split") {
        applySplitAmounts(debt.amount, paidByMode);
      }
    }
  };

  const selectCustom = () => {
    setSelection({ type: "custom", name: customName, owner: customOwner });
  };

  const applyEvenExpenseSplit = (total: number) => {
    const half = total / 2;
    setExpenseShareKush(String(half));
    setExpenseShareGrish(String(half));
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
      ? "Both"
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
      <div key={person} className="space-y-2">
        <p className="text-sm font-medium px-1 flex items-center justify-between">
          {PERSON_LABELS[person]} — {formatCurrency(paidByMode === "split" ? share : parsedAmount)}
          {done && <span className="text-[#34c759] text-xs">✓ Selected</span>}
        </p>
        {(!done || paidByMode !== "split") && (
          <>
            {personAccounts.filter((a) => a.type === "credit").map((a) => (
              <GlassCard
                key={a.id}
                onClick={() => handleSelectAccount(a, person)}
                className="flex justify-between py-3 cursor-pointer"
              >
                <span className="font-medium">
                  <CreditCard className="w-4 h-4 inline mr-2" />
                  {a.name}
                </span>
                <span className="text-sm text-muted">
                  {formatCurrency((a.creditLimit ?? 0) - a.balance)} left
                </span>
              </GlassCard>
            ))}
            {personAccounts.filter((a) => a.type === "debit").map((a) => (
              <GlassCard
                key={a.id}
                onClick={() => handleSelectAccount(a, person)}
                className="flex justify-between py-3 cursor-pointer"
              >
                <span className="font-medium">
                  <Wallet className="w-4 h-4 inline mr-2" />
                  {a.name}
                </span>
                <span className="text-sm text-muted">{formatCurrency(a.balance)}</span>
              </GlassCard>
            ))}
            {getCashAccount(person) && (
              <GlassCard
                onClick={() => handleSelectAccount(getCashAccount(person)!, person)}
                className="flex justify-between py-3 cursor-pointer"
              >
                <span className="font-medium">
                  <Banknote className="w-4 h-4 inline mr-2" />
                  Cash Wallet
                </span>
                <span className="text-sm text-muted">
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
    <div className="space-y-6 animate-fade-in-up max-w-lg mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Spend</h2>
        <p className="text-muted mt-1">Pay expenses, bills & debts</p>
      </div>

      {step === "details" && (
        <GlassCard strong className="space-y-5">
          {/* Amount */}
          <div className="text-center py-2">
            <label className="text-sm text-muted">Amount</label>
            <div className="flex items-center justify-center gap-1 mt-2">
              <span className="text-4xl font-light text-muted">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0"
                className="text-5xl font-bold bg-transparent outline-none w-48 text-center"
                autoFocus
              />
            </div>
          </div>

          {categoryProgress && parsedAmount > 0 && (
            <GlassCard className="bg-[#007aff]/5 border border-[#007aff]/20 space-y-2 py-4">
              <p className="text-sm font-semibold">{categoryProgress.label}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted">{categoryProgress.isDebt ? "Total to pay" : "Monthly budget"}</span>
                  <p className="font-semibold">{formatCurrency(categoryProgress.planned)}</p>
                </div>
                {!categoryProgress.isDebt && (
                  <div>
                    <span className="text-muted">Already paid this month</span>
                    <p className="font-semibold">{formatCurrency(categoryProgress.spent)}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted">This payment</span>
                  <p className="font-semibold text-[#ff3b30]">{formatCurrency(categoryProgress.thisPayment)}</p>
                </div>
                <div>
                  <span className="text-muted">{categoryProgress.isDebt ? "Remaining after" : "Left this month"}</span>
                  <p className="font-semibold text-[#34c759]">{formatCurrency(categoryProgress.remaining)}</p>
                </div>
              </div>
              {!categoryProgress.isDebt && (
                <div className="mt-2 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#007aff] rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, ((categoryProgress.spent + categoryProgress.thisPayment) / categoryProgress.planned) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </GlassCard>
          )}

          {/* Category picker — expenses + debts unified */}
          <div>
            <label className="text-sm font-medium text-muted px-1 mb-2 block">
              What is this for?
            </label>

            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 mt-3 mb-1.5">
              Kushvanth — Expenses
            </p>
            <div className="grid grid-cols-2 gap-2">
              {expenseCategories.kush.map((expense) => (
                <CategoryButton
                  key={expense.id}
                  label={expense.name}
                  sub={expenseSubLine(expense, transactions)}
                  selected={selection?.type === "expense" && selection.item.id === expense.id}
                  onClick={() => selectExpense(expense)}
                />
              ))}
            </div>

            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 mt-3 mb-1.5">
              Grishma — Expenses
            </p>
            <div className="grid grid-cols-2 gap-2">
              {expenseCategories.grish.map((expense) => (
                <CategoryButton
                  key={expense.id}
                  label={expense.name}
                  sub={expenseSubLine(expense, transactions)}
                  selected={selection?.type === "expense" && selection.item.id === expense.id}
                  onClick={() => selectExpense(expense)}
                />
              ))}
            </div>

            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 mt-3 mb-1.5">
              Kushvanth — Debts
            </p>
            <div className="grid grid-cols-2 gap-2">
              {debtCategories.kush.map((debt) => (
                <CategoryButton
                  key={debt.id}
                  label={debt.name}
                  sub={formatCurrency(debt.amount)}
                  selected={selection?.type === "debt" && selection.item.id === debt.id}
                  onClick={() => selectDebt(debt)}
                  variant="debt"
                />
              ))}
            </div>

            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 mt-3 mb-1.5">
              Grishma — Debts
            </p>
            <div className="grid grid-cols-2 gap-2">
              {debtCategories.grish.map((debt) => (
                <CategoryButton
                  key={debt.id}
                  label={debt.name}
                  sub={formatCurrency(debt.amount)}
                  selected={selection?.type === "debt" && selection.item.id === debt.id}
                  onClick={() => selectDebt(debt)}
                  variant="debt"
                />
              ))}
            </div>

            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 mt-3 mb-1.5">
              Other
            </p>
            <button
              type="button"
              onClick={() => {
                setSelection({ type: "custom", name: customName, owner: customOwner });
              }}
              className={cn(
                "w-full glass rounded-xl px-3 py-2.5 text-left text-sm mb-2 transition-all",
                selection?.type === "custom" && "ring-2 ring-[#007aff]"
              )}
            >
              <p className="font-medium">Custom</p>
              <p className="text-[10px] text-muted">Anything else</p>
            </button>
            {selection?.type === "custom" && (
              <>
                <GlassInput
                  label="Description"
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    setSelection({ type: "custom", name: e.target.value, owner: customOwner });
                  }}
                  placeholder="e.g. Groceries, Gift"
                />
                <div className="mt-2">
                  <label className="text-sm font-medium text-muted px-1 mb-2 block">Whose expense?</label>
                  <div className="glass rounded-2xl p-1 flex gap-1">
                    {(["kushvanth", "grishma", "both"] as ExpenseOwner[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setCustomOwner(p);
                          setSelection({ type: "custom", name: customName, owner: p });
                          if (p === "both" && parsedAmount > 0) {
                            applyEvenExpenseSplit(parsedAmount);
                          } else if (p !== "both") {
                            setExpenseShareKush("");
                            setExpenseShareGrish("");
                          }
                        }}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-sm font-medium transition-all",
                          customOwner === p ? "bg-[#007aff] text-white" : "text-muted"
                        )}
                      >
                        {p === "both" ? "Both" : PERSON_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                {sharedExpense && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-muted px-1">
                      Split the expense between you — Between Us updates automatically.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <GlassInput
                        label={`${PERSON_LABELS.kushvanth}'s share`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenseShareKush}
                        onChange={(e) => handleExpenseShareKushChange(e.target.value)}
                        placeholder="0.00"
                      />
                      <GlassInput
                        label={`${PERSON_LABELS.grishma}'s share`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenseShareGrish}
                        onChange={(e) => handleExpenseShareGrishChange(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    {parsedAmount > 0 && (
                      <>
                        <div className="flex items-center justify-between px-1 text-xs">
                          <span className="text-muted">
                            Total: {formatCurrency(expenseShareKushAmt + expenseShareGrishAmt)} /{" "}
                            {formatCurrency(parsedAmount)}
                          </span>
                          {!expenseSharesValid && (
                            <span className="text-[#ff3b30] font-medium">
                              {expenseSplitRemaining > 0
                                ? `${formatCurrency(expenseSplitRemaining)} remaining`
                                : `${formatCurrency(Math.abs(expenseSplitRemaining))} over`}
                            </span>
                          )}
                          {expenseSharesValid && expenseShareKushAmt + expenseShareGrishAmt > 0 && (
                            <span className="text-[#34c759] font-medium">✓ Balanced</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={applyEvenExpenseSplitAction}
                          className="text-xs text-[#007aff] font-medium px-1 hover:underline"
                        >
                          Reset to 50 / 50 ({formatCurrency(parsedAmount / 2)} each)
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {betweenUsPreview && betweenUsPreview.length > 0 && (
            <GlassCard className="bg-[#af52de]/5 border border-[#af52de]/20 py-3 px-4">
              <p className="text-xs font-semibold text-[#af52de] mb-1">Between Us preview</p>
              {betweenUsPreview.map((line) => (
                <p key={line} className="text-sm">
                  {line}
                </p>
              ))}
            </GlassCard>
          )}

          {/* Paid by */}
          <div>
            <label className="text-sm font-medium text-muted px-1 mb-2 block">Paid by</label>
            <div className="glass rounded-2xl p-1 flex gap-1">
              {(
                [
                  { id: "kushvanth" as PaidByMode, label: PERSON_LABELS.kushvanth },
                  { id: "grishma" as PaidByMode, label: PERSON_LABELS.grishma },
                  { id: "split" as PaidByMode, label: "Split Amount" },
                ]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handlePaidByChange(id)}
                  className={cn(
                    "flex-1 py-2.5 px-2 rounded-xl text-sm font-medium transition-all",
                    paidByMode === id ? "bg-[#007aff] text-white shadow-md" : "text-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {paidByMode === "split" && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <GlassInput
                    label={`${PERSON_LABELS.kushvanth}'s share`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={kushShare}
                    onChange={(e) => handleKushShareChange(e.target.value)}
                    placeholder="0.00"
                  />
                  <GlassInput
                    label={`${PERSON_LABELS.grishma}'s share`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={grishShare}
                    onChange={(e) => handleGrishShareChange(e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                {parsedAmount > 0 && (
                  <div className="flex items-center justify-between px-1 text-xs">
                    <span className="text-muted">
                      Total: {formatCurrency(kushAmount + grishAmount)} / {formatCurrency(parsedAmount)}
                    </span>
                    {!paymentSharesValid && (
                      <span className="text-[#ff3b30] font-medium">
                        {splitRemaining > 0
                          ? `${formatCurrency(splitRemaining)} remaining`
                          : `${formatCurrency(Math.abs(splitRemaining))} over`}
                      </span>
                    )}
                    {paymentSharesValid && kushAmount + grishAmount > 0 && (
                      <span className="text-[#34c759] font-medium">✓ Balanced</span>
                    )}
                  </div>
                )}

                {parsedAmount > 0 && (
                  <button
                    type="button"
                    onClick={applyEvenSplit}
                    className="text-xs text-[#007aff] font-medium px-1 hover:underline"
                  >
                    Reset to 50 / 50 ({formatCurrency(parsedAmount / 2)} each)
                  </button>
                )}
              </div>
            )}
          </div>

          <GlassInput
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note..."
          />

          <GlassButton
            size="lg"
            className="w-full"
            disabled={!isCategoryValid || parsedAmount <= 0 || !sharesValid}
            onClick={handleDetailsNext}
          >
            Continue <ArrowRight className="w-5 h-5" />
          </GlassButton>
        </GlassCard>
      )}

      {step === "payment" && (
        <div className="space-y-4">
          <GlassCard className="text-center py-3">
            <p className="text-sm text-muted">{categoryLabel}</p>
            <p className="text-3xl font-bold">{formatCurrency(parsedAmount)}</p>
            <p className="text-xs text-muted mt-1">
              {paidByMode === "split"
                ? `Split · ${expenseOwnerLabel}'s ${payingDebt ? "debt" : "expense"}`
                : `${PERSON_LABELS[paidByMode]} paying · ${expenseOwnerLabel}'s ${payingDebt ? "debt" : "expense"}`}
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
        <div className="space-y-4">
          <GlassCard className="text-center py-4">
            <p className="text-lg font-semibold">Where did this cash come from?</p>
            <p className="text-sm text-muted mt-1">{PERSON_LABELS[pendingCashFor]}</p>
          </GlassCard>

          {getDebitAccounts(pendingCashFor).map((account) => (
            <GlassCard
              key={account.id}
              onClick={() => handleCashSource(account.id)}
              className="flex justify-between py-4 cursor-pointer"
            >
              <span className="font-medium">{account.name}</span>
              <span className="text-sm text-muted">{formatCurrency(account.balance)}</span>
            </GlassCard>
          ))}

          <GlassCard
            onClick={() => handleCashSource(null)}
            className="flex justify-between py-4 cursor-pointer"
          >
            <span className="font-medium">Existing Cash Wallet</span>
          </GlassCard>

          <GlassButton variant="ghost" className="w-full" onClick={() => setStep("payment")}>
            Back
          </GlassButton>
        </div>
      )}

      {step === "done" && (
        <GlassCard strong className="text-center space-y-4 py-8">
          <div className="w-16 h-16 rounded-full bg-[#34c759]/20 flex items-center justify-center mx-auto">
            <span className="text-3xl">✓</span>
          </div>
          <h3 className="text-xl font-semibold">Payment Recorded</h3>
          <p className="text-muted">
            {formatCurrency(parsedAmount)} · {categoryLabel}
          </p>
          {categoryProgress && (
            <p className="text-sm">
              {categoryProgress.isDebt ? "Still to pay" : "Remaining this month"}:{" "}
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

function CategoryButton({
  label,
  sub,
  selected,
  onClick,
  variant = "expense",
}: {
  label: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
  variant?: "expense" | "debt";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-3 py-2.5 text-left text-sm transition-all border",
        selected
          ? "ring-2 ring-[#007aff] bg-[#007aff]/10 border-[#007aff]/30"
          : "glass border-transparent hover:border-white/20",
        variant === "debt" && !selected && "border-[#ff3b30]/10"
      )}
    >
      <p className="font-medium truncate">{label}</p>
      <p className={cn("text-[10px]", variant === "debt" ? "text-[#ff3b30]" : "text-muted")}>
        {sub}
      </p>
    </button>
  );
}
