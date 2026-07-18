"use client";

import { useEffect, useState } from "react";
import { Cloud, Loader2 } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { getHouseholdSyncKey, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  forcePullNow,
  forcePushNow,
  getActiveHouseholdId,
  getLastSyncError,
  onSyncStatusChange,
  type SyncStatus,
} from "@/lib/supabase/sync";
import { applyRemoteFinanceState, getFinanceState } from "@/store/finance-store";

export default function SyncPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    isSupabaseConfigured() ? "idle" : "offline"
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();
  const householdId = getHouseholdSyncKey();

  useEffect(() => {
    if (!configured) return;

    const unsubscribe = onSyncStatusChange((next, err) => {
      setSyncStatus(next);
      setSyncError(err ?? getLastSyncError());
    });

    return unsubscribe;
  }, [configured]);

  async function handleForcePull() {
    setLoading(true);
    setError(null);

    try {
      const pulled = await forcePullNow(
        getActiveHouseholdId(),
        applyRemoteFinanceState
      );
      setMessage(
        pulled
          ? "Latest data downloaded from the cloud."
          : "Already up to date."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleForceSync() {
    setLoading(true);
    setError(null);

    try {
      await forcePushNow(getActiveHouseholdId(), getFinanceState);
      setMessage("Latest data uploaded to the cloud.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Cloud className="w-7 h-7 text-[#007aff]" />
          Cloud Sync
        </h1>
        <p className="text-muted mt-1 text-sm">
          Your data syncs automatically across both phones. No login needed.
        </p>
      </div>

      {!configured ? (
        <GlassCard className="p-6 space-y-3">
          <p className="font-medium">Supabase is not set up yet</p>
          <ol className="text-sm text-muted list-decimal list-inside space-y-1">
            <li>Create a free project at supabase.com</li>
            <li>
              Copy <code className="text-xs">.env.local.example</code> to{" "}
              <code className="text-xs">.env.local</code>
            </li>
            <li>
              Run the SQL migrations in{" "}
              <code className="text-xs">supabase/migrations/</code>
            </li>
            <li>Restart the dev server and redeploy</li>
          </ol>
        </GlassCard>
      ) : (
        <GlassCard className="p-6 space-y-4">
          <div>
            <p className="font-medium">Automatic sync is on</p>
            <p className="text-sm text-muted">
              Both phones share the same cloud data when they open the same website.
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm">
            {syncStatus === "syncing" ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#007aff]" />
            ) : (
              <Cloud className="w-4 h-4 text-[#007aff]" />
            )}
            <span className="text-muted">
              Status:{" "}
              {syncStatus === "syncing"
                ? "Syncing…"
                : syncStatus === "error"
                  ? "Error — try the buttons below"
                  : "Connected"}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <GlassButton onClick={handleForceSync} disabled={loading}>
              Upload now
            </GlassButton>
            <GlassButton variant="secondary" onClick={handleForcePull} disabled={loading}>
              Download latest
            </GlassButton>
          </div>

          {(syncError || error) && (
            <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/10 rounded-2xl px-4 py-3">
              {syncError ?? error}
            </p>
          )}

          {message ? (
            <p className="text-sm text-[#34c759] bg-[#34c759]/10 rounded-2xl px-4 py-3">
              {message}
            </p>
          ) : null}
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-2">
        <p className="font-medium text-sm">How it works</p>
        <ul className="text-sm text-muted space-y-1 list-disc list-inside">
          <li>Open the same website URL on both phones.</li>
          <li>Changes upload automatically and refresh every 10 seconds.</li>
          <li>On the second phone, tap Download latest if you need it right away.</li>
          <li>No account or password required.</li>
        </ul>
        {configured ? (
          <p className="text-xs text-muted pt-2">
            Household key: <code>{householdId}</code>
          </p>
        ) : null}
      </GlassCard>
    </div>
  );
}
