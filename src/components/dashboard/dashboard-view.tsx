"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Heart, Plus, X } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { PersonTabs } from "@/components/ui/person-tabs";
import {
  IncomeDonutChart,
  IncomeVsSpendChart,
  LeftTrendChart,
  SpendDonutChart,
} from "@/components/dashboard/dashboard-charts";
import { useFinanceStore } from "@/store/finance-store";
import {
  getAvailableMonthKeys,
  getIncomeForPeriod,
  getMonthlyIncome,
  getMonthlyOtherExpensesTotal,
  getMonthlySpendTotal,
  getPersonDebtAndBetweenUsSummary,
  getPersonOtherExpensesInMonth,
  getTrendMonths,
  groupIncomeBySource,
  getTransactionExpenseShare,
  parseMonthKey,
} from "@/lib/calculations";
import { compareByDateTime, formatCurrency, formatDateTime } from "@/lib/formatters";
import { getTransactionDisplayMessage } from "@/lib/transaction-messages";
import {
  PERSON_LABELS,
  type IncomeEntry,
  type InterCoupleEntry,
  type Person,
  type Transaction,
} from "@/types";
import { cn } from "@/lib/utils";

const PERSON_ACCENT: Record<Person, string> = {
  kushvanth: "#007aff",
  grishma: "#af52de",
};

type DetailSelection =
  | { kind: "kpi"; id: "income" | "spending" | "saved" | "cashflow" }
  | { kind: "spend-slice"; slice: "debt" | "other" }
  | { kind: "income-slice"; source: string }
  | { kind: "month"; monthKey: string; filter: "all" | "income" | "spend" };

export function DashboardView() {
  const { incomeEntries, incomeSources, transactions, interCoupleHistory } = useFinanceStore();
  const [person, setPerson] = useState<Person>("kushvanth");
  const [detail, setDetail] = useState<DetailSelection | null>(null);

  const monthOptions = useMemo(
    () => getAvailableMonthKeys(transactions, incomeEntries),
    [transactions, incomeEntries]
  );

  const [monthKey, setMonthKey] = useState(() => monthOptions[0] ?? format(new Date(), "yyyy-MM"));
  const selectedDate = useMemo(() => parseMonthKey(monthKey), [monthKey]);
  const accent = PERSON_ACCENT[person];
  const monthIndex = monthOptions.indexOf(monthKey);

  const debtSummary = useMemo(
    () => getPersonDebtAndBetweenUsSummary(transactions, interCoupleHistory, person, selectedDate),
    [transactions, interCoupleHistory, person, selectedDate]
  );

  const { debtPayments, interCoupleTransactions, betweenUsEntries, total: debtTotal } = debtSummary;

  const otherExpenses = useMemo(
    () => getPersonOtherExpensesInMonth(transactions, person, selectedDate),
    [transactions, person, selectedDate]
  );

  const incomeTotal = useMemo(
    () => getMonthlyIncome(incomeEntries, person, selectedDate),
    [incomeEntries, person, selectedDate]
  );

  const otherTotal = useMemo(
    () => getMonthlyOtherExpensesTotal(transactions, person, selectedDate),
    [transactions, person, selectedDate]
  );

  const spendTotal = debtTotal + otherTotal;
  const leftOver = incomeTotal - spendTotal;
  const savings = Math.max(0, leftOver);

  const sourceNames = useMemo(
    () => Object.fromEntries(incomeSources.map((source) => [source.id, source.name])),
    [incomeSources]
  );

  const monthIncomeEntries = useMemo(
    () =>
      getIncomeForPeriod(
        incomeEntries,
        person,
        startOfMonth(selectedDate),
        endOfMonth(selectedDate)
      ).sort(compareByDateTime),
    [incomeEntries, person, selectedDate]
  );

  const incomeSegments = useMemo(
    () =>
      groupIncomeBySource(monthIncomeEntries, sourceNames).sort((a, b) => b.amount - a.amount),
    [monthIncomeEntries, sourceNames]
  );

  const trendData = useMemo(
    () =>
      getTrendMonths(monthKey, 6).map(({ key, label, date }) => {
        const income = getMonthlyIncome(incomeEntries, person, date);
        const spend = getMonthlySpendTotal(transactions, person, date, interCoupleHistory);
        return { key, label, income, spend, left: income - spend };
      }),
    [monthKey, incomeEntries, person, transactions, interCoupleHistory]
  );

  const debtTransactions = useMemo(
    () => [...debtPayments, ...interCoupleTransactions].sort(compareByDateTime),
    [debtPayments, interCoupleTransactions]
  );

  const allMonthSpend = useMemo(
    () => [...debtTransactions, ...otherExpenses].sort(compareByDateTime),
    [debtTransactions, otherExpenses]
  );

  const topIncomeSourceNames = useMemo(
    () => new Set(incomeSegments.slice(0, 4).map((segment) => segment.name)),
    [incomeSegments]
  );

  const detailPanel = useMemo(() => {
    if (!detail) return null;

    if (detail.kind === "kpi") {
      if (detail.id === "income") {
        return {
          title: "Income this month",
          incomeEntries: monthIncomeEntries,
        };
      }
      if (detail.id === "spending") {
        return {
          title: "All spending this month",
          transactions: allMonthSpend,
          betweenUsEntries,
        };
      }
      if (detail.id === "saved" || detail.id === "cashflow") {
        return {
          title: detail.id === "saved" ? "What you saved" : "Cash flow this month",
          subtitle:
            leftOver >= 0
              ? `${formatCurrency(leftOver)} left after spending`
              : `${formatCurrency(Math.abs(leftOver))} over budget`,
          incomeEntries: monthIncomeEntries,
          transactions: allMonthSpend,
          betweenUsEntries,
        };
      }
    }

    if (detail.kind === "spend-slice") {
      if (detail.slice === "debt") {
        return {
          title: "Debt & Between Us",
          transactions: debtTransactions,
          betweenUsEntries,
        };
      }
      return {
        title: "Other spending",
        transactions: otherExpenses,
      };
    }

    if (detail.kind === "income-slice") {
      if (detail.source === "__all__") {
        return { title: "All income", incomeEntries: monthIncomeEntries };
      }
      if (detail.source === "__other__") {
        return {
          title: "Other income sources",
          incomeEntries: monthIncomeEntries.filter(
            (entry) => !topIncomeSourceNames.has(sourceNames[entry.sourceId] ?? "Unknown")
          ),
        };
      }
      return {
        title: detail.source,
        incomeEntries: monthIncomeEntries.filter(
          (entry) => (sourceNames[entry.sourceId] ?? "Unknown") === detail.source
        ),
      };
    }

    if (detail.kind === "month") {
      const date = parseMonthKey(detail.monthKey);
      const monthIncome = getIncomeForPeriod(
        incomeEntries,
        person,
        startOfMonth(date),
        endOfMonth(date)
      ).sort(compareByDateTime);
      const monthDebt = getPersonDebtAndBetweenUsSummary(
        transactions,
        interCoupleHistory,
        person,
        date
      );
      const monthOther = getPersonOtherExpensesInMonth(transactions, person, date);
      const monthSpend = [...monthDebt.debtPayments, ...monthDebt.interCoupleTransactions, ...monthOther].sort(
        compareByDateTime
      );

      if (detail.filter === "income") {
        return {
          title: `Income · ${format(date, "MMM yyyy")}`,
          incomeEntries: monthIncome,
        };
      }
      if (detail.filter === "spend") {
        return {
          title: `Spending · ${format(date, "MMM yyyy")}`,
          transactions: monthSpend,
          betweenUsEntries: monthDebt.betweenUsEntries,
        };
      }
      return {
        title: `Activity · ${format(date, "MMM yyyy")}`,
        incomeEntries: monthIncome,
        transactions: monthSpend,
        betweenUsEntries: monthDebt.betweenUsEntries,
      };
    }

    return null;
  }, [
    detail,
    monthIncomeEntries,
    allMonthSpend,
    betweenUsEntries,
    leftOver,
    debtTransactions,
    otherExpenses,
    topIncomeSourceNames,
    sourceNames,
    incomeEntries,
    person,
    transactions,
    interCoupleHistory,
  ]);

  const shiftMonth = (delta: number) => {
    const next = monthIndex + delta;
    if (next < 0 || next >= monthOptions.length) return;
    setMonthKey(monthOptions[next]!);
    setDetail(null);
  };

  const activeSpendSlice =
    detail?.kind === "spend-slice" ? detail.slice : null;
  const activeIncomeSlice =
    detail?.kind === "income-slice" ? detail.source : null;
  const activeMonthKey = detail?.kind === "month" ? detail.monthKey : null;

  return (
    <div className="space-y-3 pb-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold leading-tight">Dashboard</h1>
          <p className="text-xs text-muted">
            {PERSON_LABELS[person]} · {format(selectedDate, "MMMM yyyy")}
          </p>
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
        onChange={(p) => {
          setPerson(p);
          setDetail(null);
        }}
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
          onChange={(e) => {
            setMonthKey(e.target.value);
            setDetail(null);
          }}
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

      <div className="grid grid-cols-2 gap-2">
        <KpiCard
          label="Income"
          value={incomeTotal}
          color="#34c759"
          prefix="+"
          active={detail?.kind === "kpi" && detail.id === "income"}
          onClick={() => setDetail({ kind: "kpi", id: "income" })}
        />
        <KpiCard
          label="Spending"
          value={spendTotal}
          color="#ff3b30"
          prefix="-"
          active={detail?.kind === "kpi" && detail.id === "spending"}
          onClick={() => setDetail({ kind: "kpi", id: "spending" })}
        />
        <KpiCard
          label="Saved"
          value={savings}
          color="#ffcc00"
          active={detail?.kind === "kpi" && detail.id === "saved"}
          onClick={() => setDetail({ kind: "kpi", id: "saved" })}
        />
        <KpiCard
          label="Cash flow"
          value={leftOver}
          color={leftOver >= 0 ? "#34c759" : "#ff3b30"}
          prefix={leftOver >= 0 ? "+" : "-"}
          absolute
          active={detail?.kind === "kpi" && detail.id === "cashflow"}
          onClick={() => setDetail({ kind: "kpi", id: "cashflow" })}
        />
      </div>

      {detailPanel && (
        <DetailPanel
          title={detailPanel.title}
          subtitle={detailPanel.subtitle}
          onClose={() => setDetail(null)}
          incomeEntries={detailPanel.incomeEntries}
          transactions={detailPanel.transactions}
          betweenUsEntries={detailPanel.betweenUsEntries}
          person={person}
          sourceNames={sourceNames}
        />
      )}

      <ChartCard title="Income vs spending" subtitle="Tap a bar for that month">
        <IncomeVsSpendChart
          data={trendData}
          activeKey={activeMonthKey}
          onBarClick={(key, series) =>
            setDetail({
              kind: "month",
              monthKey: key,
              filter: series === "income" ? "income" : "spend",
            })
          }
        />
      </ChartCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ChartCard title="Where it went" subtitle="Tap a slice for payments">
          <SpendDonutChart
            debt={debtTotal}
            other={otherTotal}
            activeSlice={activeSpendSlice}
            onSliceClick={(slice) => setDetail({ kind: "spend-slice", slice })}
            onCenterClick={() => setDetail({ kind: "kpi", id: "spending" })}
          />
        </ChartCard>
        <ChartCard title="Income sources" subtitle="Tap a slice for pay">
          <IncomeDonutChart
            segments={incomeSegments}
            activeSlice={activeIncomeSlice}
            onSliceClick={(source) => setDetail({ kind: "income-slice", source })}
          />
        </ChartCard>
      </div>

      <ChartCard title="Money left trend" subtitle="Tap a dot for that month">
        <LeftTrendChart
          data={trendData}
          activeKey={activeMonthKey}
          onPointClick={(key) => setDetail({ kind: "month", monthKey: key, filter: "all" })}
        />
      </ChartCard>
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
  prefix,
  absolute,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  prefix?: string;
  absolute?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const display = absolute ? Math.abs(value) : value;

  return (
    <button type="button" onClick={onClick} className="text-left w-full">
      <GlassCard
        className={cn(
          "!p-3 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]",
          active && "ring-2 ring-[#007aff]/40"
        )}
      >
        <p className="text-[10px] uppercase tracking-wide text-muted font-semibold">{label}</p>
        <p className="text-lg font-bold tabular-nums mt-1 leading-none" style={{ color }}>
          {prefix}
          {formatCurrency(display)}
        </p>
      </GlassCard>
    </button>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <GlassCard className="!p-3">
      <div className="mb-2">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[10px] text-muted">{subtitle}</p>
      </div>
      {children}
    </GlassCard>
  );
}

function DetailPanel({
  title,
  subtitle,
  onClose,
  incomeEntries,
  transactions,
  betweenUsEntries,
  person,
  sourceNames,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  incomeEntries?: IncomeEntry[];
  transactions?: Transaction[];
  betweenUsEntries?: InterCoupleEntry[];
  person: Person;
  sourceNames: Record<string, string>;
}) {
  return (
    <GlassCard className="!p-0 overflow-hidden animate-fade-in-up ring-2 ring-[#007aff]/25">
      <div className="px-3 py-2 border-b border-black/5 dark:border-white/10 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">{title}</p>
          {subtitle && <p className="text-[10px] text-muted mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 shrink-0"
          aria-label="Close list"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <EntryList
        incomeEntries={incomeEntries}
        transactions={transactions}
        betweenUsEntries={betweenUsEntries}
        person={person}
        sourceNames={sourceNames}
      />
    </GlassCard>
  );
}

function EntryList({
  incomeEntries,
  transactions,
  betweenUsEntries,
  person,
  sourceNames,
}: {
  incomeEntries?: IncomeEntry[];
  transactions?: Transaction[];
  betweenUsEntries?: InterCoupleEntry[];
  person: Person;
  sourceNames: Record<string, string>;
}) {
  const linkedIds = new Set((transactions ?? []).map((t) => t.id));
  const extraBetween = (betweenUsEntries ?? []).filter(
    (e) => !e.sourceTransactionId || !linkedIds.has(e.sourceTransactionId)
  );

  const hasItems =
    (incomeEntries?.length ?? 0) + (transactions?.length ?? 0) + extraBetween.length > 0;

  if (!hasItems) {
    return <p className="text-xs text-muted text-center py-6">Nothing here</p>;
  }

  return (
    <div className="max-h-56 overflow-y-auto divide-y divide-black/5 dark:divide-white/10">
      {incomeEntries?.map((entry) => (
        <div key={entry.id} className="px-3 py-2 flex justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">{sourceNames[entry.sourceId] ?? "Income"}</p>
            <p className="text-[10px] text-muted">
              {formatDateTime(entry.date, entry.time, entry.timestamp)}
            </p>
          </div>
          <span className="text-xs text-[#34c759] font-semibold shrink-0 tabular-nums">
            +{formatCurrency(entry.amount)}
          </span>
        </div>
      ))}

      {transactions?.map((tx) => (
        <div key={tx.id} className="px-3 py-2 flex justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs leading-snug line-clamp-2">{getTransactionDisplayMessage(tx)}</p>
            <p className="text-[10px] text-muted mt-0.5">
              {formatDateTime(tx.date, tx.time, tx.timestamp)}
            </p>
          </div>
          <span className="text-xs font-semibold shrink-0 tabular-nums">
            -
            {formatCurrency(
              tx.type === "expense" ? getTransactionExpenseShare(tx, person) : tx.amount
            )}
          </span>
        </div>
      ))}

      {extraBetween.map((entry) => (
        <div
          key={entry.id}
          className="px-3 py-2 flex justify-between gap-2 border-l-2 border-[#af52de]/40 ml-3"
        >
          <div className="min-w-0 flex gap-1">
            <Heart className="w-3 h-3 text-[#ff2d55] shrink-0 mt-0.5" />
            <div>
              <p className="text-xs leading-snug line-clamp-2 text-[#af52de]">
                {entry.autoMessage ??
                  `${PERSON_LABELS[entry.paidBy]} → ${PERSON_LABELS[entry.benefited]}`}
              </p>
              <p className="text-[10px] text-muted mt-0.5">
                {formatDateTime(entry.date, entry.time, entry.timestamp)}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold shrink-0 tabular-nums text-[#af52de]">
            {entry.paidBy === person ? "-" : ""}
            {formatCurrency(entry.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}
