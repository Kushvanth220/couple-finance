"use client";

import { useEffect, useRef } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  isApplyingRemoteSync,
  onSyncStatusChange,
  resolveInitialSync,
  scheduleFinancePush,
  subscribeToFinanceChanges,
  unsubscribeFromFinanceChanges,
} from "@/lib/supabase/sync";
import {
  applyRemoteFinanceState,
  getFinanceState,
  useFinanceStore,
} from "@/store/finance-store";

export function SyncProvider() {
  const userIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    if (!supabase) return;

    let cancelled = false;

    async function startSync(userId: string) {
      if (cancelled || userIdRef.current === userId) return;
      userIdRef.current = userId;
      readyRef.current = false;

      try {
        await resolveInitialSync(
          userId,
          getFinanceState,
          applyRemoteFinanceState
        );
      } catch {
        // Initial sync can fail offline; local data still works.
      }

      if (cancelled) return;

      readyRef.current = true;
      subscribeToFinanceChanges(userId, applyRemoteFinanceState);
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
        userIdRef.current = null;
        readyRef.current = false;
        unsubscribeFromFinanceChanges();
      }
    });

    const unsubscribeStore = useFinanceStore.subscribe(() => {
      const userId = userIdRef.current;
      if (!userId || !readyRef.current || isApplyingRemoteSync()) return;

      scheduleFinancePush(userId, getFinanceState);
    });

    const unsubscribeStatus = onSyncStatusChange(() => {
      // Status is consumed by SyncStatusBadge
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      unsubscribeStore();
      unsubscribeStatus();
      unsubscribeFromFinanceChanges();
      userIdRef.current = null;
      readyRef.current = false;
    };
  }, []);

  return null;
}
