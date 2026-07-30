"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Banknote,
  CreditCard,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { CompactPageShell } from "@/components/ui/compact-page-shell";
import { useFinanceStore } from "@/store/finance-store";
import {
  getAvailableCredit,
  getCreditUtilization,
  getMonthlyIncome,
  getWeeklyIncome,
} from "@/lib/calculations";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/formatters";
import { getAccountsForPerson, isSharedAccount } from "@/lib/accounts";
import { SharedAccountActivity } from "@/components/accounts/shared-account-activity";
import { CREDIT_LABELS } from "@/lib/inter-couple";
import { type Account, type Person } from "@/types";

const typeIcons = {
  credit: CreditCard,
  debit: Wallet,
  cash: Banknote,
};

export default function AccountsPage() {
  const {
    accounts,
    debts,
    incomeSources,
    incomeEntries,
    adjustAccountBalance,
    updateAccount,
    deleteAccount,
    addIncome,
    addIncomeSource,
    updateIncomeSource,
    deleteIncomeSource,
    deleteIncome,
  } = useFinanceStore();

  const [person, setPerson] = useState<Person>("kushvanth");
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [depositAccount, setDepositAccount] = useState<Account | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);

  const [newBalance, setNewBalance] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");

  const [depositAmount, setDepositAmount] = useState("");
  const [depositSourceId, setDepositSourceId] = useState("");
  const [depositNotes, setDepositNotes] = useState("");

  const [sourceName, setSourceName] = useState("");
  const [editSourceId, setEditSourceId] = useState<string | null>(null);

  const personAccounts = getAccountsForPerson(accounts, person);
  const personSources = incomeSources.filter((s) => s.person === person);
  const personEntries = useMemo(
    () =>
      incomeEntries
        .filter((e) => e.person === person)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "")),
    [incomeEntries, person]
  );

  const monthlyIncome = getMonthlyIncome(incomeEntries, person);
  const weeklyIncome = getWeeklyIncome(incomeEntries, person);

  const resetDepositForm = () => {
    setDepositAmount("");
    setDepositSourceId("");
    setDepositNotes("");
    setDepositAccount(null);
  };

  const resetAdjustForm = () => {
    setEditAccount(null);
    setNewBalance("");
    setNewLimit("");
    setAdjustNotes("");
  };

  const handleSaveCreditBalance = () => {
    if (!editAccount) return;
    const balance = parseFloat(newBalance);
    if (isNaN(balance)) return;

    adjustAccountBalance(editAccount.id, balance, adjustNotes || "Credit balance update");

    if (editAccount.type === "credit" && newLimit) {
      updateAccount(editAccount.id, { creditLimit: parseFloat(newLimit) });
    }

    resetAdjustForm();
  };

  const handleDeposit = () => {
    if (!depositAccount) return;
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0 || !depositSourceId) return;

    addIncome({
      person,
      sourceId: depositSourceId,
      amount,
      date: format(new Date(), "yyyy-MM-dd"),
      notes: depositNotes.trim() || undefined,
      depositType: depositAccount.type === "cash" ? "cash" : "debit",
      depositAccountId: depositAccount.id,
    });

    resetDepositForm();
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

  const handleDeleteAccount = (account: Account) => {
    const linkedDebt = debts.some((d) => d.linkedAccountId === account.id);
    if (linkedDebt) {
      alert("Cannot delete — this account is linked to a debt.");
      return;
    }
    if (confirm(`Delete ${account.name}?`)) {
      deleteAccount(account.id);
    }
  };

  const getDepositLabel = (accountId: string, depositType: "cash" | "debit") => {
    if (depositType === "cash") return "Cash Wallet";
    return accounts.find((a) => a.id === accountId)?.name ?? "Account";
  };

  return (
    <CompactPageShell
      title="Accounts"
      subtitle="Add money to debit or cash with an income source"
      person={person}
      onPersonChange={setPerson}
    >
      <GlassCard className="!p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-[#34c759]" />
          <p className="text-xs font-semibold">Income summary</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-muted uppercase tracking-wide">This month</p>
            <p className="text-lg font-bold text-[#34c759] tabular-nums">+{formatCurrency(monthlyIncome)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted uppercase tracking-wide">This week</p>
            <p className="text-lg font-bold text-[#34c759] tabular-nums">+{formatCurrency(weeklyIncome)}</p>
          </div>
        </div>
      </GlassCard>

      <div className="glass rounded-xl overflow-hidden">
        <div className="px-3 py-2 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
          <p className="text-xs font-semibold">Income sources</p>
          <button
            type="button"
            onClick={() => setShowAddSource(true)}
            className="text-[10px] text-[#007aff] font-medium"
          >
            + Add source
          </button>
        </div>
        <div className="divide-y divide-black/5 dark:divide-white/10">
          {personSources.length === 0 ? (
            <p className="text-xs text-muted px-3 py-3">Add sources like On campus, Gas station, Salary</p>
          ) : (
            personSources.map((source) => (
              <div key={source.id} className="flex items-center justify-between px-3 py-2 gap-2">
                <span className="text-xs font-medium">{source.name}</span>
                <div className="flex gap-0.5">
                  <button
                    onClick={() => {
                      setEditSourceId(source.id);
                      setSourceName(source.name);
                      setShowAddSource(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Pencil className="w-3.5 h-3.5 text-muted" />
                  </button>
                  <button
                    onClick={() => deleteIncomeSource(source.id)}
                    className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[#ff3b30]" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {(["credit", "debit", "cash"] as const).map((type) => {
        const typeAccounts = personAccounts.filter((a) => a.type === type);
        if (typeAccounts.length === 0) return null;
        const Icon = typeIcons[type];
        const typeLabel =
          type === "credit" ? "Credit Cards" : type === "debit" ? "Debit Accounts" : "Cash";

        return (
          <div key={type} className="space-y-1.5">
            <h3 className="text-[10px] font-semibold text-muted flex items-center gap-1.5 px-1 uppercase tracking-wide">
              <Icon className="w-3 h-3" /> {typeLabel}
            </h3>
            {typeAccounts.map((account) => (
              <GlassCard key={account.id} className="!p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold flex items-center gap-1.5 flex-wrap">
                      {account.name}
                      {isSharedAccount(account) ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#af52de]/15 text-[#af52de]">
                          Shared
                        </span>
                      ) : null}
                    </p>
                    {isSharedAccount(account) ? (
                      <p className="text-[10px] text-muted">Both of you use this account</p>
                    ) : null}
                    {account.type === "credit" && account.creditLimit != null && (
                      <p className="text-xs text-muted">
                        Limit: {formatCurrency(account.creditLimit)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {(account.type === "debit" || account.type === "cash") && (
                      <GlassButton
                        size="sm"
                        onClick={() => {
                          setDepositAccount(account);
                          setDepositAmount("");
                          setDepositSourceId("");
                          setDepositNotes("");
                        }}
                      >
                        <Plus className="w-3 h-3" /> Add money
                      </GlassButton>
                    )}
                    <button
                      onClick={() => {
                        setEditAccount(account);
                        setNewBalance(String(account.balance));
                        setNewLimit(String(account.creditLimit ?? ""));
                        setAdjustNotes("");
                      }}
                      className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                      title={account.type === "credit" ? "Update balance" : "Adjust balance"}
                    >
                      <Pencil className="w-4 h-4 text-muted" />
                    </button>
                    <button
                      onClick={() => handleDeleteAccount(account)}
                      className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Trash2 className="w-4 h-4 text-[#ff3b30]" />
                    </button>
                  </div>
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-muted">
                      {account.type === "credit" ? CREDIT_LABELS.cardBalance : "Balance"}
                    </p>
                    <p className="text-2xl font-bold">{formatCurrency(account.balance)}</p>
                  </div>
                  {account.type === "credit" && account.creditLimit != null && (
                    <div className="text-right">
                      <p className="text-xs text-muted">{CREDIT_LABELS.leftToSpend}</p>
                      <p className="font-semibold text-[#34c759]">
                        {formatCurrency(getAvailableCredit(account))}
                      </p>
                      <div className="mt-2 w-24 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#007aff] transition-all"
                          style={{
                            width: `${Math.min(100, getCreditUtilization(account))}%`,
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-muted mt-0.5">
                        {formatPercent(getCreditUtilization(account))} {CREDIT_LABELS.percentUsed}
                      </p>
                    </div>
                  )}
                </div>

                {isSharedAccount(account) ? (
                  <SharedAccountActivity accountId={account.id} accountName={account.name} />
                ) : null}
              </GlassCard>
            ))}
          </div>
        );
      })}

      <div className="glass rounded-xl overflow-hidden">
        <div className="px-3 py-2 border-b border-black/5 dark:border-white/10">
          <p className="text-xs font-semibold">Recent income</p>
        </div>
        {personEntries.length === 0 ? (
          <p className="text-xs text-muted p-4 text-center">Add money to a debit or cash account to record income</p>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {personEntries.slice(0, 8).map((entry) => {
              const source = incomeSources.find((s) => s.id === entry.sourceId);
              return (
                <div key={entry.id} className="flex items-center justify-between px-3 py-2 gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{source?.name ?? "Unknown"}</p>
                    <p className="text-[10px] text-muted truncate">
                      {formatDateTime(entry.date, entry.time, entry.timestamp)} ·{" "}
                      {getDepositLabel(entry.depositAccountId, entry.depositType)}
                      {entry.notes ? ` · ${entry.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs font-semibold text-[#34c759] tabular-nums">
                      +{formatCurrency(entry.amount)}
                    </span>
                    <button
                      onClick={() => deleteIncome(entry.id)}
                      className="p-1 rounded-lg hover:bg-black/5"
                    >
                      <Trash2 className="w-3 h-3 text-[#ff3b30]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <GlassModal
        open={!!depositAccount}
        onClose={resetDepositForm}
        title={`Add money · ${depositAccount?.name}`}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Where did this money come from? It will be added to the account and saved in History.
          </p>
          <GlassInput
            label="Amount"
            type="number"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="0.00"
          />
          <div>
            <label className="text-sm font-medium text-muted px-1">Income source</label>
            <select
              value={depositSourceId}
              onChange={(e) => setDepositSourceId(e.target.value)}
              className="glass rounded-2xl px-4 py-3 w-full mt-1.5 outline-none"
            >
              <option value="">Select source</option>
              {personSources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {personSources.length === 0 && (
              <button
                type="button"
                onClick={() => setShowAddSource(true)}
                className="text-[11px] text-[#007aff] font-medium mt-2 px-1"
              >
                + Add your first income source
              </button>
            )}
          </div>
          <GlassInput
            label="Note (optional)"
            value={depositNotes}
            onChange={(e) => setDepositNotes(e.target.value)}
            placeholder="e.g. Campus job shift, gas station refund"
          />
          {depositAccount && depositAmount && parseFloat(depositAmount) > 0 && depositSourceId && (
            <div className="rounded-xl bg-[#34c759]/5 border border-[#34c759]/20 px-3 py-2 text-xs">
              <p>
                {personSources.find((s) => s.id === depositSourceId)?.name} →{" "}
                {formatCurrency(parseFloat(depositAmount))} into {depositAccount.name}
              </p>
            </div>
          )}
          <GlassButton
            className="w-full"
            onClick={handleDeposit}
            disabled={!depositAmount || parseFloat(depositAmount) <= 0 || !depositSourceId}
          >
            Add & record income
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={!!editAccount}
        onClose={resetAdjustForm}
        title={`Adjust ${editAccount?.name}`}
      >
        <div className="space-y-4">
          {editAccount && (editAccount.type === "debit" || editAccount.type === "cash") && (
            <p className="text-xs text-muted">
              To add money with an income source, use <strong>Add money</strong> instead. Use this only to fix the balance.
            </p>
          )}
          <GlassInput
            label={editAccount?.type === "credit" ? CREDIT_LABELS.currentBalance : "Balance"}
            type="number"
            value={newBalance}
            onChange={(e) => setNewBalance(e.target.value)}
          />
          {editAccount?.type === "credit" && (
            <GlassInput
              label={CREDIT_LABELS.limit}
              type="number"
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
            />
          )}
          <GlassInput
            label="Reason"
            value={adjustNotes}
            onChange={(e) => setAdjustNotes(e.target.value)}
            placeholder="e.g. Balance correction"
          />
          <GlassButton className="w-full" onClick={handleSaveCreditBalance}>
            Save adjustment
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={showAddSource}
        onClose={() => { setShowAddSource(false); setEditSourceId(null); setSourceName(""); }}
        title={editSourceId ? "Edit source" : "Add income source"}
      >
        <div className="space-y-4">
          <GlassInput
            label="Source name"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="e.g. On campus, Gas station, Salary"
          />
          <GlassButton className="w-full" onClick={handleAddSource}>
            {editSourceId ? "Save" : "Add source"}
          </GlassButton>
        </div>
      </GlassModal>
    </CompactPageShell>
  );
}
