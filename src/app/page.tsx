"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Heart,
  ArrowUpRight,
  PiggyBank,
  Landmark,
  Sparkles,
  Bell,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { GrikLogo } from "@/components/layout/grik-logo";
import { useFinanceStore } from "@/store/finance-store";
import {
  getAccountBalances,
  getAvailableCredit,
  getCreditUtilization,
  getMonthExpenses,
  getMonthlyIncome,
  getNetWorth,
  getTotalDebt,
  getTransactionsForMonth,
  groupExpensesByCategory,
  sumMonthlyExpenses,
} from "@/lib/calculations";
import { formatCurrency, formatDateTime, compareByDateTime } from "@/lib/formatters";
import {
  getTransactionDisplayMessage,
  getTransactionActor,
} from "@/lib/transaction-messages";
import { getUpcomingExpenseReminders } from "@/lib/monthly-expense-tracker";
import { PERSON_LABELS, type Person } from "@/types";
import { cn } from "@/lib/utils";

const PERSON_GRADIENT: Record<Person, string> = {
  kushvanth: "from-[#007aff]/20 via-[#007aff]/5 to-transparent",
  grishma: "from-[#af52de]/20 via-[#af52de]/5 to-transparent",
};

const PERSON_ACCENT: Record<Person, string> = {
  kushvanth: "#007aff",
  grishma: "#af52de",
};

export default function DashboardPage() {
  const {
    incomeEntries,
    monthlyExpenses,
    accounts,
    debts,
    transactions,
    interCoupleBalance,
  } = useFinanceStore();

  const now = useMemo(() => new Date(), []);

  const stats = useMemo(() => {
    const kushIncome = getMonthlyIncome(incomeEntries, "kushvanth", now);
    const grishIncome = getMonthlyIncome(incomeEntries, "grishma", now);
    const householdIncome = kushIncome + grishIncome;

    const kushPlanned = sumMonthlyExpenses(getMonthExpenses(monthlyExpenses, "kushvanth", now));
    const grishPlanned = sumMonthlyExpenses(getMonthExpenses(monthlyExpenses, "grishma", now));

    const monthTx = getTransactionsForMonth(transactions, now);
    const actualExpenses = monthTx
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);

    const remaining = householdIncome - actualExpenses;
    const savingsRate = householdIncome > 0 ? (remaining / householdIncome) * 100 : 0;
    const budgetUsed = householdIncome > 0 ? (actualExpenses / householdIncome) * 100 : 0;

    return {
      kushIncome,
      grishIncome,
      householdIncome,
      kushPlanned,
      grishPlanned,
      householdPlanned: kushPlanned + grishPlanned,
      actualExpenses,
      remaining,
      savingsRate,
      budgetUsed,
      netWorth: getNetWorth(accounts, debts, null),
      totalCash: getAccountBalances(accounts, null, "cash"),
      totalDebit: getAccountBalances(accounts, null, "debit"),
      totalDebt: getTotalDebt(debts, null),
      kushNet: getNetWorth(accounts, debts, "kushvanth"),
      grishNet: getNetWorth(accounts, debts, "grishma"),
      kushDebt: getTotalDebt(debts, "kushvanth"),
      grishDebt: getTotalDebt(debts, "grishma"),
    };
  }, [incomeEntries, monthlyExpenses, accounts, debts, transactions, now]);

  const dueSoon = useMemo(
    () => getUpcomingExpenseReminders(monthlyExpenses, 7, now),
    [monthlyExpenses, now]
  );

  const trendData = useMemo(() => {
    const months: { month: string; income: number; expenses: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: d.toLocaleDateString("en-US", { month: "short" }),
        income: getMonthlyIncome(incomeEntries, null, d),
        expenses: getTransactionsForMonth(transactions, d)
          .filter((t) => t.type === "expense")
          .reduce((s, t) => s + t.amount, 0),
      });
    }
    return months;
  }, [incomeEntries, transactions, now]);

  const creditAccounts = accounts.filter((a) => a.type === "credit");
  const expenseByCategory = groupExpensesByCategory(
    getTransactionsForMonth(transactions, now)
  ).slice(0, 5);

  const recentActivity = useMemo(
    () => [...transactions].sort(compareByDateTime).slice(0, 6),
    [transactions]
  );

  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";

  return (
    <div className="space-y-5 animate-fade-in-up pb-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted font-medium">{greeting}</p>
          <div className="mt-1">
            <GrikLogo size="hero" asLink={false} showSubtitle={false} />
          </div>
          <p className="text-sm text-muted mt-2">
            {now.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <Link
          href="/spend"
          className="glass rounded-2xl px-4 py-2.5 text-sm font-semibold text-[#007aff] flex items-center gap-1.5 hover:scale-[1.02] transition-transform"
        >
          <Wallet className="w-4 h-4" /> Spend
        </Link>
      </div>

      <div className="relative overflow-hidden rounded-[28px] glass-strong p-6 md:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-[#007aff]/15 via-[#5856d6]/10 to-[#34c759]/10 pointer-events-none" />
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[#007aff]/10 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Sparkles className="w-4 h-4 text-[#007aff]" />
            Household net worth
          </div>
          <p className="text-4xl md:text-5xl font-bold tracking-tight">
            {formatCurrency(stats.netWorth)}
          </p>
          <div className="flex flex-wrap gap-4 mt-5">
            <HeroPill icon={TrendingUp} label="Income" value={stats.householdIncome} positive />
            <HeroPill icon={TrendingDown} label="Spent" value={stats.actualExpenses} />
            <HeroPill
              icon={PiggyBank}
              label="Remaining"
              value={stats.remaining}
              positive={stats.remaining >= 0}
            />
          </div>
          <div className="mt-6 flex items-center gap-4">
            <div className="relative w-16 h-16 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.1"
                  strokeWidth="3"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke="#007aff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.min(100, stats.budgetUsed)} 100`}
                  pathLength="100"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
                {Math.round(stats.budgetUsed)}%
              </span>
            </div>
            <div>
              <p className="text-sm font-medium">Monthly budget used</p>
              <p className="text-xs text-muted">
                {formatCurrency(stats.actualExpenses)} of{" "}
                {formatCurrency(stats.householdIncome)} income ·{" "}
                {stats.savingsRate.toFixed(0)}% savings rate
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <PersonCard
          person="kushvanth"
          income={stats.kushIncome}
          planned={stats.kushPlanned}
          netWorth={stats.kushNet}
          debt={stats.kushDebt}
        />
        <PersonCard
          person="grishma"
          income={stats.grishIncome}
          planned={stats.grishPlanned}
          netWorth={stats.grishNet}
          debt={stats.grishDebt}
        />
        <Link href="/between" className="block group">
          <GlassCard
            strong
            className="h-full bg-gradient-to-br from-[#ff2d55]/10 to-[#ff9500]/5 border-[#ff2d55]/20 group-hover:scale-[1.01] transition-transform"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-[#ff2d55]/20 flex items-center justify-center">
                <Heart className="w-5 h-5 text-[#ff2d55]" />
              </div>
              <div>
                <p className="text-sm font-semibold">Between Us</p>
                <p className="text-[10px] text-muted">Money owed</p>
              </div>
            </div>
            <p className="text-2xl font-bold text-[#007aff]">
              {formatCurrency(interCoupleBalance)}
            </p>
            <p className="text-xs text-muted mt-1">Grishma owes Kushvanth</p>
            <p className="text-xs text-[#007aff] mt-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              View history <ArrowUpRight className="w-3 h-3" />
            </p>
          </GlassCard>
        </Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <GlassCard className="lg:col-span-2 p-0 overflow-hidden">
          <div className="p-5 pb-2 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Cash flow</h3>
              <p className="text-xs text-muted">Last 6 months</p>
            </div>
            <div className="flex gap-3 text-[10px] font-medium">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#34c759]" /> Income
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#ff3b30]" /> Expenses
              </span>
            </div>
          </div>
          <div className="h-52 px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="dashIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34c759" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#34c759" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dashExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff3b30" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#ff3b30" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v))}
                  contentStyle={{
                    background: "rgba(255,255,255,0.85)",
                    border: "none",
                    borderRadius: 14,
                    backdropFilter: "blur(20px)",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  stroke="#34c759"
                  fill="url(#dashIncome)"
                  strokeWidth={2.5}
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  stroke="#ff3b30"
                  fill="url(#dashExpense)"
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#34c759]/15 flex items-center justify-center">
              <Wallet className="w-6 h-6 text-[#34c759]" />
            </div>
            <div>
              <p className="text-xs text-muted">Total cash</p>
              <p className="text-xl font-bold">{formatCurrency(stats.totalCash)}</p>
            </div>
          </GlassCard>
          <GlassCard className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#007aff]/15 flex items-center justify-center">
              <Landmark className="w-6 h-6 text-[#007aff]" />
            </div>
            <div>
              <p className="text-xs text-muted">Total debit</p>
              <p className="text-xl font-bold">{formatCurrency(stats.totalDebit)}</p>
            </div>
          </GlassCard>
          <GlassCard className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#ff3b30]/15 flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-[#ff3b30]" />
            </div>
            <div>
              <p className="text-xs text-muted">Total debt</p>
              <p className="text-xl font-bold text-[#ff3b30]">
                {formatCurrency(stats.totalDebt)}
              </p>
            </div>
          </GlassCard>
        </div>
      </div>

      {dueSoon.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 px-1 flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#ff9500]" />
            Payments due soon
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {dueSoon.map((r) => (
              <Link
                key={`${r.expense.id}-${r.dueDate.toISOString()}`}
                href="/spend"
                className="glass rounded-2xl px-4 py-3 border border-[#ff9500]/20 hover:border-[#ff9500]/40 transition-colors"
              >
                <p className="font-semibold text-sm">{r.expense.name}</p>
                <p className="text-xs text-muted mt-0.5">
                  {PERSON_LABELS[r.expense.person]} ·{" "}
                  {r.expense.amount != null ? formatCurrency(r.expense.amount) : "Variable"}
                </p>
                <p className="text-xs text-[#ff9500] font-medium mt-1">{r.label}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-3 px-1">Credit cards</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {creditAccounts.map((account) => {
            const util = getCreditUtilization(account);
            const avail = getAvailableCredit(account);
            return (
              <div
                key={account.id}
                className="relative overflow-hidden rounded-[22px] p-4 min-h-[120px] glass-strong"
                style={{
                  background: `linear-gradient(135deg, ${PERSON_ACCENT[account.person]}22, transparent 60%)`,
                }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[10px] font-medium text-muted uppercase tracking-wide">
                      {PERSON_LABELS[account.person]}
                    </p>
                    <p className="font-semibold mt-0.5">{account.name}</p>
                  </div>
                  <CreditCard className="w-5 h-5 opacity-40" />
                </div>
                <p className="text-2xl font-bold mt-4">{formatCurrency(account.balance)}</p>
                <p className="text-[10px] text-muted mt-0.5">
                  {formatCurrency(avail)} available
                </p>
                <div className="mt-3 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, util)}%`,
                      backgroundColor:
                        util > 70 ? "#ff3b30" : util > 40 ? "#ff9500" : "#34c759",
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted mt-1">{util.toFixed(0)}% utilized</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent activity</h3>
            <Link href="/history" className="text-xs text-[#007aff] font-medium">
              See all
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">
              No activity yet — record a spend!
            </p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((tx) => (
                <div key={tx.id} className="flex items-start gap-3">
                  <span
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg shrink-0 mt-0.5"
                    style={{
                      backgroundColor: `${PERSON_ACCENT[getTransactionActor(tx)]}18`,
                      color: PERSON_ACCENT[getTransactionActor(tx)],
                    }}
                  >
                    {PERSON_LABELS[getTransactionActor(tx)].slice(0, 1)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug line-clamp-2">
                      {getTransactionDisplayMessage(tx)}
                    </p>
                    <p className="text-[10px] text-muted mt-0.5">
                      {formatDateTime(tx.date, tx.time, tx.timestamp)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-semibold shrink-0",
                      tx.type === "income" ? "text-[#34c759]" : "text-foreground"
                    )}
                  >
                    {tx.type === "income" ? "+" : "-"}
                    {formatCurrency(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <h3 className="font-semibold mb-4">Top spending this month</h3>
          {expenseByCategory.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">No expenses recorded yet</p>
          ) : (
            <div className="space-y-4">
              {expenseByCategory.map((item, i) => {
                const max = expenseByCategory[0]?.amount ?? 1;
                const pct = (item.amount / max) * 100;
                const colors = ["#007aff", "#5856d6", "#34c759", "#ff9500", "#ff3b30"];
                return (
                  <div key={item.name}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="font-medium truncate pr-2">{item.name}</span>
                      <span className="text-muted shrink-0">{formatCurrency(item.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-black/5 dark:bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: colors[i % colors.length],
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

function HeroPill({
  icon: Icon,
  label,
  value,
  positive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  positive?: boolean;
}) {
  return (
    <div className="glass rounded-2xl px-4 py-2.5 flex items-center gap-3 min-w-[140px]">
      <Icon className={cn("w-4 h-4", positive ? "text-[#34c759]" : "text-muted")} />
      <div>
        <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
        <p
          className={cn(
            "font-bold text-sm",
            positive === false && value > 0 && "text-[#ff3b30]"
          )}
        >
          {formatCurrency(value)}
        </p>
      </div>
    </div>
  );
}

function PersonCard({
  person,
  income,
  planned,
  netWorth,
  debt,
}: {
  person: Person;
  income: number;
  planned: number;
  netWorth: number;
  debt: number;
}) {
  return (
    <GlassCard
      strong
      className={cn("relative overflow-hidden bg-gradient-to-br", PERSON_GRADIENT[person])}
    >
      <div
        className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ backgroundColor: PERSON_ACCENT[person] }}
      >
        {PERSON_LABELS[person].slice(0, 1)}
      </div>
      <p className="font-semibold">{PERSON_LABELS[person]}</p>
      <p className="text-xs text-muted mt-0.5">This month</p>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <p className="text-[10px] text-muted">Income</p>
          <p className="font-bold text-[#34c759]">{formatCurrency(income)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted">Planned</p>
          <p className="font-bold">{formatCurrency(planned)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted">Net worth</p>
          <p className="font-bold">{formatCurrency(netWorth)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted">Debt</p>
          <p className="font-bold text-[#ff3b30]">{formatCurrency(debt)}</p>
        </div>
      </div>
    </GlassCard>
  );
}
