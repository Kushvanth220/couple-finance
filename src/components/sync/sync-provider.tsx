"use client";

import { useEffect, useRef } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
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
  const userIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const startingRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    if (!supabase) return;

    let cancelled = false;

    async function startSync(userId: string) {
      if (cancelled) return;
      if (startingRef.current) return;
      if (userIdRef.current === userId && readyRef.current) return;

      startingRef.current = true;
      userIdRef.current = userId;
      readyRef.current = false;

      try {
        await waitForStoreHydration();
        if (cancelled) return;

        await runInitialSyncSession(
          userId,
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

    function stopSync() {
      userIdRef.current = null;
      readyRef.current = false;
      startingRef.current = false;
      stopSyncSession();
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        void startSync(session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void startSync(session.user.id);
      } else {
        stopSync();
      }
    });

    const unsubscribeStore = useFinanceStore.subscribe(() => {
      const userId = userIdRef.current;
      if (!userId || !readyRef.current || isApplyingRemoteSync()) return;

      scheduleFinancePush(userId, getFinanceState);
    });

    function handleVisibilityChange() {
      const userId = userIdRef.current;
      if (!userId || !readyRef.current || document.visibilityState !== "visible") {
        return;
      }

      void pullRemoteIfNewer(userId, applyRemoteFinanceState);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const unsubscribeStatus = onSyncStatusChange(() => {
      // Status is consumed by SyncStatusBadge and /sync page.
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      unsubscribeStore();
      unsubscribeStatus();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopSync();
    };
  }, []);

  return null;
}
