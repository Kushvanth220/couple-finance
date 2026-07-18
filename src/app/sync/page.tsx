"use client";

import { useEffect, useState } from "react";
import { Cloud, Loader2 } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { getHouseholdSyncKey, loadSyncConfig } from "@/lib/supabase/client";
import {
  diagnoseSync,
  forcePullNow,
  forcePushNow,
  getActiveHouseholdId,
  getLastSyncError,
  onSyncStatusChange,
  type SyncDiagnostics,
  type SyncStatus,
} from "@/lib/supabase/sync";
import { applyRemoteFinanceState, getFinanceState } from "@/store/finance-store";

export default function SyncPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("offline");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [householdId, setHouseholdId] = useState(getHouseholdSyncKey());
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostics | null>(null);

  useEffect(() => {
    void loadSyncConfig().then((config) => {
      setConfigured(Boolean(config));
      if (config) setHouseholdId(config.householdKey);
    });

    const unsubscribe = onSyncStatusChange((next, err) => {
      setSyncStatus(next);
      setSyncError(err ?? getLastSyncError());
    });

    return unsubscribe;
  }, []);

  async function runDiagnostics() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await diagnoseSync(getFinanceState);
      setDiagnostics(result);
      setHouseholdId(result.householdId);
      setConfigured(result.configured);

      if (result.ok) {
        setMessage("Cloud sync is working.");
      } else {
        setError(result.steps.find((step) => !step.ok)?.message ?? "Sync check failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync check failed");
    } finally {
      setLoading(false);
    }
  }

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
          : "No cloud data found yet."
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
      setError(err instanceof Error ? err.message : "Upload failed");
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
          Syncs automatically across both phones. No login needed.
        </p>
      </div>

      {configured === false ? (
        <GlassCard className="p-6 space-y-3">
          <p className="font-medium text-[#ff9500]">Supabase is not configured</p>
          <p className="text-sm text-muted">
            Sync cannot work until you add your Supabase keys. Right now each phone
            only saves data locally.
          </p>
          <ol className="text-sm text-muted list-decimal list-inside space-y-2">
            <li>Create a free project at supabase.com</li>
            <li>
              Copy <code className="text-xs">.env.local.example</code> to{" "}
              <code className="text-xs">.env.local</code>
            </li>
            <li>
              Paste your URL and anon key from Supabase → Settings → API
            </li>
            <li>
              Run <code className="text-xs">supabase/setup.sql</code> in Supabase SQL
              Editor
            </li>
            <li>Restart dev server, or redeploy with the same env vars</li>
          </ol>
          <GlassButton onClick={runDiagnostics} disabled={loading}>
            Test connection
          </GlassButton>
        </GlassCard>
      ) : configured === true ? (
        <GlassCard className="p-6 space-y-4">
          <div>
            <p className="font-medium">Automatic sync</p>
            <p className="text-sm text-muted">
              Open the same website on both phones. Changes refresh every 5 seconds.
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
                  ? "Error"
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
            <GlassButton variant="secondary" onClick={runDiagnostics} disabled={loading}>
              Test connection
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
      ) : (
        <GlassCard className="p-6">
          <Loader2 className="w-5 h-5 animate-spin text-[#007aff]" />
        </GlassCard>
      )}

      {diagnostics ? (
        <GlassCard className="p-6 space-y-3">
          <p className="font-medium text-sm">Connection test</p>
          <ul className="space-y-2">
            {diagnostics.steps.map((step) => (
              <li key={step.name} className="text-sm">
                <span className={step.ok ? "text-[#34c759]" : "text-[#ff3b30]"}>
                  {step.ok ? "✓" : "✗"}
                </span>{" "}
                <span className="font-medium">{step.name}:</span>{" "}
                <span className="text-muted">{step.message}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}

      <GlassCard className="p-6 space-y-2">
        <p className="font-medium text-sm">Household key</p>
        <p className="text-xs text-muted break-all">
          <code>{householdId}</code>
        </p>
        <p className="text-sm text-muted pt-1">
          Both phones must use the same website URL (same deployment).
        </p>
      </GlassCard>
    </div>
  );
}
