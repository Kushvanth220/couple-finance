import {
  Cloud,
  CreditCard,
  Heart,
  History,
  Landmark,
  LayoutDashboard,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";

export const primaryNavItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/spend", label: "Spend", icon: Wallet, primary: true as const },
  { href: "/between", label: "Between", icon: Heart },
] as const;

export const moreNavItems = [
  { href: "/income", label: "Income", icon: TrendingUp, tint: "#34c759" },
  { href: "/expenses", label: "Expenses", icon: Receipt, tint: "#5856d6" },
  { href: "/accounts", label: "Accounts", icon: CreditCard, tint: "#007aff" },
  { href: "/debts", label: "Debts", icon: Landmark, tint: "#ff3b30" },
  { href: "/history", label: "History", icon: History, tint: "#ff9500" },
  { href: "/sync", label: "Cloud Sync", icon: Cloud, tint: "#34c759" },
] as const;

export function isNavActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isMoreNavActive(pathname: string) {
  return moreNavItems.some(
    (link) => pathname === link.href || pathname.startsWith(`${link.href}/`)
  );
}
