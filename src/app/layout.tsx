import { HOUSEHOLD_LABEL } from "@/lib/branding";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ExpenseReminderProvider } from "@/components/notifications/expense-reminder-provider";
import { BetweenUsCelebrationOverlay } from "@/components/between-us/between-us-celebration";
import { AppShell } from "@/components/layout/app-shell";
import { GrikSplashProvider } from "@/components/layout/grik-splash";
import { SyncProvider } from "@/components/sync/sync-provider";
import { SyncReadyGate } from "@/components/sync/sync-ready-gate";
import { SyncBanner } from "@/components/sync/sync-banner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KG Finance",
  description: `Personal finance for ${HOUSEHOLD_LABEL} — KG Finance`,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "KG Finance",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full" suppressHydrationWarning>
        <SyncProvider />
        <AppShell>
          <GrikSplashProvider />
          <ExpenseReminderProvider />
          <BetweenUsCelebrationOverlay />
          <SyncBanner />
          <SyncReadyGate>{children}</SyncReadyGate>
        </AppShell>
      </body>
    </html>
  );
}
