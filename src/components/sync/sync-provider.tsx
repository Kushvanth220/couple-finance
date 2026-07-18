"use client";

import { useEffect, useRef } from "react";
import { loadSyncConfig } from "@/lib/supabase/client";
import {
  flushPendingPush,
  isApplyingRemoteSync,
  markLocalChangePending,
  onSyncStatusChange,
  runAutoSyncCycle,
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

        if (cancelled) return;

        readyRef.current = true;

        // Upload anything that changed while sync was starting, then refresh.
        await runAutoSyncCycle(
          config.householdKey,
          getFinanceState,
          applyRemoteFinanceState
        );
      } catch {
        readyRef.current = true;
        const householdId = householdIdRef.current;
        if (householdId) {
          void flushPendingPush();
        }
      }
    }

    void startSync();

    const unsubscribeStore = useFinanceStore.subscribe(() => {
      if (isApplyingRemoteSync()) return;

      markLocalChangePending();

      const householdId = householdIdRef.current;
      if (!householdId || !readyRef.current) return;

      scheduleFinancePush(householdId, getFinanceState);
    });

    function runBackgroundSync() {
      const householdId = householdIdRef.current;
      if (!householdId || !readyRef.current) return;

      void runAutoSyncCycle(
        householdId,
        getFinanceState,
        applyRemoteFinanceState
      );
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        void flushPendingPush();
        return;
      }
      runBackgroundSync();
    }

    function handlePageHide() {
      void flushPendingPush();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", runBackgroundSync);
    window.addEventListener("pagehide", handlePageHide);

    const unsubscribeStatus = onSyncStatusChange(() => {
      // Status is consumed by SyncStatusBadge and /sync page.
    });

    return () => {
      cancelled = true;
      unsubscribeStore();
      unsubscribeStatus();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", runBackgroundSync);
      window.removeEventListener("pagehide", handlePageHide);
      readyRef.current = false;
      householdIdRef.current = null;
      stopSyncSession();
    };
  }, []);

  return null;
}
