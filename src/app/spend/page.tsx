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
import { GlassModal } from "@/components/ui/glass-modal";
import { SpendCategoryManager } from "@/components/spend/spend-category-manager";
import { useFinanceStore } from "@/store/finance-store";
import { getAccountsForPerson, isSharedAccount } from "@/lib/accounts";
import { formatCurrency } from "@/lib/formatters";
import {
  matchSpendCategoryFromNote,
  resolveSpendCategoryLabel,
} from "@/lib/spend-categories";
import { getInterCoupleUpdatesFromShares } from "@/lib/transaction-reversal";
import { describeInterCoupleFromSpend } from "@/lib/inter-couple";
import { PERSON_LABELS, type Account, type Person, type SpendCategory } from "@/types";
import { cn } from "@/lib/utils";

type Step = "details" | "payment" | "cash-source" | "done";
type PaidByMode = "kushvanth" | "grishma" | "split";

type CategorySelection = {
  type: "category";
  categoryId: string;
  name: string;
  owner: Person | "both";
};

type ExpenseOwner = Person | "both";

interface PaymentSelection {
  person: Person;
  amount: number;
  accountId: string;
  cashSourceAccountId?: string;
}

function isSharedExpense(owner: ExpenseOwner): boolean {
  return owner === "both";
}

function keywordsSubLine(category: SpendCategory): string {
  const keywords = category.keywords?.filter(Boolean) ?? [];
  if (keywords.length === 0) return "No keywords";
  if (keywords.length <= 2) return keywords.join(", ");
  return `${keywords.slice(0, 2).join(", ")} +${keywords.length - 2}`;
}

export default function SpendPage() {
  const {
    accounts,
    spendCategories,
    spend,
    spendSplit,
  } = useFinanceStore();

  const [step, setStep] = useState<Step>("details");
  const [amount, setAmount] = useState("");
  const [selection, setSelection] = useState<CategorySelection | null>(null);
  const [expenseOwner, setExpenseOwner] = useState<ExpenseOwner>("kushvanth");
  const [manualCategoryPick, setManualCategoryPick] = useState(false);
  const [paidByMode, setPaidByMode] = useState<PaidByMode>("kushvanth");
  const [kushShare, setKushShare] = useState("");
  const [grishShare, setGrishShare] = useState("");
  const [expenseShareKush, setExpenseShareKush] = useState("");
  const [expenseShareGrish, setExpenseShareGrish] = useState("");
  const [notes, setNotes] = useState("");

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [pendingCashFor, setPendingCashFor] = useState<Person | null>(null);
  const [splitPayments, setSplitPayments] = useState<Partial<Record<Person, PaymentSelection>>>({});

  const [manageOpen, setManageOpen] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;
  const sharedExpense = isSharedExpense(expenseOwner);

  const categoryLabel = useMemo(
    () => resolveSpendCategoryLabel(spendCategories, selection?.categoryId ?? null, notes),
    [spendCategories, selection?.categoryId, notes]
  );

  const reset = () => {
    setStep("details");
    setAmount("");
    setSelection(null);
    setExpenseOwner("kushvanth");
    setManualCategoryPick(false);
    setPaidByMode("kushvanth");
    setKushShare("");
    setGrishShare("");
    setExpenseShareKush("");
    setExpenseShareGrish("");
    setNotes("");
    setSelectedAccount(null);
    setPendingCashFor(null);
    setSplitPayments({});
    setManageOpen(false);
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

  const handleNotesChange = (val: string) => {
    setNotes(val);
    if (manualCategoryPick) return;

    const matched = matchSpendCategoryFromNote(val, spendCategories);
    if (matched) {
      setSelection({
        type: "category",
        categoryId: matched.id,
        name: matched.name,
        owner: expenseOwner,
      });
    }
  };

  const selectCategory = (category: SpendCategory) => {
    setManualCategoryPick(true);
    setSelection({
      type: "category",
      categoryId: category.id,
      name: category.name,
      owner: expenseOwner,
    });
  };

  const handleOwnerChange = (owner: ExpenseOwner) => {
    setExpenseOwner(owner);
    if (selection) {
      setSelection({ ...selection, owner });
    }

    if (owner === "both" && parsedAmount > 0) {
      applyEvenExpenseSplit(parsedAmount);
    } else if (owner !== "both") {
      setExpenseShareKush("");
      setExpenseShareGrish("");
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

  const isCategoryValid = !!selection?.categoryId;

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

  const spendMeta = useMemo(() => {
    if (sharedExpense) {
      return { expenseOwner: undefined as Person | undefined };
    }
    return { expenseOwner: expenseOwner === "both" ? undefined : expenseOwner };
  }, [expenseOwner, sharedExpense]);

  const handleDetailsNext = () => {
    if (!isCategoryValid || parsedAmount <= 0 || !sharesValid) return;
    setSplitPayments({});
    setStep("payment");
  };

  const getPersonAccounts = (person: Person) => getAccountsForPerson(accounts, person);
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

  const getExpenseShares = () => {
    if (!sharedExpense) return undefined;
    return {
      kushvanth: expenseShareKushAmt,
      grishma: expenseShareGrishAmt,
    };
  };

  const confirmSplit = () => {
    const label = resolveSpendCategoryLabel(
      spendCategories,
      selection?.categoryId ?? null,
      notes
    );
    const payments = (["kushvanth", "grishma"] as Person[])
      .map((p) => splitPayments[p])
      .filter((p): p is PaymentSelection => !!p && p.amount > 0);

    if (payments.length === 0) return;

    spendSplit({
      category: label,
      expenseOwner: sharedExpense ? undefined : (expenseOwner as Person),
      expenseShares: getExpenseShares(),
      notes: notes || undefined,
      payments,
    });
    setStep("done");
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
    const label = resolveSpendCategoryLabel(
      spendCategories,
      selection?.categoryId ?? null,
      notes
    );

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
      expenseOwner: spendMeta.expenseOwner,
    });
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

  const handleCategoryDeleted = (id: string) => {
    if (selection?.categoryId === id) {
      setSelection(null);
      setManualCategoryPick(false);
    }
  };

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
                  {isSharedAccount(a) ? (
                    <span className="ml-1 text-[10px] text-[#af52de]">· Shared</span>
                  ) : null}
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

  const stepLabel =
    step === "details" ? "1 · Details" : step === "payment" ? "2 · Pay" : step === "cash-source" ? "2 · Cash" : "Done";
  const currentStep = step === "details" ? 1 : 2;

  const selectionMeta =
    expenseOwner === "both"
      ? "Both of you"
      : PERSON_LABELS[expenseOwner as Person];

  return (
    <div className="space-y-3 animate-fade-in-up max-w-lg mx-auto pb-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold leading-tight">Spend</h1>
          <p className="text-[10px] text-muted">{stepLabel}</p>
        </div>
        {step !== "details" && step !== "done" && (
          <button
            type="button"
            onClick={reset}
            className="text-[10px] text-[#007aff] font-medium px-2 py-1"
          >
            Cancel
          </button>
        )}
      </div>

      {step !== "done" && (
        <div className="flex gap-1">
          {[1, 2].map((n) => (
            <div
              key={n}
              className={cn(
                "h-1 flex-1 rounded-full",
                currentStep >= n ? "bg-[#007aff]" : "bg-black/10 dark:bg-white/10"
              )}
            />
          ))}
        </div>
      )}

      {step === "details" && (
        <GlassCard strong className="space-y-3 !p-3">
          <div className="flex items-center justify-center gap-1 py-0.5">
            <span className="text-xl font-light text-muted">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0"
              className="text-3xl font-bold bg-transparent outline-none w-32 text-center"
              autoFocus
            />
          </div>

          <div>
            <p className="text-[11px] text-muted px-1 mb-1">Note</p>
            <input
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="What was it? e.g. Groceries at Costco"
              className="w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
          </div>

          <div className="space-y-2">
            {selection?.categoryId && (
              <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/10 px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{categoryLabel}</p>
                  <p className="text-[11px] text-muted truncate">{selectionMeta}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelection(null);
                    setManualCategoryPick(false);
                  }}
                  className="text-[11px] text-[#007aff] font-medium shrink-0"
                >
                  Change
                </button>
              </div>
            )}

            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] text-muted">Category</p>
              <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="text-[11px] text-[#007aff] font-medium"
              >
                Manage categories
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
              {spendCategories.map((category) => (
                <CategoryButton
                  key={category.id}
                  label={category.name}
                  sub={keywordsSubLine(category)}
                  selected={selection?.categoryId === category.id}
                  onClick={() => selectCategory(category)}
                />
              ))}
            </div>

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
                    onClick={() => handleOwnerChange(id)}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                      expenseOwner === id ? "bg-[#007aff] text-white" : "text-muted"
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
          <GlassButton size="lg" className="w-full" onClick={reset}>
            New Payment
          </GlassButton>
        </GlassCard>
      )}

      <SpendCategoryManager
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onCategoryDeleted={handleCategoryDeleted}
      />
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
}: {
  label: string;
  sub: string;
  tag?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl px-2 py-2 text-left text-xs transition-all border min-h-[52px] flex flex-col justify-between",
        selected
          ? "ring-2 ring-[#007aff] bg-[#007aff]/10 border-[#007aff]/40 shadow-sm"
          : "glass border-transparent hover:border-white/20 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
      )}
    >
      <div className="flex items-start justify-between gap-1 w-full">
        <p className="font-medium leading-tight line-clamp-2 text-[11px]">{label}</p>
        {tag ? (
          <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md shrink-0 bg-black/5 dark:bg-white/10 text-muted">
            {tag}
          </span>
        ) : null}
      </div>
      <p className="text-[10px] mt-1 text-muted">{sub}</p>
    </button>
  );
}
