"use client";

import { GrikLogo } from "@/components/layout/grik-logo";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { AssistantFloatingButton } from "@/components/assistant/assistant-floating-button";
import { AssistantProvider } from "@/components/assistant/assistant-context";
import { SyncStatusBadge } from "@/components/sync/sync-status";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AssistantProvider>
      <div className="min-h-dvh flex flex-col">
      <div className="mesh-bg" />

      <header className="sticky top-0 z-40 glass-strong border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 md:py-4 flex items-center justify-between gap-3">
          <GrikLogo size="header" />
          <DesktopNav />
          <SyncStatusBadge />
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 pb-[calc(6.75rem+env(safe-area-inset-bottom))] md:pb-8">
        {children}
      </main>

      <MobileBottomNav />
      <AssistantFloatingButton />
    </div>
    </AssistantProvider>
  );
}
