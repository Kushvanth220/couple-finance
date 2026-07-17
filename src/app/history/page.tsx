"use client";

import { useState } from "react";
import { Filter, RotateCcw } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassModal } from "@/components/ui/glass-modal";
import { PersonTabs } from "@/components/ui/person-tabs";
import { useFinanceStore } from "@/store/finance-store";
import { formatCurrency, formatDateTime, compareByDateTime } from "@/lib/formatters";
import { getTransactionDisplayMessage, getTransactionActor } from "@/lib/transaction-messages";
import { PERSON_LABELS, type Person, type TransactionType } from "@/types";
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
  const { transactions, deleteTransaction, resetToSeed } = useFinanceStore();
  const [person, setPerson] = useState<Person | "all">("all");
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleReset = () => {
    resetToSeed();
    setShowResetConfirm(false);
  };

  const filtered = transactions
    .filter((t) => person === "all" || t.person === person || t.paidByPerson === person)
    .filter((t) => typeFilter === "all" || t.type === typeFilter)
    .sort(compareByDateTime);

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">History</h2>
          <p className="text-muted mt-1">Complete transaction log with auto-generated details</p>
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

      <div className="flex flex-col sm:flex-row gap-3">
        <PersonTabs
          value={person === "all" ? "kushvanth" : person}
          onChange={(p) => setPerson(p)}
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

      <GlassCard className="p-0 divide-y divide-white/5">
        {filtered.length === 0 ? (
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
                className="flex items-start justify-between p-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors gap-3"
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
                      {formatCurrency(transaction.debtRemaining)} still owed
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
                    onClick={() => deleteTransaction(transaction.id)}
                    className="text-xs text-muted hover:text-[#ff3b30] px-2 py-1"
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
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Reset all data?"
      >
        <p className="text-sm text-muted leading-relaxed">
          This clears all transaction history, income entries, and resets account balances,
          debts, and Between Us back to the original starting values.
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
