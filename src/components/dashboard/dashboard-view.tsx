"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { PersonTabs } from "@/components/ui/person-tabs";
import {
  ExpenseCategoryDonutChart,
  IncomeDonutChart,
  getIncomeSourceColor,
} from "@/components/dashboard/dashboard-charts";
import { SpendCategoryManager } from "@/components/spend/spend-category-manager";
import { useFinanceStore } from "@/store/finance-store";
import {
  getAvailableMonthKeys,
  getIncomeForPeriod,
  getMonthlyIncome,
  getPersonDebtOutstandingSummary,
  getPersonExpensesForPeriod,
  getWeeklyIncome,
  parseMonthKey,
} from "@/lib/calculations";
import { buildLearnedCategorySpending } from "@/lib/learn-spending-categories";
import { formatCurrency } from "@/lib/formatters";
import { PERSON_LABELS, type Person } from "@/types";
import { cn } from "@/lib/utils";
import { useLiveSync } from "@/hooks/use-live-sync";

const PERSON_ACCENT: Record<Person, string> = {
  kushvanth: "#007aff",
  grishma: "#af52de",
};

const DEBT_COLORS = ["#ff3b30", "#ff9500", "#ff2d55", "#af52de", "#5856d6", "#007aff"];

export function DashboardView() {
  const router = useRouter();
  const { incomeEntries, incomeSources, transactions, debts, spendCategories } =
    useFinanceStore();
  const { configured: syncConfigured, isLive, isSyncing, lastSyncedAt } = useLiveSync();
  const [person, setPerson] = useState<Person>("kushvanth");
  const [incomeView, setIncomeView] = useState<"monthly" | "weekly">("monthly");
  const [expenseView, setExpenseView] = useState<"monthly" | "weekly">("monthly");
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const currentMonthKey = format(new Date(), "yyyy-MM");

  const monthOptions = useMemo(
    () => getAvailableMonthKeys(transactions, incomeEntries),
    [transactions, incomeEntries]
  );

  const [monthKey, setMonthKey] = useState(currentMonthKey);

  useEffect(() => {
    if (!monthOptions.includes(monthKey)) {
      setMonthKey(monthOptions[0] ?? currentMonthKey);
    }
  }, [monthKey, monthOptions, currentMonthKey]);

  const selectedDate = useMemo(() => parseMonthKey(monthKey), [monthKey]);
  const accent = PERSON_ACCENT[person];
  const monthIndex = monthOptions.indexOf(monthKey);

  const outstandingDebts = useMemo(
    () => getPersonDebtOutstandingSummary(debts, person),
    [debts, person]
  );

  const incomeTotal = useMemo(
    () => getMonthlyIncome(incomeEntries, person, selectedDate),
    [incomeEntries, person, selectedDate]
  );

  const weeklyIncomeTotal = useMemo(
    () => getWeeklyIncome(incomeEntries, person),
    [incomeEntries, person]
  );

  const sourceNames = useMemo(
    () => Object.fromEntries(incomeSources.map((source) => [source.id, source.name])),
    [incomeSources]
  );

  const incomePeriodEntries = useMemo(() => {
    return incomeView === "weekly"
      ? getIncomeForPeriod(
          incomeEntries,
          person,
          startOfWeek(new Date(), { weekStartsOn: 1 }),
          endOfWeek(new Date(), { weekStartsOn: 1 })
        )
      : getIncomeForPeriod(
          incomeEntries,
          person,
          startOfMonth(selectedDate),
          endOfMonth(selectedDate)
        );
  }, [incomeEntries, person, selectedDate, incomeView]);

  const incomeBySource = useMemo(() => {
    const grouped = new Map<string, { amount: number; count: number }>();
    for (const entry of incomePeriodEntries) {
      const name = sourceNames[entry.sourceId] ?? "Unknown";
      const prev = grouped.get(name) ?? { amount: 0, count: 0 };
      grouped.set(name, { amount: prev.amount + entry.amount, count: prev.count + 1 });
    }
    return Array.from(grouped.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount);
  }, [incomePeriodEntries, sourceNames]);

  const incomePeriodTotal = useMemo(
    () => incomeBySource.reduce((sum, item) => sum + item.amount, 0),
    [incomeBySource]
  );

  const expensePeriodTransactions = useMemo(() => {
    return expenseView === "weekly"
      ? getPersonExpensesForPeriod(
          transactions,
          person,
          startOfWeek(new Date(), { weekStartsOn: 1 }),
          endOfWeek(new Date(), { weekStartsOn: 1 })
        )
      : getPersonExpensesForPeriod(
          transactions,
          person,
          startOfMonth(selectedDate),
          endOfMonth(selectedDate)
        );
  }, [transactions, person, selectedDate, expenseView]);

  const expensePeriodBounds = useMemo(() => {
    if (expenseView === "weekly") {
      return {
        start: startOfWeek(new Date(), { weekStartsOn: 1 }),
        end: endOfWeek(new Date(), { weekStartsOn: 1 }),
      };
    }
    return {
      start: startOfMonth(selectedDate),
      end: endOfMonth(selectedDate),
    };
  }, [expenseView, selectedDate]);

  const categoryInsights = useMemo(
    () =>
      buildLearnedCategorySpending(
        transactions,
        person,
        spendCategories,
        expensePeriodTransactions,
        expensePeriodBounds.start,
        expensePeriodBounds.end
      ),
    [
      transactions,
      person,
      spendCategories,
      expensePeriodTransactions,
      expensePeriodBounds.start,
      expensePeriodBounds.end,
    ]
  );

  const { spent: spentCategories, skipped: skippedCategories } = categoryInsights;

  const expensePeriodTotal = useMemo(
    () => spentCategories.reduce((sum, item) => sum + item.amount, 0),
    [spentCategories]
  );

  const periodLabel = expenseView === "weekly" ? "This week" : format(selectedDate, "MMMM");

  const openCategoryHistory = (category?: string) => {
    const params = new URLSearchParams({
      type: "expense",
      person,
    });
    if (category) params.set("category", category);
    router.push(`/history?${params.toString()}`);
  };

  const openIncomeHistory = (source?: string) => {
    const params = new URLSearchParams({
      type: "income",
      person,
    });
    if (source) params.set("category", source);
    router.push(`/history?${params.toString()}`);
  };

  const shiftMonth = (delta: number) => {
    const next = monthIndex + delta;
    if (next < 0 || next >= monthOptions.length) return;
    setMonthKey(monthOptions[next]!);
  };

  return (
    <div className="space-y-3 pb-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold leading-tight">Dashboard</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-muted">
              {PERSON_LABELS[person]} · {format(selectedDate, "MMMM yyyy")}
            </p>
            {syncConfigured && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  isLive && !isSyncing
                    ? "bg-[#34c759]/15 text-[#34c759]"
                    : isSyncing
                      ? "bg-[#007aff]/15 text-[#007aff]"
                      : "bg-black/5 text-muted dark:bg-white/10"
                )}
                title={
                  lastSyncedAt
                    ? `Last synced ${format(new Date(lastSyncedAt), "MMM d, h:mm a")}`
                    : "Waiting for first sync"
                }
              >
                {isSyncing ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                ) : (
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      isLive ? "bg-[#34c759]" : "bg-muted"
                    )}
                  />
                )}
                {isSyncing ? "Syncing" : isLive ? "Live" : "Sync"}
              </span>
            )}
          </div>
        </div>
        <Link
          href="/spend"
          className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
          style={{ backgroundColor: accent }}
        >
          <Plus className="w-3.5 h-3.5" />
          Spend
        </Link>
      </div>

      <PersonTabs
        value={person}
        onChange={setPerson}
        className="!rounded-xl !p-0.5 [&_button]:py-1.5 [&_button]:text-xs"
      />

      <div className="flex items-center justify-between glass rounded-xl px-1 py-1">
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          disabled={monthIndex >= monthOptions.length - 1}
          className="p-1.5 rounded-lg disabled:opacity-30"
          aria-label="Older month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value)}
          className="bg-transparent text-center font-semibold outline-none cursor-pointer text-xs"
        >
          {monthOptions.map((key) => (
            <option key={key} value={key}>
              {format(parseMonthKey(key), "MMM yyyy")}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          disabled={monthIndex <= 0}
          className="p-1.5 rounded-lg disabled:opacity-30"
          aria-label="Newer month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <GlassCard strong className="!p-3 border border-[#34c759]/20">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[#34c759]" />
              <p className="text-xs font-semibold">Income by source</p>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <p className="text-[10px] text-muted">This month</p>
                <p className="text-lg font-bold text-[#34c759] tabular-nums">+{formatCurrency(incomeTotal)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted">This week</p>
                <p className="text-lg font-bold text-[#34c759] tabular-nums">+{formatCurrency(weeklyIncomeTotal)}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openIncomeHistory()}
            className="text-[10px] text-[#007aff] font-medium shrink-0 mt-1"
          >
            View all
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">
            {incomeView === "weekly" ? "This week" : format(selectedDate, "MMMM yyyy")}
          </p>
          <div className="glass rounded-lg p-0.5 flex gap-0.5">
            {(["monthly", "weekly"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setIncomeView(mode)}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[10px] font-medium transition-all",
                  incomeView === mode ? "bg-[#34c759] text-white" : "text-muted"
                )}
              >
                {mode === "monthly" ? "Monthly" : "Weekly"}
              </button>
            ))}
          </div>
        </div>

        {incomeBySource.length === 0 ? (
          <p className="text-[11px] text-muted text-center py-6">No income recorded yet</p>
        ) : (
          <div className="space-y-3">
            <IncomeDonutChart
              segments={incomeBySource.map((item) => ({ name: item.name, amount: item.amount }))}
              onSliceClick={(source) => openIncomeHistory(source)}
              onCenterClick={() => openIncomeHistory()}
            />

            <div className="space-y-2 pt-1 border-t border-black/5 dark:border-white/10">
              {incomeBySource.map((item, index) => {
                const color = getIncomeSourceColor(index);
                const pct = incomePeriodTotal > 0 ? Math.round((item.amount / incomePeriodTotal) * 100) : 0;
                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => openIncomeHistory(item.name)}
                    className="w-full text-left rounded-xl px-2 py-2.5 hover:bg-[#34c759]/5 transition-colors border border-transparent hover:border-[#34c759]/20"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white/20"
                          style={{ backgroundColor: color }}
                        />
                        <p className="text-xs font-semibold truncate">{item.name}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-[#34c759] tabular-nums">+{formatCurrency(item.amount)}</p>
                        <p className="text-[10px] font-medium" style={{ color }}>{pct}%</p>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard strong className="!p-3 border border-[#ff3b30]/20">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Receipt className="w-3.5 h-3.5 text-[#ff3b30] shrink-0" />
            <p className="text-xs font-semibold truncate">Spending</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="glass rounded-lg p-0.5 flex gap-0.5">
              {(["monthly", "weekly"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setExpenseView(mode)}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] font-medium transition-all",
                    expenseView === mode ? "bg-[#ff3b30] text-white" : "text-muted"
                  )}
                >
                  {mode === "monthly" ? "Month" : "Week"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCategoryManagerOpen(true)}
              className="inline-flex items-center gap-1 text-[10px] text-[#007aff] font-medium"
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          </div>
        </div>

        <p className="text-xl font-bold text-[#ff3b30] tabular-nums mb-3">
          {formatCurrency(expensePeriodTotal)}
          <span className="text-[10px] font-medium text-muted ml-2">
            {expenseView === "weekly" ? "this week" : format(selectedDate, "MMMM yyyy")}
          </span>
        </p>

        {spentCategories.length > 0 ? (
          <>
            <ExpenseCategoryDonutChart
              compact
              segments={spentCategories.map((item) => ({
                name: item.name,
                amount: item.amount,
              }))}
              onSliceClick={(category) => openCategoryHistory(category)}
              onCenterClick={() => openCategoryHistory()}
            />

            <div className="mt-3 space-y-1.5">
              {spentCategories.slice(0, 6).map((item) => {
                const pct =
                  expensePeriodTotal > 0
                    ? Math.round((item.amount / expensePeriodTotal) * 100)
                    : 0;
                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => openCategoryHistory(item.name)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[#ff3b30]/5 text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-xs truncate">{item.name}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums shrink-0">
                      {formatCurrency(item.amount)}
                      <span className="text-muted font-normal ml-1">{pct}%</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted text-center py-8">
            No spending {expenseView === "weekly" ? "this week" : "this month"} yet
          </p>
        )}

        {skippedCategories.length > 0 && (
          <p className="text-[10px] text-muted mt-3 pt-3 border-t border-black/5 dark:border-white/10 leading-relaxed">
            {periodLabel} we didn&apos;t spend on{" "}
            <span className="text-foreground/80">{skippedCategories.join(", ")}</span>
          </p>
        )}
      </GlassCard>

      <GlassCard strong className="!p-3 border border-[#ff3b30]/20">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5 text-[#ff3b30]" />
              <p className="text-xs font-semibold">Debts owed</p>
            </div>
            <p className="text-xl font-bold text-[#ff3b30] tabular-nums mt-1">
              {formatCurrency(outstandingDebts.total)}
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              {outstandingDebts.activeCount} open · {outstandingDebts.creditCardBills} card bill{outstandingDebts.creditCardBills === 1 ? "" : "s"}
              {outstandingDebts.clearedDebts.length > 0 &&
                ` · ${outstandingDebts.clearedDebts.length} cleared`}
            </p>
          </div>
          <Link href="/debts" className="text-[10px] text-[#007aff] font-medium shrink-0 mt-1">
            Manage
          </Link>
        </div>

        {outstandingDebts.activeDebts.length === 0 && outstandingDebts.clearedDebts.length === 0 ? (
          <p className="text-[11px] text-muted text-center py-4">No debts tracked</p>
        ) : (
          <div className="space-y-3">
            {outstandingDebts.activeDebts.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wide">Open debts</p>
                {outstandingDebts.activeDebts.map((debt, index) => {
                  const color = DEBT_COLORS[index % DEBT_COLORS.length]!;
                  const pct =
                    outstandingDebts.total > 0
                      ? Math.round((debt.amount / outstandingDebts.total) * 100)
                      : 0;
                  return (
                    <Link
                      key={debt.id}
                      href="/debts"
                      className="block rounded-xl px-2 py-2.5 hover:bg-[#ff3b30]/5 transition-colors border border-transparent hover:border-[#ff3b30]/20"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-start gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 mt-0.5 ring-2 ring-white/20"
                            style={{ backgroundColor: color }}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{debt.name}</p>
                            {debt.linkedAccountId ? (
                              <p className="text-[10px] text-[#ff9500] font-medium">Credit card bill</p>
                            ) : (
                              <p className="text-[10px] text-muted">Personal / IOU</p>
                            )}
                            {debt.notes && (
                              <p className="text-[10px] text-muted line-clamp-2 mt-0.5">{debt.notes}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-[#ff3b30] tabular-nums">{formatCurrency(debt.amount)}</p>
                          <p className="text-[10px] font-medium" style={{ color }}>{pct}% of total</p>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {outstandingDebts.clearedDebts.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-black/5 dark:border-white/10">
                <p className="text-[10px] font-semibold text-[#34c759] uppercase tracking-wide">
                  Cleared ({outstandingDebts.clearedDebts.length})
                </p>
                {outstandingDebts.clearedDebts.map((debt) => (
                  <div
                    key={debt.id}
                    className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 bg-[#34c759]/5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate line-through opacity-70">{debt.name}</p>
                      {debt.notes && (
                        <p className="text-[10px] text-muted truncate">{debt.notes}</p>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-[#34c759] shrink-0">Cleared</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </GlassCard>

      <SpendCategoryManager
        open={categoryManagerOpen}
        onClose={() => setCategoryManagerOpen(false)}
      />
    </div>
  );
}
