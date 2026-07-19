"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, ChevronRight } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { useFinanceStore } from "@/store/finance-store";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { getInterCoupleSummary, getDisplayInterCoupleHistory, resolveLinkedTransactionId } from "@/lib/inter-couple";
import { PERSON_LABELS, type Person } from "@/types";
import { cn } from "@/lib/utils";

export default function BetweenPage() {
  const router = useRouter();
  const {
    interCoupleBalance,
    interCoupleHistory,
    transactions,
    recordInterCouple,
    updateInterCoupleBalance,
  } = useFinanceStore();

  const [showAdd, setShowAdd] = useState(false);
  const [showEditBalance, setShowEditBalance] = useState(false);
  const [paidBy, setPaidBy] = useState<Person>("kushvanth");
  const [benefited, setBenefited] = useState<Person>("grishma");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [manualBalance, setManualBalance] = useState(String(interCoupleBalance));

  const handleRecord = () => {
    const parsed = parseFloat(amount);
    if (!parsed || paidBy === benefited) return;
    recordInterCouple(paidBy, benefited, parsed, notes || undefined);
    setAmount("");
    setNotes("");
    setShowAdd(false);
  };

  const handleUpdateBalance = () => {
    const parsed = parseFloat(manualBalance);
    if (!isNaN(parsed)) {
      updateInterCoupleBalance(parsed);
    }
    setShowEditBalance(false);
  };

  const balanceSummary = getInterCoupleSummary(interCoupleBalance);
  const sortedHistory = useMemo(
    () => getDisplayInterCoupleHistory(interCoupleHistory),
    [interCoupleHistory]
  );

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Between Us</h2>
          <p className="text-muted mt-1">Who paid for what — and who should pay back</p>
        </div>
        <GlassButton onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> Record
        </GlassButton>
      </div>

      <GlassCard strong className="text-center py-8 space-y-2">
        <p className="text-sm text-muted">{balanceSummary.label}</p>
        <p className="text-5xl font-bold tracking-tight text-[#007aff]">
          {formatCurrency(balanceSummary.amount)}
        </p>
        <GlassButton
          size="sm"
          variant="ghost"
          onClick={() => {
            setManualBalance(String(interCoupleBalance));
            setShowEditBalance(true);
          }}
        >
          <Pencil className="w-3 h-3" /> Edit Balance
        </GlassButton>
      </GlassCard>

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Transaction History</h3>
            <p className="text-xs text-muted mt-0.5">
              {sortedHistory.length} {sortedHistory.length === 1 ? "entry" : "entries"} · newest first
            </p>
          </div>
        </div>
        {sortedHistory.length === 0 ? (
          <p className="text-sm text-muted p-5">
            No transactions yet. Record when one of you pays for the other.
          </p>
        ) : (
          <div className="divide-y divide-white/5">
            {sortedHistory.map((entry) => {
              const linkedTransactionId = resolveLinkedTransactionId(entry, transactions);
              const isClickable = Boolean(linkedTransactionId);

              return (
              <button
                key={entry.id}
                type="button"
                disabled={!isClickable}
                onClick={() => {
                  if (linkedTransactionId) {
                    router.push(`/history?txn=${linkedTransactionId}`);
                  }
                }}
                className={cn(
                  "flex items-start justify-between px-5 py-4 gap-3 w-full text-left transition-colors",
                  isClickable
                    ? "hover:bg-[#007aff]/5 cursor-pointer"
                    : "cursor-default"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#007aff]/15 text-[#007aff]">
                      {PERSON_LABELS[entry.paidBy]}
                    </span>
                    <span className="text-xs text-muted">
                      {formatDateTime(entry.date, entry.time, entry.timestamp)}
                    </span>
                  </div>
                  <p className="font-medium text-sm leading-snug">
                    {entry.autoMessage ??
                      `${PERSON_LABELS[entry.paidBy]} paid ${formatCurrency(entry.amount)} for ${PERSON_LABELS[entry.benefited]}'s share`}
                  </p>
                  {entry.notes && entry.notes !== entry.autoMessage && (
                    <p className="text-xs text-muted mt-1">Note: {entry.notes}</p>
                  )}
                  <p className="text-xs text-muted mt-1">
                    For: {PERSON_LABELS[entry.benefited]}
                  </p>
                  {isClickable ? (
                    <p className="text-xs text-[#007aff] mt-1.5 flex items-center gap-0.5">
                      View in History <ChevronRight className="w-3 h-3" />
                    </p>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold">{formatCurrency(entry.amount)}</p>
                  <p className="text-xs text-muted">
                    Balance after: {formatCurrency(entry.runningBalance)}
                  </p>
                </div>
              </button>
              );
            })}
          </div>
        )}
      </GlassCard>

      <GlassModal open={showAdd} onClose={() => setShowAdd(false)} title="Record Transaction">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted px-1">Paid By</label>
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value as Person)}
              className="glass rounded-2xl px-4 py-3 w-full mt-1.5 outline-none"
            >
              <option value="kushvanth">{PERSON_LABELS.kushvanth}</option>
              <option value="grishma">{PERSON_LABELS.grishma}</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-muted px-1">Benefited</label>
            <select
              value={benefited}
              onChange={(e) => setBenefited(e.target.value as Person)}
              className="glass rounded-2xl px-4 py-3 w-full mt-1.5 outline-none"
            >
              <option value="kushvanth">{PERSON_LABELS.kushvanth}</option>
              <option value="grishma">{PERSON_LABELS.grishma}</option>
            </select>
          </div>
          <GlassInput
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <GlassInput
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was it for?"
          />
          <GlassButton className="w-full" onClick={handleRecord}>
            Record Transaction
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={showEditBalance}
        onClose={() => setShowEditBalance(false)}
        title="Edit Balance"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Positive = {PERSON_LABELS.grishma} should pay {PERSON_LABELS.kushvanth} back.
            Negative = {PERSON_LABELS.kushvanth} should pay {PERSON_LABELS.grishma} back.
          </p>
          <GlassInput
            label="Balance"
            type="number"
            value={manualBalance}
            onChange={(e) => setManualBalance(e.target.value)}
          />
          <GlassButton className="w-full" onClick={handleUpdateBalance}>
            Update Balance
          </GlassButton>
        </div>
      </GlassModal>
    </div>
  );
}
