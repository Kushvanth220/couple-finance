"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Banknote, Wallet } from "lucide-react";
import { format } from "date-fns";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { PersonTabs } from "@/components/ui/person-tabs";
import { StatCard } from "@/components/ui/stat-card";
import { useFinanceStore } from "@/store/finance-store";
import { getMonthlyIncome, getYearlyIncome } from "@/lib/calculations";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import type { IncomeDepositType, Person } from "@/types";
import { PERSON_LABELS } from "@/types";
import { cn } from "@/lib/utils";

export default function IncomePage() {
  const {
    incomeSources,
    incomeEntries,
    accounts,
    addIncomeSource,
    updateIncomeSource,
    deleteIncomeSource,
    addIncome,
    updateIncome,
    deleteIncome,
  } = useFinanceStore();

  const [person, setPerson] = useState<Person>("kushvanth");
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [editSourceId, setEditSourceId] = useState<string | null>(null);
  const [editIncomeId, setEditIncomeId] = useState<string | null>(null);

  const [sourceName, setSourceName] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeSourceId, setIncomeSourceId] = useState("");
  const [incomeDate, setIncomeDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [incomeNotes, setIncomeNotes] = useState("");
  const [depositType, setDepositType] = useState<IncomeDepositType>("debit");
  const [depositAccountId, setDepositAccountId] = useState("");

  const personSources = incomeSources.filter((s) => s.person === person);
  const personEntries = incomeEntries
    .filter((e) => e.person === person)
    .sort((a, b) => b.date.localeCompare(a.date));

  const personDebitAccounts = accounts.filter(
    (a) => a.person === person && a.type === "debit"
  );
  const cashAccount = accounts.find(
    (a) => a.person === person && a.type === "cash"
  );

  const monthlyTotal = getMonthlyIncome(incomeEntries, person);
  const yearlyTotal = getYearlyIncome(incomeEntries, person);

  const resetIncomeForm = () => {
    setIncomeAmount("");
    setIncomeSourceId("");
    setIncomeNotes("");
    setDepositType("debit");
    setDepositAccountId("");
    setEditIncomeId(null);
  };

  const handleAddSource = () => {
    if (!sourceName.trim()) return;
    if (editSourceId) {
      updateIncomeSource(editSourceId, sourceName.trim());
    } else {
      addIncomeSource(person, sourceName.trim());
    }
    setSourceName("");
    setEditSourceId(null);
    setShowAddSource(false);
  };

  const handleAddIncome = () => {
    const amount = parseFloat(incomeAmount);
    if (!amount || !incomeSourceId) return;

    const accountId =
      depositType === "cash"
        ? cashAccount?.id
        : depositAccountId;

    if (!accountId) return;

    if (editIncomeId) {
      updateIncome(editIncomeId, {
        amount,
        sourceId: incomeSourceId,
        date: incomeDate,
        notes: incomeNotes || undefined,
        depositType,
        depositAccountId: accountId,
      });
    } else {
      addIncome({
        person,
        sourceId: incomeSourceId,
        amount,
        date: incomeDate,
        notes: incomeNotes || undefined,
        depositType,
        depositAccountId: accountId,
      });
    }

    resetIncomeForm();
    setShowAddIncome(false);
  };

  const getDepositLabel = (entry: (typeof personEntries)[0]) => {
    const account = accounts.find((a) => a.id === entry.depositAccountId);
    if (entry.depositType === "cash") return "Cash Wallet";
    return account?.name ?? "Debit";
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Income</h2>
          <p className="text-muted mt-1">Track earnings by source</p>
        </div>
        <GlassButton onClick={() => setShowAddIncome(true)}>
          <Plus className="w-4 h-4" /> Add Income
        </GlassButton>
      </div>

      <PersonTabs value={person} onChange={setPerson} />

      <div className="grid grid-cols-2 gap-4">
        <GlassCard>
          <StatCard label="This Month" value={monthlyTotal} trend="up" />
        </GlassCard>
        <GlassCard>
          <StatCard label="This Year" value={yearlyTotal} />
        </GlassCard>
      </div>

      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Income Sources</h3>
          <GlassButton size="sm" variant="secondary" onClick={() => setShowAddSource(true)}>
            <Plus className="w-3 h-3" /> Add Source
          </GlassButton>
        </div>
        <div className="space-y-2">
          {personSources.map((source) => (
            <div key={source.id} className="flex items-center justify-between py-2 px-1">
              <span className="font-medium">{source.name}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setEditSourceId(source.id);
                    setSourceName(source.name);
                    setShowAddSource(true);
                  }}
                  className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Pencil className="w-4 h-4 text-muted" />
                </button>
                <button
                  onClick={() => deleteIncomeSource(source.id)}
                  className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Trash2 className="w-4 h-4 text-[#ff3b30]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="text-lg font-semibold mb-4">Recent Income</h3>
        {personEntries.length === 0 ? (
          <p className="text-sm text-muted">No income entries yet</p>
        ) : (
          <div className="space-y-3">
            {personEntries.map((entry) => {
              const source = incomeSources.find((s) => s.id === entry.sourceId);
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#007aff]/15 text-[#007aff]">
                        {PERSON_LABELS[entry.person]}
                      </span>
                      <p className="font-medium">{source?.name ?? "Unknown"}</p>
                    </div>
                    <p className="text-xs text-muted">
                      {formatDateTime(entry.date, entry.time, entry.timestamp)} · Deposited to {getDepositLabel(entry)}
                      {entry.notes && ` · ${entry.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#34c759]">
                      +{formatCurrency(entry.amount)}
                    </span>
                    <button
                      onClick={() => deleteIncome(entry.id)}
                      className="p-1.5 rounded-lg hover:bg-black/5"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-[#ff3b30]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <GlassModal
        open={showAddSource}
        onClose={() => { setShowAddSource(false); setEditSourceId(null); setSourceName(""); }}
        title={editSourceId ? "Edit Source" : "Add Income Source"}
      >
        <div className="space-y-4">
          <GlassInput
            label="Source Name"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="e.g. Freelance"
          />
          <GlassButton className="w-full" onClick={handleAddSource}>
            {editSourceId ? "Save" : "Add Source"}
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={showAddIncome}
        onClose={() => { setShowAddIncome(false); resetIncomeForm(); }}
        title={editIncomeId ? "Edit Income" : "Add Income"}
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted px-1">Source</label>
            <select
              value={incomeSourceId}
              onChange={(e) => setIncomeSourceId(e.target.value)}
              className="glass rounded-2xl px-4 py-3 w-full mt-1.5 outline-none"
            >
              <option value="">Select source</option>
              {personSources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <GlassInput
            label="Amount"
            type="number"
            value={incomeAmount}
            onChange={(e) => setIncomeAmount(e.target.value)}
            placeholder="0.00"
          />
          <GlassInput
            label="Date"
            type="date"
            value={incomeDate}
            onChange={(e) => setIncomeDate(e.target.value)}
          />

          <div>
            <label className="text-sm font-medium text-muted px-1 mb-2 block">
              Deposit To
            </label>
            <div className="glass rounded-2xl p-1 flex gap-1">
              <button
                onClick={() => { setDepositType("debit"); setDepositAccountId(""); }}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all",
                  depositType === "debit" ? "bg-[#007aff] text-white" : "text-muted"
                )}
              >
                <Wallet className="w-4 h-4" /> Debit
              </button>
              <button
                onClick={() => {
                  setDepositType("cash");
                  if (cashAccount) setDepositAccountId(cashAccount.id);
                }}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all",
                  depositType === "cash" ? "bg-[#007aff] text-white" : "text-muted"
                )}
              >
                <Banknote className="w-4 h-4" /> Cash
              </button>
            </div>
          </div>

          {depositType === "debit" && (
            <div>
              <label className="text-sm font-medium text-muted px-1">Debit Account</label>
              <select
                value={depositAccountId}
                onChange={(e) => setDepositAccountId(e.target.value)}
                className="glass rounded-2xl px-4 py-3 w-full mt-1.5 outline-none"
              >
                <option value="">Select debit account</option>
                {personDebitAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatCurrency(a.balance)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {depositType === "cash" && cashAccount && (
            <p className="text-sm text-muted px-1">
              Will be added to Cash Wallet (current: {formatCurrency(cashAccount.balance)})
            </p>
          )}

          <GlassInput
            label="Notes"
            value={incomeNotes}
            onChange={(e) => setIncomeNotes(e.target.value)}
            placeholder="Optional"
          />
          <GlassButton
            className="w-full"
            onClick={handleAddIncome}
            disabled={
              !incomeSourceId ||
              !incomeAmount ||
              (depositType === "debit" && !depositAccountId) ||
              (depositType === "cash" && !cashAccount)
            }
          >
            {editIncomeId ? "Save" : "Add Income"}
          </GlassButton>
        </div>
      </GlassModal>
    </div>
  );
}
