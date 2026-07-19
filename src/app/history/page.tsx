"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, RotateCcw, Calendar } from "lucide-react";
import { DeletedHistoryCard } from "@/components/history/deleted-history-card";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassModal } from "@/components/ui/glass-modal";
import { PersonTabs } from "@/components/ui/person-tabs";
import { useFinanceStore } from "@/store/finance-store";
import { formatCurrency, formatDateTime, compareByDateTime, isWithinDateRange } from "@/lib/formatters";
import { getTransactionDisplayMessage, getTransactionActor } from "@/lib/transaction-messages";
import { PERSON_LABELS, type Person, type Transaction, type TransactionType } from "@/types";
import { cn } from "@/lib/utils";

const typeLabels: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  cash_withdrawal: "Cash Withdrawal",
  cash_deposit: "Cash Deposit",
  debt_payment: "Debt Payment",
  credit_payment: "Credit Payment",
  inter_couple: "Between Us",
  balance_adjustment: "Balance Update",
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
    <Suspense fallback={<div className="text-sm text-muted p-6">Loading history…</div>}>
      <HistoryPageContent />
    </Suspense>
  );
}

function HistoryPageContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("txn");

  const { transactions, deletedHistory, deleteTransaction, resetToSeed } = useFinanceStore();
  const [view, setView] = useState<"active" | "deleted">("active");
  const [person, setPerson] = useState<Person | "overall">("overall");
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [linkedHighlightId, setLinkedHighlightId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [deletedByChoice, setDeletedByChoice] = useState<Person>("kushvanth");

  const hasDateFilter = Boolean(startDate || endDate);

  const openDeleteConfirm = (transaction: Transaction) => {
    setDeletedByChoice(person !== "overall" ? person : "kushvanth");
    setPendingDelete({
      id: transaction.id,
      message: getTransactionDisplayMessage(transaction),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteTransaction(pendingDelete.id, deletedByChoice);
    setPendingDelete(null);
  };

  useEffect(() => {
    if (!highlightId) return;

    const inActive = transactions.some((t) => t.id === highlightId);
    const inDeleted = (deletedHistory ?? []).some((record) =>
      record.transactions.some((t) => t.id === highlightId)
    );

    if (inActive) {
      setView("active");
    } else if (inDeleted) {
      setView("deleted");
    }

    setPerson("overall");
    setTypeFilter("all");
    setStartDate("");
    setEndDate("");
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
  }, [highlightId, transactions, deletedHistory]);

  const clearDateFilter = () => {
    setStartDate("");
    setEndDate("");
  };

  const handleReset = () => {
    resetToSeed();
    setShowResetConfirm(false);
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
    .filter((t) => isWithinDateRange(t, startDate || undefined, endDate || undefined))
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
        startDate || undefined,
        endDate || undefined
      )
    )
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">History</h2>
          <p className="text-muted mt-1">
            {view === "active"
              ? "Complete transaction log with auto-generated details"
              : "Permanent record of everything removed from History"}
          </p>
        </div>
        <GlassButton
          variant="danger"
          size="sm"
          onClick={() => setShowResetConfirm(true)}
        >
          <RotateCcw className="w-4 h-4" />
          Reset all data
        </GlassButton>
      </div>

      <div className="glass rounded-2xl p-1 flex gap-1">
        <button
          type="button"
          onClick={() => setView("active")}
          className={cn(
            "flex-1 rounded-xl py-2 text-sm font-medium transition-colors",
            view === "active"
              ? "bg-[#007aff] text-white"
              : "text-muted hover:text-foreground"
          )}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setView("deleted")}
          className={cn(
            "flex-1 rounded-xl py-2 text-sm font-medium transition-colors",
            view === "deleted"
              ? "bg-[#ff3b30] text-white"
              : "text-muted hover:text-foreground"
          )}
        >
          Deleted ({filteredDeleted.length})
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <PersonTabs
            value={person}
            onChange={setPerson}
            includeOverall
            className="flex-1"
          />
          <div className="glass rounded-2xl px-4 py-2 flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TransactionType | "all")}
              className="bg-transparent outline-none text-sm flex-1"
            >
              <option value="all">All Types</option>
              {Object.entries(typeLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="glass rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex items-center gap-2 text-sm text-muted shrink-0">
            <Calendar className="w-4 h-4" />
            <span>Date range</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted px-1">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40 w-full"
              />
            </label>
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted px-1">To</span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40 w-full"
              />
            </label>
          </div>
          {hasDateFilter ? (
            <button
              type="button"
              onClick={clearDateFilter}
              className="text-xs text-[#007aff] font-medium px-2 py-2 shrink-0"
            >
              Clear dates
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted px-1">
        {view === "active"
          ? `${filtered.length} of ${transactions.length} transactions`
          : `${filteredDeleted.length} of ${(deletedHistory ?? []).length} deleted records`}
        {hasDateFilter ? " in selected date range" : ""}
      </p>

      {linkedHighlightId ? (
        <p className="text-xs text-[#007aff] px-1">
          Showing linked transaction from Between Us
        </p>
      ) : null}

      <GlassCard className="p-0 divide-y divide-white/5">
        {view === "deleted" ? (
          filteredDeleted.length === 0 ? (
            <p className="text-sm text-muted p-5">No deleted transactions yet</p>
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
          <p className="text-sm text-muted p-5">No transactions yet</p>
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
                  "flex items-start justify-between p-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors gap-3",
                  linkedHighlightId === transaction.id &&
                    "bg-[#007aff]/10 ring-2 ring-inset ring-[#007aff]/40"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#007aff]/15 text-[#007aff]">
                      {PERSON_LABELS[actor]}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5",
                        typeColors[transaction.type]
                      )}
                    >
                      {typeLabels[transaction.type]}
                    </span>
                    <span className="text-xs text-muted">
                      {formatDateTime(transaction.date, transaction.time, transaction.timestamp)}
                    </span>
                  </div>
                  <p className="font-medium mt-2 text-sm leading-snug">{message}</p>
                  {transaction.categoryRemaining != null && transaction.plannedAmount != null && (
                    <p className="text-xs text-[#34c759] mt-1">
                      {formatCurrency(transaction.categoryRemaining)} remaining of{" "}
                      {formatCurrency(transaction.plannedAmount)} budget
                    </p>
                  )}
                  {transaction.debtRemaining != null && (
                    <p className="text-xs text-[#ff9500] mt-1">
                      {formatCurrency(transaction.debtRemaining)} still to pay
                    </p>
                  )}
                  {transaction.notes && transaction.notes !== message && (
                    <p className="text-xs text-muted mt-1">Note: {transaction.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={cn(
                      "font-semibold whitespace-nowrap",
                      isPositive ? "text-[#34c759]" : "text-foreground"
                    )}
                  >
                    {isPositive ? "+" : "-"}
                    {formatCurrency(transaction.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => openDeleteConfirm(transaction)}
                    className="text-xs text-muted hover:text-[#ff3b30] px-2 py-1"
                    aria-label="Delete transaction"
                  >
                    ×
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
          This removes it from active History and saves a permanent deleted record with full
          details — including who deleted it.
        </p>
        {pendingDelete ? (
          <p className="text-sm font-medium mt-3 leading-snug">{pendingDelete.message}</p>
        ) : null}
        <div className="mt-4">
          <p className="text-sm font-medium mb-2">Who deleted this?</p>
          <PersonTabs value={deletedByChoice} onChange={setDeletedByChoice} />
        </div>
        <div className="flex gap-3 mt-5">
          <GlassButton className="flex-1" onClick={() => setPendingDelete(null)}>
            Cancel
          </GlassButton>
          <GlassButton variant="danger" className="flex-1" onClick={confirmDelete}>
            Delete permanently
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Reset all data?"
      >
        <p className="text-sm text-muted leading-relaxed">
          This clears all active transaction history, income entries, and resets account balances,
          debts, and Between Us back to the original starting values. Your permanent deleted
          record is kept.
        </p>
        <div className="flex gap-3 mt-5">
          <GlassButton className="flex-1" onClick={() => setShowResetConfirm(false)}>
            Cancel
          </GlassButton>
          <GlassButton variant="danger" className="flex-1" onClick={handleReset}>
            Reset everything
          </GlassButton>
        </div>
      </GlassModal>
    </div>
  );
}
