"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { CompactPageShell } from "@/components/ui/compact-page-shell";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { useFinanceStore } from "@/store/finance-store";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { buildExternalBetweenUsMessage } from "@/lib/transaction-messages";
import {
  getInterCoupleSummary,
  getDisplayInterCoupleHistory,
  isExternalBetweenUsTransaction,
  resolveLinkedTransactionId,
} from "@/lib/inter-couple";
import { PERSON_LABELS, type Person } from "@/types";
import { cn } from "@/lib/utils";

const OTHER_PERSON: Record<Person, Person> = {
  kushvanth: "grishma",
  grishma: "kushvanth",
};

export default function BetweenPage() {
  const router = useRouter();
  const { interCoupleBalance, interCoupleHistory, transactions, recordExternalBetweenUs } =
    useFinanceStore();

  const [showAdd, setShowAdd] = useState(false);
  const [paidBy, setPaidBy] = useState<Person>("grishma");
  const [benefited, setBenefited] = useState<Person>("kushvanth");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const parsedAmount = parseFloat(amount) || 0;
  const notesValid = notes.trim().length >= 3;
  const canSubmit = parsedAmount > 0 && paidBy !== benefited && notesValid;

  const previewMessage =
    parsedAmount > 0 && paidBy !== benefited
      ? buildExternalBetweenUsMessage({ paidBy, benefited, amount: parsedAmount })
      : null;

  const handleRecord = () => {
    if (!canSubmit) return;
    recordExternalBetweenUs({
      paidBy,
      benefited,
      amount: parsedAmount,
      notes: notes.trim(),
    });
    setAmount("");
    setNotes("");
    setShowAdd(false);
  };

  const openAdd = () => {
    setPaidBy("grishma");
    setBenefited("kushvanth");
    setAmount("");
    setNotes("");
    setShowAdd(true);
  };

  const balanceSummary = getInterCoupleSummary(interCoupleBalance);
  const sortedHistory = useMemo(
    () => getDisplayInterCoupleHistory(interCoupleHistory),
    [interCoupleHistory]
  );

  return (
    <CompactPageShell
      title="Between Us"
      subtitle="Shared balance — bank spends update automatically"
      action={
        <GlassButton size="sm" onClick={openAdd}>
          <Plus className="w-3.5 h-3.5" /> Add
        </GlassButton>
      }
      className="max-w-lg"
    >
      <GlassCard strong className="!py-6 text-center space-y-1">
        <p className="text-xs text-muted">{balanceSummary.label}</p>
        <p className="text-3xl font-bold tracking-tight text-[#007aff] tabular-nums">
          {formatCurrency(balanceSummary.amount)}
        </p>
      </GlassCard>

      <div className="rounded-xl border border-[#af52de]/20 bg-[#af52de]/5 px-3 py-2.5 text-[11px] leading-snug text-muted">
        <p className="font-semibold text-[#af52de] mb-0.5">Two ways this updates</p>
        <p>
          <strong>Spend page</strong> — paying from a bank account updates Between Us and History
          automatically.
        </p>
        <p className="mt-1">
          <strong>Add button</strong> — for cash or money from outside your accounts (e.g. Grishma
          gave you $1,000 from another source). Requires a note and shows in History.
        </p>
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-black/5 dark:border-white/10">
          <p className="text-xs font-semibold">History</p>
          <p className="text-[10px] text-muted">{sortedHistory.length} entries</p>
        </div>
        {sortedHistory.length === 0 ? (
          <p className="text-xs text-muted p-4 text-center">No entries yet</p>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {sortedHistory.map((entry) => {
              const linkedTransactionId = resolveLinkedTransactionId(entry, transactions);
              const linkedTx = linkedTransactionId
                ? transactions.find((t) => t.id === linkedTransactionId)
                : undefined;
              const isExternal = linkedTx ? isExternalBetweenUsTransaction(linkedTx) : false;
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
                    "flex items-start justify-between px-3 py-2.5 gap-2 w-full text-left transition-colors",
                    isClickable && "hover:bg-[#007aff]/5 cursor-pointer"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#007aff]/15 text-[#007aff]">
                        {PERSON_LABELS[entry.paidBy]}
                      </span>
                      <span className="text-[10px] text-muted">→</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#af52de]/15 text-[#af52de]">
                        {PERSON_LABELS[entry.benefited]}
                      </span>
                      {isExternal ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[#ff9500]/15 text-[#ff9500] font-medium">
                          External
                        </span>
                      ) : linkedTx?.type === "inter_couple" ? null : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-muted font-medium">
                          From spend
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium leading-snug">
                      {entry.autoMessage ??
                        `${PERSON_LABELS[entry.paidBy]} paid ${formatCurrency(entry.amount)} for ${PERSON_LABELS[entry.benefited]}`}
                    </p>
                    {entry.notes && entry.notes !== entry.autoMessage && (
                      <p className="text-[10px] text-muted mt-0.5 line-clamp-2">
                        Note: {entry.notes}
                      </p>
                    )}
                    <p className="text-[10px] text-muted mt-0.5">
                      {formatDateTime(entry.date, entry.time, entry.timestamp)}
                    </p>
                    {isClickable && (
                      <p className="text-[10px] text-[#007aff] mt-1 flex items-center gap-0.5">
                        View in History <ChevronRight className="w-3 h-3" />
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold tabular-nums">
                      {formatCurrency(entry.amount)}
                    </p>
                    <p className="text-[10px] text-muted tabular-nums">
                      Bal {formatCurrency(entry.runningBalance)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </GlassCard>

      <GlassModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add outside money"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">
            Use this when money moves between you but not through your linked bank accounts —
            cash, Zelle from another account, gifts, etc. This does not change account balances.
          </p>

          <div>
            <p className="text-sm font-medium mb-2">Who gave the money?</p>
            <div className="glass rounded-xl p-0.5 flex gap-0.5">
              {(["kushvanth", "grishma"] as Person[]).map((person) => (
                <button
                  key={person}
                  type="button"
                  onClick={() => {
                    setPaidBy(person);
                    setBenefited(OTHER_PERSON[person]);
                  }}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-xs font-medium transition-all",
                    paidBy === person ? "bg-[#007aff] text-white" : "text-muted"
                  )}
                >
                  {PERSON_LABELS[person]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Who received it?</p>
            <div className="glass rounded-xl p-0.5 flex gap-0.5">
              {(["kushvanth", "grishma"] as Person[]).map((person) => (
                <button
                  key={person}
                  type="button"
                  disabled={person === paidBy}
                  onClick={() => setBenefited(person)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-30",
                    benefited === person ? "bg-[#af52de] text-white" : "text-muted"
                  )}
                >
                  {PERSON_LABELS[person]}
                </button>
              ))}
            </div>
            {paidBy === benefited && (
              <p className="text-[10px] text-[#ff3b30] mt-1">Giver and receiver must be different</p>
            )}
          </div>

          <GlassInput
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />

          <div>
            <GlassInput
              label="What is this for? (required)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Grishma gave me $1,000 from her other account"
            />
            {!notesValid && notes.length > 0 && (
              <p className="text-[10px] text-muted mt-1">Please add at least a few words</p>
            )}
          </div>

          {previewMessage && (
            <div className="rounded-xl bg-[#34c759]/10 border border-[#34c759]/20 px-3 py-2 text-xs">
              <p className="font-semibold text-[#34c759] mb-0.5">Preview</p>
              <p>{previewMessage}</p>
              {notes.trim() && <p className="text-muted mt-1">Note: {notes.trim()}</p>}
              <p className="text-[10px] text-muted mt-1.5">
                Saved to Between Us and History with today&apos;s date and time.
              </p>
            </div>
          )}

          <GlassButton className="w-full" onClick={handleRecord} disabled={!canSubmit}>
            Add to Between Us
          </GlassButton>
        </div>
      </GlassModal>
    </CompactPageShell>
  );
}
