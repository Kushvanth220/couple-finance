"use client";

import { useEffect, useState } from "react";
import { Cloud, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { getHouseholdSyncKey, loadSyncConfig } from "@/lib/supabase/client";
import {
  fetchRemoteFinance,
  getLastSyncError,
  onSyncStatusChange,
  type SyncStatus,
} from "@/lib/supabase/sync";
import { useFinanceStore } from "@/store/finance-store";

export default function SyncPage() {
  const transactions = useFinanceStore((state) => state.transactions);
  const incomeEntries = useFinanceStore((state) => state.incomeEntries);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("offline");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [householdId, setHouseholdId] = useState(getHouseholdSyncKey());
  const [cloudTransactions, setCloudTransactions] = useState<number | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState<string | null>(null);

  useEffect(() => {
    void loadSyncConfig().then(async (config) => {
      setConfigured(Boolean(config));
      if (!config) return;

      setHouseholdId(config.householdKey);
      setSupabaseUrl(config.supabaseUrl);

      try {
        const remote = await fetchRemoteFinance(config.householdKey);
        setCloudTransactions(remote?.data.transactions?.length ?? 0);
      } catch {
        setCloudTransactions(null);
      }
    });

    const unsubscribe = onSyncStatusChange((next, err) => {
      setSyncStatus(next);
      setSyncError(err ?? getLastSyncError());
    });

    return unsubscribe;
  }, []);

  return (
    <div className="max-w-lg mx-auto space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Cloud className="w-7 h-7 text-[#007aff]" />
          Cloud Sync
        </h1>
        <p className="text-muted mt-1 text-sm">
          Everything syncs automatically. No buttons needed.
        </p>
      </div>

      {configured === false ? (
        <GlassCard className="p-6 space-y-3">
          <p className="font-medium text-[#ff9500]">Not connected yet</p>
          <p className="text-sm text-muted">
            Add Supabase keys to Vercel environment variables and redeploy.
          </p>
        </GlassCard>
      ) : configured === true ? (
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            {syncStatus === "syncing" ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#007aff]" />
            ) : (
              <Cloud className="w-4 h-4 text-[#007aff]" />
            )}
            <span className="font-medium">
              {syncStatus === "syncing"
                ? "Syncing…"
                : syncStatus === "error"
                  ? "Sync problem"
                  : "Auto-sync on"}
            </span>
          </div>

          <p className="text-sm text-muted">
            Changes upload within a second and download on your other phone automatically.
            Just open the same app on both devices.
          </p>

          {syncError ? (
            <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/10 rounded-2xl px-4 py-3">
              {syncError}
            </p>
          ) : null}

          <div className="rounded-2xl bg-black/5 dark:bg-white/10 px-4 py-3 text-xs text-muted space-y-1">
            <p>
              This phone: {transactions.length} transactions, {incomeEntries.length} income
              entries
            </p>
            <p>
              Cloud:{" "}
              {cloudTransactions === null
                ? "could not read"
                : `${cloudTransactions} transactions`}
            </p>
            {supabaseUrl ? <p className="truncate">Project: {supabaseUrl}</p> : null}
          </div>

          <p className="text-xs text-muted">Household: {householdId}</p>
        </GlassCard>
      ) : (
        <GlassCard className="p-6">
          <Loader2 className="w-5 h-5 animate-spin text-[#007aff]" />
        </GlassCard>
      )}

      <GlassCard className="p-6 space-y-2">
        <p className="font-medium text-sm">How it works</p>
        <ul className="text-sm text-muted space-y-1 list-disc list-inside">
          <li>Edit anything — it uploads automatically</li>
          <li>Your other phone picks it up within ~2 seconds</li>
          <li>Works both ways with no manual steps</li>
        </ul>
      </GlassCard>
    </div>
  );
}
