"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { useFinanceStore } from "@/store/finance-store";
import { formatCurrency, formatDateTime, compareByDateTime } from "@/lib/formatters";
import { PERSON_LABELS, type Person } from "@/types";

export default function BetweenPage() {
  const {
    interCoupleBalance,
    interCoupleHistory,
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

  return (
    <div className="space-y-6 animate-fade-in-up max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Between Us</h2>
          <p className="text-muted mt-1">Money owed between Kushvanth & Grishma</p>
        </div>
        <GlassButton onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> Record
        </GlassButton>
      </div>

      <GlassCard strong className="text-center py-8 space-y-2">
        <p className="text-sm text-muted">Grishma owes Kushvanth</p>
        <p className="text-5xl font-bold tracking-tight text-[#007aff]">
          {formatCurrency(interCoupleBalance)}
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

      <GlassCard>
        <h3 className="text-lg font-semibold mb-4">Transaction History</h3>
        {interCoupleHistory.length === 0 ? (
          <p className="text-sm text-muted">
            No transactions yet. Record when one of you pays for the other.
          </p>
        ) : (
          <div className="space-y-3">
            {[...interCoupleHistory].sort(compareByDateTime).map((entry) => (
              <div
                key={entry.id}
                className="flex items-start justify-between py-3 border-b border-white/5 last:border-0 gap-3"
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
                      `${PERSON_LABELS[entry.paidBy]} paid ${formatCurrency(entry.amount)} for ${PERSON_LABELS[entry.benefited]}`}
                  </p>
                  {entry.notes && entry.notes !== entry.autoMessage && (
                    <p className="text-xs text-muted mt-1">Note: {entry.notes}</p>
                  )}
                  <p className="text-xs text-muted mt-1">
                    Benefited: {PERSON_LABELS[entry.benefited]}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold">{formatCurrency(entry.amount)}</p>
                  <p className="text-xs text-muted">
                    Balance: {formatCurrency(entry.runningBalance)}
                  </p>
                </div>
              </div>
            ))}
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
            Positive amount means Grishma owes Kushvanth.
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
