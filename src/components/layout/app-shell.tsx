"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  TrendingUp,
  Receipt,
  CreditCard,
  Landmark,
  Heart,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrikLogo } from "@/components/layout/grik-logo";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { SyncStatusBadge } from "@/components/sync/sync-status";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/spend", label: "Spend", icon: Wallet },
  { href: "/income", label: "Income", icon: TrendingUp },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: CreditCard },
  { href: "/debts", label: "Debts", icon: Landmark },
  { href: "/between", label: "Between Us", icon: Heart },
  { href: "/history", label: "History", icon: History },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="mesh-bg" />

      <header className="sticky top-0 z-40 glass-strong border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <GrikLogo size="header" />
          <div className="hidden md:flex items-center gap-1 flex-1 justify-end overflow-x-auto scrollbar-hide">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap",
                    active
                      ? "bg-[#007aff] text-white shadow-md shadow-[#007aff]/20"
                      : "text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
          <SyncStatusBadge />
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 pb-[calc(6.75rem+env(safe-area-inset-bottom))] md:pb-8">
        {children}
      </main>

      <MobileBottomNav />
    </div>
  );
}
