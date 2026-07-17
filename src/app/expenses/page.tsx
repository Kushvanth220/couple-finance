"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Check, Calendar } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { GlassModal } from "@/components/ui/glass-modal";
import { PersonTabs } from "@/components/ui/person-tabs";
import { StatCard } from "@/components/ui/stat-card";
import { useFinanceStore } from "@/store/finance-store";
import { getMonthExpenses, sumMonthlyExpenses } from "@/lib/calculations";
import {
  getDueDateForExpense,
  getMonthLabel,
  getMonthlyExpenseProgress,
} from "@/lib/monthly-expense-tracker";
import { formatCurrency } from "@/lib/formatters";
import type { MonthlyExpense, Person } from "@/types";

function formatDueLabel(expense: MonthlyExpense): string | null {
  const due = getDueDateForExpense(expense);
  if (!due) return null;
  if (!expense.isRecurring && expense.dueDate) {
    return due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return `Due on the ${due.getDate()}${ordinal(due.getDate())} each month`;
}

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export default function ExpensesPage() {
  const {
    monthlyExpenses,
    transactions,
    addMonthlyExpense,
    updateMonthlyExpense,
    deleteMonthlyExpense,
    markOneTimeExpensePaid,
  } = useFinanceStore();

  const [person, setPerson] = useState<Person>("kushvanth");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [isVariable, setIsVariable] = useState(false);
  const [isRecurring, setIsRecurring] = useState(true);
  const [oneTimeMonth, setOneTimeMonth] = useState("8");
  const [oneTimeYear, setOneTimeYear] = useState("2026");
  const [dueDayOfMonth, setDueDayOfMonth] = useState("1");
  const [dueDate, setDueDate] = useState("2026-08-01");

  const activeExpenses = getMonthExpenses(monthlyExpenses, person);
  const total = sumMonthlyExpenses(activeExpenses);

  const resetForm = () => {
    setName("");
    setAmount("");
    setIsVariable(false);
    setIsRecurring(true);
    setOneTimeMonth("8");
    setOneTimeYear("2026");
    setDueDayOfMonth("1");
    setDueDate("2026-08-01");
    setEditId(null);
  };

  const openEdit = (expense: MonthlyExpense) => {
    setEditId(expense.id);
    setName(expense.name);
    setAmount(expense.amount?.toString() ?? "");
    setIsVariable(expense.isVariable);
    setIsRecurring(expense.isRecurring);
    setOneTimeMonth(String(expense.oneTimeMonth ?? 8));
    setOneTimeYear(String(expense.oneTimeYear ?? 2026));
    setDueDayOfMonth(String(expense.dueDayOfMonth ?? 1));
    setDueDate(
      expense.dueDate ??
        `${expense.oneTimeYear ?? 2026}-${String(expense.oneTimeMonth ?? 8).padStart(2, "0")}-${String(expense.dueDayOfMonth ?? 1).padStart(2, "0")}`
    );
    setShowModal(true);
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const day = Math.min(31, Math.max(1, parseInt(dueDayOfMonth) || 1));

    const data = {
      person,
      name: name.trim(),
      amount: isVariable ? null : parseFloat(amount) || 0,
      isVariable,
      isRecurring,
      oneTimeMonth: isRecurring ? undefined : parseInt(oneTimeMonth),
      oneTimeYear: isRecurring ? undefined : parseInt(oneTimeYear),
      dueDayOfMonth: day,
      dueDate: isRecurring ? undefined : dueDate,
      isPaid: false,
    };

    if (editId) {
      updateMonthlyExpense(editId, data);
    } else {
      addMonthlyExpense(data);
    }

    resetForm();
    setShowModal(false);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Monthly Expenses</h2>
          <p className="text-muted mt-1">
            Planned costs for {getMonthLabel()} — payments reset each month
          </p>
        </div>
        <GlassButton onClick={() => { resetForm(); setShowModal(true); }}>
          <Plus className="w-4 h-4" /> Add
        </GlassButton>
      </div>

      <PersonTabs value={person} onChange={setPerson} />

      <GlassCard>
        <StatCard label="Monthly Total" value={total} subtitle={`${activeExpenses.length} items`} />
      </GlassCard>

      <GlassCard>
        <div className="space-y-1">
          {activeExpenses.map((expense) => {
            const progress = getMonthlyExpenseProgress(expense, transactions);
            const dueLabel = formatDueLabel(expense);

            return (
              <div
                key={expense.id}
                className="flex items-center justify-between py-3 border-b border-white/5 last:border-0 gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{expense.name}</p>
                    {!expense.isRecurring && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ff9500]/20 text-[#ff9500] font-medium">
                        One-time
                      </span>
                    )}
                    {expense.isVariable && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#5856d6]/20 text-[#5856d6] font-medium">
                        Variable
                      </span>
                    )}
                  </div>
                  {dueLabel && (
                    <p className="text-xs text-muted mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {dueLabel}
                    </p>
                  )}
                  {progress && (
                    <p className="text-xs mt-1">
                      <span className="text-[#34c759] font-medium">
                        {formatCurrency(progress.paidThisMonth)} paid
                      </span>
                      <span className="text-muted"> · </span>
                      <span className="text-[#ff9500] font-medium">
                        {formatCurrency(progress.remainingThisMonth)} remaining this month
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold text-right">
                    {expense.isVariable ? "Variable" : formatCurrency(expense.amount ?? 0)}
                  </span>
                  {!expense.isRecurring && !expense.isPaid && (
                    <button
                      onClick={() => markOneTimeExpensePaid(expense.id)}
                      className="p-1.5 rounded-lg hover:bg-[#34c759]/10"
                      title="Mark as paid"
                    >
                      <Check className="w-4 h-4 text-[#34c759]" />
                    </button>
                  )}
                  <button onClick={() => openEdit(expense)} className="p-1.5 rounded-lg hover:bg-black/5">
                    <Pencil className="w-3.5 h-3.5 text-muted" />
                  </button>
                  <button
                    onClick={() => deleteMonthlyExpense(expense.id)}
                    className="p-1.5 rounded-lg hover:bg-black/5"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-[#ff3b30]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <GlassModal
        open={showModal}
        onClose={() => { setShowModal(false); resetForm(); }}
        title={editId ? "Edit Expense" : "Add Expense"}
      >
        <div className="space-y-4">
          <GlassInput label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isVariable}
                onChange={(e) => setIsVariable(e.target.checked)}
                className="rounded"
              />
              Variable amount
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="rounded"
              />
              Recurring
            </label>
          </div>
          {!isVariable && (
            <GlassInput
              label="Monthly amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
          {isRecurring ? (
            <GlassInput
              label="Payment due day (of each month)"
              type="number"
              min="1"
              max="31"
              value={dueDayOfMonth}
              onChange={(e) => setDueDayOfMonth(e.target.value)}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <GlassInput
                  label="Month"
                  type="number"
                  min="1"
                  max="12"
                  value={oneTimeMonth}
                  onChange={(e) => setOneTimeMonth(e.target.value)}
                />
                <GlassInput
                  label="Year"
                  type="number"
                  value={oneTimeYear}
                  onChange={(e) => setOneTimeYear(e.target.value)}
                />
              </div>
              <GlassInput
                label="Payment due date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </>
          )}
          <GlassButton className="w-full" onClick={handleSave}>
            {editId ? "Save" : "Add Expense"}
          </GlassButton>
        </div>
      </GlassModal>
    </div>
  );
}
