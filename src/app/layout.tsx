import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ExpenseReminderProvider } from "@/components/notifications/expense-reminder-provider";
import { AppShell } from "@/components/layout/app-shell";
import { SyncProvider } from "@/components/sync/sync-provider";
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
  title: "Grik Finance",
  description: "Personal finance for Kushvanth & Grishma — Grik Finance",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Grik Finance",
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
    >
      <body className="min-h-full">
        <SyncProvider />
        <AppShell>
          <ExpenseReminderProvider />
          <SyncBanner />
          {children}
        </AppShell>
      </body>
    </html>
  );
}
