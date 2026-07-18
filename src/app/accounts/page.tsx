"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, CreditCard, Wallet, Banknote } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { PersonTabs } from "@/components/ui/person-tabs";
import { useFinanceStore } from "@/store/finance-store";
import { getAvailableCredit, getCreditUtilization } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { CREDIT_LABELS } from "@/lib/inter-couple";
import { PERSON_LABELS, type Account, type AccountType, type Person } from "@/types";
import { cn } from "@/lib/utils";

const typeIcons = {
  credit: CreditCard,
  debit: Wallet,
  cash: Banknote,
};

export default function AccountsPage() {
  const { accounts, adjustAccountBalance, updateAccount, addAccount, deleteAccount, debts } =
    useFinanceStore();
  const [person, setPerson] = useState<Person>("kushvanth");
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newBalance, setNewBalance] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [notes, setNotes] = useState("");

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AccountType>("debit");
  const [initialBalance, setInitialBalance] = useState("0");
  const [initialLimit, setInitialLimit] = useState("");

  const personAccounts = accounts.filter((a) => a.person === person);

  const handleSaveBalance = () => {
    if (!editAccount) return;
    const balance = parseFloat(newBalance);
    if (isNaN(balance)) return;

    adjustAccountBalance(editAccount.id, balance, notes || "Manual balance update");

    if (editAccount.type === "credit" && newLimit) {
      updateAccount(editAccount.id, { creditLimit: parseFloat(newLimit) });
    }

    setEditAccount(null);
    setNewBalance("");
    setNewLimit("");
    setNotes("");
  };

  const handleAddAccount = () => {
    if (!newName.trim()) return;
    const balance = parseFloat(initialBalance) || 0;

    addAccount({
      person,
      name: newName.trim(),
      type: newType,
      balance,
      creditLimit: newType === "credit" ? parseFloat(initialLimit) || 0 : undefined,
    });

    setNewName("");
    setNewType("debit");
    setInitialBalance("0");
    setInitialLimit("");
    setShowAdd(false);
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

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Accounts</h2>
          <p className="text-muted mt-1">Credit cards, debit accounts & cash wallets</p>
        </div>
        <GlassButton onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> Add Account
        </GlassButton>
      </div>

      <PersonTabs value={person} onChange={setPerson} />

      {(["credit", "debit", "cash"] as const).map((type) => {
        const typeAccounts = personAccounts.filter((a) => a.type === type);
        if (typeAccounts.length === 0) return null;
        const Icon = typeIcons[type];
        const typeLabel =
          type === "credit" ? "Credit Cards" : type === "debit" ? "Debit Accounts" : "Cash";

        return (
          <div key={type} className="space-y-3">
            <h3 className="text-sm font-medium text-muted flex items-center gap-2 px-1">
              <Icon className="w-4 h-4" /> {typeLabel}
            </h3>
            {typeAccounts.map((account) => (
              <GlassCard key={account.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{account.name}</p>
                    {account.type === "credit" && account.creditLimit != null && (
                      <p className="text-xs text-muted">
                        Limit: {formatCurrency(account.creditLimit)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setEditAccount(account);
                        setNewBalance(String(account.balance));
                        setNewLimit(String(account.creditLimit ?? ""));
                      }}
                      className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
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
              </GlassCard>
            ))}
          </div>
        );
      })}

      <GlassModal
        open={!!editAccount}
        onClose={() => setEditAccount(null)}
        title={`Update ${editAccount?.name}`}
      >
        <div className="space-y-4">
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
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Salary received, ATM withdrawal"
          />
          <GlassButton className="w-full" onClick={handleSaveBalance}>
            Update Balance
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={`Add Account for ${PERSON_LABELS[person]}`}
      >
        <div className="space-y-4">
          <GlassInput
            label="Account Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Chase, Venmo"
          />

          <div>
            <label className="text-sm font-medium text-muted px-1 mb-2 block">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(["credit", "debit", "cash"] as AccountType[]).map((type) => {
                const Icon = typeIcons[type];
                return (
                  <button
                    key={type}
                    onClick={() => setNewType(type)}
                    className={cn(
                      "glass rounded-xl py-3 flex flex-col items-center gap-1 text-xs font-medium transition-all",
                      newType === type && "ring-2 ring-[#007aff]"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          <GlassInput
            label={newType === "credit" ? CREDIT_LABELS.initialBalance : "Initial Balance"}
            type="number"
            value={initialBalance}
            onChange={(e) => setInitialBalance(e.target.value)}
          />

          {newType === "credit" && (
            <GlassInput
              label={CREDIT_LABELS.limit}
              type="number"
              value={initialLimit}
              onChange={(e) => setInitialLimit(e.target.value)}
            />
          )}

          <GlassButton className="w-full" onClick={handleAddAccount} disabled={!newName.trim()}>
            Add Account
          </GlassButton>
        </div>
      </GlassModal>
    </div>
  );
}
