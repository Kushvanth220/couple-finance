"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import Link from "next/link";
import { useFinanceStore } from "@/store/finance-store";
import {
  getUpcomingExpenseReminders,
  reminderKey,
} from "@/lib/monthly-expense-tracker";
import { formatCurrency } from "@/lib/formatters";
import { PERSON_LABELS } from "@/types";

const DISMISSED_KEY = "couple-finance-dismissed-reminders";
const NOTIFIED_KEY = "couple-finance-notified-reminders";

function loadSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

export function ExpenseReminderProvider() {
  const monthlyExpenses = useFinanceStore((s) => s.monthlyExpenses);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  const reminders = getUpcomingExpenseReminders(monthlyExpenses, 3);

  const visible = reminders.filter((r) => !dismissed.has(reminderKey(r.expense.id, r.dueDate)));

  useEffect(() => {
    setDismissed(loadSet(DISMISSED_KEY));
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (permission !== "granted" || reminders.length === 0) return;

    const notified = loadSet(NOTIFIED_KEY);
    let changed = false;

    for (const r of reminders) {
      const key = reminderKey(r.expense.id, r.dueDate);
      if (notified.has(key)) continue;

      const amount = r.expense.amount != null ? formatCurrency(r.expense.amount) : "Variable";
      new Notification(`Payment due: ${r.expense.name}`, {
        body: `${PERSON_LABELS[r.expense.person]} · ${amount} · ${r.label}`,
        icon: "/favicon.ico",
        tag: key,
      });
      notified.add(key);
      changed = true;
    }

    if (changed) saveSet(NOTIFIED_KEY, notified);
  }, [reminders, permission]);

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  const dismiss = (key: string) => {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    saveSet(DISMISSED_KEY, next);
  };

  if (visible.length === 0 && permission !== "default") return null;

  return (
    <div className="max-w-6xl mx-auto px-4 pt-3 space-y-2">
      {permission === "default" && (
        <div className="glass rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border border-[#ff9500]/30 bg-[#ff9500]/5">
          <div className="flex items-center gap-2 text-sm">
            <Bell className="w-4 h-4 text-[#ff9500]" />
            <span>Enable notifications for upcoming bill reminders</span>
          </div>
          <button
            onClick={requestPermission}
            className="text-xs font-semibold text-[#007aff] px-3 py-1.5 rounded-xl bg-[#007aff]/10"
          >
            Enable
          </button>
        </div>
      )}

      {visible.map((r) => {
        const key = reminderKey(r.expense.id, r.dueDate);
        return (
          <div
            key={key}
            className="glass rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border border-[#ff9500]/25 bg-[#ff9500]/5"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{r.expense.name}</p>
              <p className="text-xs text-muted">
                {PERSON_LABELS[r.expense.person]} ·{" "}
                {r.expense.amount != null ? formatCurrency(r.expense.amount) : "Variable"} ·{" "}
                <span className="text-[#ff9500] font-medium">{r.label}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/spend"
                className="text-xs font-semibold text-[#007aff] px-3 py-1.5 rounded-xl bg-[#007aff]/10"
              >
                Pay
              </Link>
              <button
                onClick={() => dismiss(key)}
                className="p-1.5 rounded-lg hover:bg-black/5"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4 text-muted" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
