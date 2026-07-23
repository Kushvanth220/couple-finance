"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { isSupabaseConfiguredAsync } from "@/lib/supabase/client";
import { isInitialSyncComplete, onInitialSyncComplete } from "@/lib/supabase/sync";

export function SyncReadyGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(isInitialSyncComplete());
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    void isSupabaseConfiguredAsync().then((value) => {
      setConfigured(value);
      if (!value) {
        setReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (configured !== true) return;
    if (isInitialSyncComplete()) {
      setReady(true);
      return;
    }

    return onInitialSyncComplete(() => {
      setReady(true);
    });
  }, [configured]);

  if (configured === null || (configured && !ready)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#007aff]" />
        <p className="text-sm font-medium">Loading your finances…</p>
        <p className="text-xs text-muted">Syncing from cloud</p>
      </div>
    );
  }

  return children;
}
