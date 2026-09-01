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
  const [cloudChecking, setCloudChecking] = useState(true);
  const [supabaseUrl, setSupabaseUrl] = useState<string | null>(null);
  const [cloudHealthError, setCloudHealthError] = useState<string | null>(null);
  const [householdRows, setHouseholdRows] = useState<
    Array<{ household_id: string; transactions: number }>
  >([]);

  useEffect(() => {
    void loadSyncConfig().then(async (config) => {
      setConfigured(Boolean(config));
      if (!config) {
        setCloudChecking(false);
        return;
      }

      setHouseholdId(config.householdKey);
      setSupabaseUrl(config.supabaseUrl);

      try {
        const health = (await fetch("/api/cloud-health", { cache: "no-store" }).then((res) =>
          res.json()
        )) as {
          ok?: boolean;
          error?: string;
          matched?: { transactions?: number };
          rows?: Array<{ household_id: string; transactions: number }>;
        };

        if (health.ok && health.matched) {
          setCloudTransactions(health.matched.transactions ?? 0);
          setCloudHealthError(null);
          setHouseholdRows(health.rows ?? []);
          return;
        }

        if (health.ok && health.rows?.length) {
          setHouseholdRows(health.rows);
          setCloudTransactions(null);
          setCloudHealthError(
            `Connected, but no row for "${config.householdKey}". Found: ${health.rows
              .map((row) => `${row.household_id} (${row.transactions} tx)`)
              .join(", ")}`
          );
          return;
        }

        setCloudTransactions(null);
        setCloudHealthError(health.error ?? "Could not read cloud data.");
      } catch {
        try {
          const remote = await fetchRemoteFinance(config.householdKey);
          setCloudTransactions(remote?.data.transactions?.length ?? 0);
          setCloudHealthError(null);
        } catch {
          setCloudTransactions(null);
          setCloudHealthError("Could not reach Supabase from this device.");
        }
      } finally {
        setCloudChecking(false);
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

          {syncError || cloudHealthError ? (
            <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/10 rounded-2xl px-4 py-3">
              {syncError ?? cloudHealthError}
            </p>
          ) : null}

          <div className="rounded-2xl bg-[#34c759]/10 px-4 py-3 text-xs text-muted space-y-1">
            <p className="font-medium text-[#34c759]">Cloud backup active</p>
            <p>
              Your data auto-saves to Supabase. Uploads are blocked if cloud is unreachable or if
              this device would overwrite richer cloud history.
            </p>
          </div>

          <div className="rounded-2xl bg-black/5 dark:bg-white/10 px-4 py-3 text-xs text-muted space-y-1">
            <p>
              This phone: {transactions.length} transactions, {incomeEntries.length} income
              entries
            </p>
            <p>
              Cloud:{" "}
              {cloudChecking
                ? "checking…"
                : cloudTransactions === null
                  ? "could not read"
                  : `${cloudTransactions} transactions`}
            </p>
            {supabaseUrl ? <p className="truncate">Project: {supabaseUrl}</p> : null}
            {householdRows.length > 0 ? (
              <p>
                Cloud households:{" "}
                {householdRows
                  .map((row) => `${row.household_id} (${row.transactions} tx)`)
                  .join(", ")}
              </p>
            ) : null}
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
