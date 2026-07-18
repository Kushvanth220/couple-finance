"use client";

import { useEffect, useRef } from "react";
import { loadSyncConfig } from "@/lib/supabase/client";
import {
  isApplyingRemoteSync,
  onSyncStatusChange,
  pullRemoteIfNewer,
  runInitialSyncSession,
  scheduleFinancePush,
  stopSyncSession,
} from "@/lib/supabase/sync";
import {
  applyRemoteFinanceState,
  getFinanceState,
  useFinanceStore,
  waitForStoreHydration,
} from "@/store/finance-store";

export function SyncProvider() {
  const readyRef = useRef(false);
  const householdIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startSync() {
      const config = await loadSyncConfig();
      if (cancelled || !config) {
        return;
      }

      householdIdRef.current = config.householdKey;
      readyRef.current = false;

      try {
        await waitForStoreHydration();
        if (cancelled) return;

        await runInitialSyncSession(
          config,
          getFinanceState,
          applyRemoteFinanceState
        );
        readyRef.current = true;
      } catch {
        readyRef.current = true;
      }
    }

    void startSync();

    const unsubscribeStore = useFinanceStore.subscribe(() => {
      const householdId = householdIdRef.current;
      if (!householdId || !readyRef.current || isApplyingRemoteSync()) return;
      scheduleFinancePush(householdId, getFinanceState);
    });

    function refreshFromCloud() {
      const householdId = householdIdRef.current;
      if (!householdId || !readyRef.current) return;
      void pullRemoteIfNewer(householdId, applyRemoteFinanceState);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") refreshFromCloud();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", refreshFromCloud);

    const unsubscribeStatus = onSyncStatusChange(() => {
      // Status is consumed by SyncStatusBadge and /sync page.
    });

    return () => {
      cancelled = true;
      unsubscribeStore();
      unsubscribeStatus();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", refreshFromCloud);
      readyRef.current = false;
      householdIdRef.current = null;
      stopSyncSession();
    };
  }, []);

  return null;
}
