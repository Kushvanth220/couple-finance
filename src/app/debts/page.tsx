"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, DollarSign } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { PersonTabs } from "@/components/ui/person-tabs";
import { StatCard } from "@/components/ui/stat-card";
import { useFinanceStore } from "@/store/finance-store";
import { getTotalDebt } from "@/lib/calculations";
import { formatCurrency } from "@/lib/formatters";
import type { Debt, Person } from "@/types";

export default function DebtsPage() {
  const {
    debts,
    accounts,
    addDebt,
    updateDebt,
    deleteDebt,
    payDebt,
  } = useFinanceStore();

  const [person, setPerson] = useState<Person>("kushvanth");
  const [showAdd, setShowAdd] = useState(false);
  const [showPay, setShowPay] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const personDebts = debts.filter((d) => d.person === person);
  const total = getTotalDebt(debts, person);
  const personDebitAccounts = accounts.filter(
    (a) => a.person === person && a.type === "debit"
  );

  const resetForm = () => {
    setName("");
    setAmount("");
    setEditId(null);
  };

  const handleSave = () => {
    const parsed = parseFloat(amount);
    if (!name.trim() || isNaN(parsed)) return;

    if (editId) {
      updateDebt(editId, { name: name.trim(), amount: parsed });
    } else {
      addDebt({ person, name: name.trim(), amount: parsed });
    }
    resetForm();
    setShowAdd(false);
  };

  const handlePay = () => {
    if (!showPay) return;
    const parsed = parseFloat(payAmount);
    if (!parsed || !fromAccountId) return;

    payDebt(showPay, parsed, fromAccountId, payNotes || undefined);
    setShowPay(null);
    setPayAmount("");
    setFromAccountId("");
    setPayNotes("");
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Debts</h2>
          <p className="text-muted mt-1">Track and pay down outstanding balances</p>
        </div>
        <GlassButton onClick={() => { resetForm(); setShowAdd(true); }}>
          <Plus className="w-4 h-4" /> Add Debt
        </GlassButton>
      </div>

      <PersonTabs value={person} onChange={setPerson} />

      <GlassCard>
        <StatCard label="Total Outstanding" value={total} trend="down" />
      </GlassCard>

      <div className="space-y-3">
        {personDebts.map((debt) => (
          <GlassCard key={debt.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{debt.name}</p>
                {debt.linkedAccountId && (
                  <p className="text-xs text-muted">Linked to credit card</p>
                )}
              </div>
              <p className="text-xl font-bold text-[#ff3b30]">
                {formatCurrency(debt.amount)}
              </p>
            </div>
            <div className="flex gap-2 mt-3">
              <GlassButton
                size="sm"
                variant="secondary"
                onClick={() => setShowPay(debt.id)}
              >
                <DollarSign className="w-3 h-3" /> Pay
              </GlassButton>
              <GlassButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditId(debt.id);
                  setName(debt.name);
                  setAmount(String(debt.amount));
                  setShowAdd(true);
                }}
              >
                <Pencil className="w-3 h-3" />
              </GlassButton>
              <GlassButton
                size="sm"
                variant="ghost"
                onClick={() => deleteDebt(debt.id)}
              >
                <Trash2 className="w-3 h-3 text-[#ff3b30]" />
              </GlassButton>
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassModal
        open={showAdd}
        onClose={() => { setShowAdd(false); resetForm(); }}
        title={editId ? "Edit Debt" : "Add Debt"}
      >
        <div className="space-y-4">
          <GlassInput label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <GlassInput
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <GlassButton className="w-full" onClick={handleSave}>
            {editId ? "Save" : "Add Debt"}
          </GlassButton>
        </div>
      </GlassModal>

      <GlassModal
        open={!!showPay}
        onClose={() => setShowPay(null)}
        title="Make Payment"
      >
        <div className="space-y-4">
          <GlassInput
            label="Payment Amount"
            type="number"
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
          />
          <div>
            <label className="text-sm font-medium text-muted px-1">Pay From</label>
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className="glass rounded-2xl px-4 py-3 w-full mt-1.5 outline-none"
            >
              <option value="">Select account</option>
              {personDebitAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type}) — {formatCurrency(a.balance)}
                </option>
              ))}
            </select>
          </div>
          <GlassInput
            label="Notes"
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
          />
          <GlassButton className="w-full" onClick={handlePay}>
            Confirm Payment
          </GlassButton>
        </div>
      </GlassModal>
    </div>
  );
}
