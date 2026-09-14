import { ExpenseReminderProvider } from "@/components/notifications/expense-reminder-provider";
import { BetweenUsCelebrationOverlay } from "@/components/between-us/between-us-celebration";
import { AppShell } from "@/components/layout/app-shell";
import { GrikSplashProvider } from "@/components/layout/grik-splash";
import { SyncProvider } from "@/components/sync/sync-provider";
import { SyncReadyGate } from "@/components/sync/sync-ready-gate";
import { SyncBanner } from "@/components/sync/sync-banner";

/**
 * Every screen of the app: header, tab bar, sync, splash, Jarvis. Routes
 * outside this group (the intro) get none of it, by construction rather than
 * by checking the path.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SyncProvider />
      <AppShell>
        <GrikSplashProvider />
        <ExpenseReminderProvider />
        <BetweenUsCelebrationOverlay />
        <SyncBanner />
        <SyncReadyGate>{children}</SyncReadyGate>
      </AppShell>
    </>
  );
}
