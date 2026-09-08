"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Banknote, ChevronRight, CreditCard, Landmark, Wallet } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { AnimatedMoney } from "@/components/ui/animated-number";
import { useFinanceStore } from "@/store/finance-store";
import { getAccountsForPerson } from "@/lib/accounts";
import { roundMoney } from "@/lib/money";
import { formatCurrency } from "@/lib/formatters";
import type { AccountType, Person } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Every account and what is in it, on the home page.
 *
 * It reads the same store the Accounts page writes to, so the two cannot drift
 * — there is no second copy of a balance anywhere.
 *
 * Money held and money owed are SEPARATE cards. A debit balance and a card
 * balance point in opposite directions, so sitting them in one box invites the
 * eye to add them; kept apart, each total means exactly one thing.
 */

const TYPE_META: Record<AccountType, { label: string; icon: typeof Wallet; tint: string }> = {
  debit: { label: "Bank & debit", icon: Landmark, tint: "#34c759" },
  cash: { label: "Cash", icon: Banknote, tint: "#ffd60a" },
  credit: { label: "Credit cards", icon: CreditCard, tint: "#ff3b30" },
};

export function AccountBalances({ person }: { person: Person }) {
  const accounts = useFinanceStore((state) => state.accounts);

  const { mine, available, owed, net } = useMemo(() => {
    const mine = getAccountsForPerson(accounts, person);
    const sumOf = (type: AccountType) =>
      mine.filter((account) => account.type === type).reduce((sum, a) => sum + a.balance, 0);

    const available = roundMoney(sumOf("debit") + sumOf("cash"));
    const owed = roundMoney(sumOf("credit"));
    return { mine, available, owed, net: roundMoney(available - owed) };
  }, [accounts, person]);

  if (mine.length === 0) {
    return (
      <GlassCard className="!p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Account balance</p>
          <Link href="/accounts" className="text-[11px] font-semibold text-[#007aff]">
            Add one
          </Link>
        </div>
        <p className="py-4 text-center text-[11px] text-muted">No accounts yet</p>
      </GlassCard>
    );
  }

  const groupsFor = (types: AccountType[]) =>
    types
      .map((type) => ({ type, group: mine.filter((account) => account.type === type) }))
      .filter((entry) => entry.group.length > 0);

  const renderGroups = (types: AccountType[]) =>
    groupsFor(types).map(({ type, group }) => {
      const meta = TYPE_META[type];
      const Icon = meta.icon;
      const groupTotal = roundMoney(group.reduce((sum, a) => sum + a.balance, 0));

      return (
        <div key={type}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <Icon className="h-3 w-3" style={{ color: meta.tint }} />
              {meta.label}
            </p>
            <p className="text-[11px] font-semibold tabular-nums" style={{ color: meta.tint }}>
              {formatCurrency(groupTotal)}
            </p>
          </div>

          <div className="space-y-1">
            {group.map((account) => (
              <Link
                key={account.id}
                href="/accounts"
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[12px]">{account.name}</span>
                  {account.shared ? (
                    <span className="shrink-0 rounded-full bg-[#5ac8fa]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#5ac8fa]">
                      SHARED
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums">
                  {formatCurrency(account.balance)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      );
    });

  const held = renderGroups(["debit", "cash"]);
  const cards = renderGroups(["credit"]);

  return (
    <>
      <GlassCard className="!p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5 text-[#34c759]" />
            <p className="text-xs font-semibold">Account balance</p>
          </div>
          <Link
            href="/accounts"
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#007aff]"
          >
            Manage <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <p className="text-[10px] uppercase tracking-wide text-muted">Available</p>
        <AnimatedMoney
          value={available}
          className="text-2xl font-semibold text-[#34c759] tabular-nums"
        />

        {held.length > 0 ? (
          <div className="mt-3 space-y-3 border-t border-black/5 pt-3 dark:border-white/10">
            {held}
          </div>
        ) : (
          <p className="py-3 text-center text-[11px] text-muted">No bank or cash accounts yet</p>
        )}
      </GlassCard>

      {cards.length > 0 ? (
        <GlassCard className="!p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5 text-[#ff3b30]" />
              <p className="text-xs font-semibold">Credit balance</p>
            </div>
            <Link
              href="/debts"
              className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#007aff]"
            >
              Debts <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <p className="text-[10px] uppercase tracking-wide text-muted">Owed on cards</p>
          <AnimatedMoney
            value={owed}
            className={cn(
              "text-2xl font-semibold tabular-nums",
              owed > 0 ? "text-[#ff3b30]" : "text-muted"
            )}
          />
          {owed > 0 ? (
            <p className="mt-1 text-[10px] text-muted">
              Clearing them from {formatCurrency(available)} would leave{" "}
              <span className={cn("font-semibold tabular-nums", net < 0 && "text-[#ff3b30]")}>
                {formatCurrency(net)}
              </span>
            </p>
          ) : null}

          <div className="mt-3 space-y-3 border-t border-black/5 pt-3 dark:border-white/10">
            {cards}
          </div>
        </GlassCard>
      ) : null}
    </>
  );
}
