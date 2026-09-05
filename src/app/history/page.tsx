"use client";

import { displayText } from "@/lib/branding";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, RotateCcw, Trash2 } from "lucide-react";
import { DeletedHistoryCard } from "@/components/history/deleted-history-card";
import { ActiveTransactionDetails } from "@/components/history/active-transaction-details";
import { CompactPageShell } from "@/components/ui/compact-page-shell";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassModal } from "@/components/ui/glass-modal";
import {
  MonthRangeFilter,
  defaultMonthRangeValue,
  getMonthRangeBounds,
  type MonthRangeValue,
} from "@/components/ui/month-range-filter";
import { useFinanceStore, getFinanceState } from "@/store/finance-store";
import { getAvailableMonthKeys } from "@/lib/calculations";
import { formatCurrency, formatDateTime, compareByDateTime, isWithinDateRange } from "@/lib/formatters";
import { getTransactionDisplayMessage, getTransactionActor } from "@/lib/transaction-messages";
import { forcePushNow, getActiveHouseholdId } from "@/lib/supabase/sync";
import { PERSON_LABELS, type Person, type Transaction, type TransactionType } from "@/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const typeLabels: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  cash_withdrawal: "Cash",
  cash_deposit: "Cash",
  debt_payment: "Debt",
  credit_payment: "Credit",
  inter_couple: "Between Us",
  balance_adjustment: "Adjust",
};

const typeColors: Record<TransactionType, string> = {
  income: "text-[#34c759]",
  expense: "text-[#ff3b30]",
  transfer: "text-[#5856d6]",
  cash_withdrawal: "text-[#ff9500]",
  cash_deposit: "text-[#34c759]",
  debt_payment: "text-[#007aff]",
  credit_payment: "text-[#007aff]",
  inter_couple: "text-[#af52de]",
  balance_adjustment: "text-muted",
};

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="text-xs text-muted p-4">Loading history…</div>}>
      <HistoryPageContent />
    </Suspense>
  );
}

function HistoryPageContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("txn");
  const typeParam = searchParams.get("type");
  const categoryParam = searchParams.get("category");
  const personParam = searchParams.get("person");

  const { transactions, incomeEntries, deletedHistory, deleteTransaction, resetToSeed } =
    useFinanceStore();
  const [view, setView] = useState<"active" | "deleted">("active");
  const [person, setPerson] = useState<Person | "overall">("overall");
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all");
  const monthOptions = useMemo(
    () => getAvailableMonthKeys(transactions, incomeEntries),
    [transactions, incomeEntries]
  );
  const [dateRange, setDateRange] = useState<MonthRangeValue>(() =>
    defaultMonthRangeValue(monthOptions[0] ?? format(new Date(), "yyyy-MM"))
  );
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [linkedHighlightId, setLinkedHighlightId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletedByChoice, setDeletedByChoice] = useState<Person>("kushvanth");

  const bounds = getMonthRangeBounds(dateRange);
  const hasDateFilter = dateRange.mode !== "all";

  const openDeleteConfirm = (transaction: Transaction) => {
    setDeletedByChoice(person !== "overall" ? person : "kushvanth");
    setPendingDelete({
      id: transaction.id,
      message: getTransactionDisplayMessage(transaction),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      deleteTransaction(pendingDelete.id, deletedByChoice);
      setPendingDelete(null);
      setIsDeleting(false);

      void forcePushNow(getActiveHouseholdId(), getFinanceState).catch((err) => {
        setDeleteError(err instanceof Error ? err.message : "Deleted locally, but cloud sync failed");
      });
    } catch (err) {
      setIsDeleting(false);
      setDeleteError(err instanceof Error ? err.message : "Could not delete transaction");
    }
  };

  useEffect(() => {
    if (!highlightId) return;

    const inActive = transactions.some((t) => t.id === highlightId);
    const inDeleted = (deletedHistory ?? []).some((record) =>
      record.transactions.some((t) => t.id === highlightId)
    );

    if (inActive) setView("active");
    else if (inDeleted) setView("deleted");

    setPerson("overall");
    setTypeFilter("all");
    setDateRange(defaultMonthRangeValue(monthOptions[0] ?? format(new Date(), "yyyy-MM")));
    setLinkedHighlightId(highlightId);

    const timer = window.setTimeout(() => {
      document
        .getElementById(`history-txn-${highlightId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);

    const clearTimer = window.setTimeout(() => setLinkedHighlightId(null), 4000);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightId, transactions, deletedHistory, monthOptions]);

  useEffect(() => {
    if (typeParam === "income") {
      setView("active");
      setTypeFilter("income");
    } else if (typeParam === "expense") {
      setView("active");
      setTypeFilter("expense");
    }
    if (personParam === "kushvanth" || personParam === "grishma") {
      setPerson(personParam);
    }
  }, [typeParam, personParam]);

  const handleReset = () => {
    if (isResetting) return;
    setIsResetting(true);
    setDeleteError(null);
    try {
      resetToSeed();
      setShowResetConfirm(false);
      void forcePushNow(getActiveHouseholdId(), getFinanceState, {
        skipSafetyCheck: true,
      }).catch((err) => {
        setDeleteError(
          err instanceof Error
            ? err.message
            : "Reset locally, but cloud sync failed — history may come back."
        );
      });
    } finally {
      setIsResetting(false);
    }
  };

  const filtered = transactions
    .filter(
      (t) =>
        person === "overall" ||
        t.person === person ||
        t.paidByPerson === person ||
        t.expenseOwner === person ||
        t.beneficiaryPerson === person ||
        (t.expenseShares?.[person] ?? 0) > 0
    )
    .filter((t) => typeFilter === "all" || t.type === typeFilter)
    .filter((t) => !categoryParam || (t.category ?? "Other") === categoryParam)
    .filter((t) => isWithinDateRange(t, bounds.start, bounds.end))
    .sort(compareByDateTime);

  const filteredDeleted = (deletedHistory ?? [])
    .filter((record) => {
      if (person === "overall") return true;
      return record.transactions.some(
        (t) =>
          t.person === person ||
          t.paidByPerson === person ||
          t.expenseOwner === person ||
          t.beneficiaryPerson === person ||
          (t.expenseShares?.[person] ?? 0) > 0
      );
    })
    .filter((record) => {
      if (typeFilter === "all") return true;
      return record.transactions.some((t) => t.type === typeFilter);
    })
    .filter((record) =>
      isWithinDateRange(
        { date: record.deletedAt.slice(0, 10), timestamp: record.deletedAt },
        bounds.start,
        bounds.end
      )
    )
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  return (
    <CompactPageShell
      title="History"
      subtitle={
        view === "active"
          ? categoryParam
            ? `${filtered.length} · ${categoryParam}`
            : `${filtered.length} of ${transactions.length} transactions`
          : `${filteredDeleted.length} deleted records`
      }
      personOverall
      personFilter={person}
      onPersonFilterChange={setPerson}
      action={
        <GlassButton variant="danger" size="sm" onClick={() => setShowResetConfirm(true)}>
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </GlassButton>
      }
    >
      <div className="glass rounded-xl p-0.5 flex gap-0.5">
        <button
          type="button"
          onClick={() => setView("active")}
          className={cn(
            "flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors",
            view === "active" ? "bg-[#007aff] text-white" : "text-muted"
          )}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setView("deleted")}
          className={cn(
            "flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors",
            view === "deleted"
              ? "bg-[#ff3b30] text-white"
              : "text-muted"
          )}
        >
          Deleted ({filteredDeleted.length})
        </button>
      </div>

      <MonthRangeFilter
        value={dateRange}
        onChange={setDateRange}
        monthOptions={monthOptions}
      />

      <div className="glass rounded-xl px-3 py-2 flex items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-muted shrink-0" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TransactionType | "all")}
          className="bg-transparent outline-none text-xs flex-1"
        >
          <option value="all">All types</option>
          {Object.entries(typeLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {hasDateFilter ? (
        <p className="text-[10px] text-muted px-1">Filtered: {bounds.label}</p>
      ) : null}

      {linkedHighlightId ? (
        <p className="text-[10px] text-[#007aff] px-1">Linked from Between Us</p>
      ) : null}

      {deleteError ? (
        <p className="text-xs text-[#ff3b30] bg-[#ff3b30]/10 rounded-2xl px-4 py-3">
          {deleteError}
        </p>
      ) : null}

      <GlassCard className="!p-0 divide-y divide-black/5 dark:divide-white/10">
        {view === "deleted" ? (
          filteredDeleted.length === 0 ? (
            <p className="text-xs text-muted p-4 text-center">No deleted records</p>
          ) : (
            filteredDeleted.map((record) => (
              <div
                key={record.id}
                id={
                  record.transactions.some((t) => t.id === linkedHighlightId)
                    ? `history-txn-${linkedHighlightId}`
                    : undefined
                }
              >
                <DeletedHistoryCard record={record} />
              </div>
            ))
          )
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted p-4 text-center">No transactions</p>
        ) : (
          filtered.map((transaction) => {
            const isPositive =
              transaction.type === "income" || transaction.type === "cash_deposit";
            const message = getTransactionDisplayMessage(transaction);
            const actor = getTransactionActor(transaction);

            return (
              <div
                key={transaction.id}
                id={`history-txn-${transaction.id}`}
                className={cn(
                  "flex items-start justify-between px-3 py-2.5 gap-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]",
                  linkedHighlightId === transaction.id &&
                    "bg-[#007aff]/10 ring-2 ring-inset ring-[#007aff]/40"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#007aff]/15 text-[#007aff]">
                      {PERSON_LABELS[actor]}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/5",
                        typeColors[transaction.type]
                      )}
                    >
                      {typeLabels[transaction.type]}
                    </span>
                    <span className="text-[10px] text-muted">
                      {formatDateTime(transaction.date, transaction.time, transaction.timestamp)}
                    </span>
                  </div>
                  <p className="font-medium mt-1 text-xs leading-snug">{message}</p>
                  <ActiveTransactionDetails transaction={transaction} />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums whitespace-nowrap",
                      isPositive ? "text-[#34c759]" : "text-foreground"
                    )}
                  >
                    {isPositive ? "+" : "-"}
                    {formatCurrency(transaction.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDeleteConfirm(transaction);
                    }}
                    className="text-muted hover:text-[#ff3b30] p-1.5 rounded-lg hover:bg-[#ff3b30]/10"
                    aria-label="Delete transaction"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </GlassCard>

      <GlassModal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title="Delete transaction?"
      >
        <p className="text-sm text-muted leading-relaxed">
          Removed from active History and saved in the deleted log.
        </p>
        {pendingDelete ? (
          <p className="text-sm font-medium mt-3 leading-snug">{displayText(pendingDelete.message)}</p>
        ) : null}
        <div className="mt-4">
          <p className="text-sm font-medium mb-2">Who deleted this?</p>
          <div className="glass rounded-xl p-0.5 flex gap-0.5">
            {(["kushvanth", "grishma"] as Person[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDeletedByChoice(p)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-medium",
                  deletedByChoice === p ? "bg-[#007aff] text-white" : "text-muted"
                )}
              >
                {PERSON_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <GlassButton className="flex-1" onClick={() => setPendingDelete(null)}>
            Cancel
          </GlassButton>
          <GlassButton variant="danger" className="flex-1" onClick={confirmDelete} disabled={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete"}
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={showResetConfirm}
        onClose={() => {
          if (!isResetting) setShowResetConfirm(false);
        }}
        title="Reset all data?"
      >
        <p className="text-sm text-muted leading-relaxed">
          This clears active history and resets balances on this device and in the cloud. Deleted
          records stay in the Deleted tab.
        </p>
        <div className="flex gap-3 mt-5">
          <GlassButton
            className="flex-1"
            onClick={() => setShowResetConfirm(false)}
            disabled={isResetting}
          >
            Cancel
          </GlassButton>
          <GlassButton variant="danger" className="flex-1" onClick={handleReset} disabled={isResetting}>
            {isResetting ? "Resetting…" : "Reset"}
          </GlassButton>
        </div>
      </GlassModal>
    </CompactPageShell>
  );
}
