"use client";

import { useEffect, useRef } from "react";
import {
  getHouseholdSyncKey,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
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
  const startingRef = useRef(false);
  const householdId = getHouseholdSyncKey();

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let cancelled = false;

    async function startSync() {
      if (cancelled || startingRef.current || readyRef.current) return;

      startingRef.current = true;
      readyRef.current = false;

      try {
        await waitForStoreHydration();
        if (cancelled) return;

        await runInitialSyncSession(
          householdId,
          getFinanceState,
          applyRemoteFinanceState
        );
      } catch {
        // Errors are surfaced via sync status.
      }

      if (cancelled) return;
      readyRef.current = true;
      startingRef.current = false;
    }

    void startSync();

    const unsubscribeStore = useFinanceStore.subscribe(() => {
      if (!readyRef.current || isApplyingRemoteSync()) return;
      scheduleFinancePush(householdId, getFinanceState);
    });

    function handleVisibilityChange() {
      if (!readyRef.current || document.visibilityState !== "visible") return;
      void pullRemoteIfNewer(householdId, applyRemoteFinanceState);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const unsubscribeStatus = onSyncStatusChange(() => {
      // Status is consumed by SyncStatusBadge and /sync page.
    });

    return () => {
      cancelled = true;
      unsubscribeStore();
      unsubscribeStatus();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      readyRef.current = false;
      startingRef.current = false;
      stopSyncSession();
    };
  }, [householdId]);

  return null;
}
