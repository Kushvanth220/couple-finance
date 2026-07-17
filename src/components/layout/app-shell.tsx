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
        <div className="max-w-6xl mx-auto px-4 py-3 md:py-4 flex items-center justify-between">
          <GrikLogo size="header" />
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                    active
                      ? "bg-[#007aff] text-white"
                      : "text-muted hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 pb-28 md:pb-8">
        {children}
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass-strong border-t border-white/10">
        <div className="flex items-center overflow-x-auto px-1 py-2 gap-0.5 scrollbar-hide">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all min-w-[56px]",
                  active ? "text-[#007aff]" : "text-muted"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
