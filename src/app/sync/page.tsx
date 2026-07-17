"use client";

import { useEffect, useState } from "react";
import { Cloud, Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassCard } from "@/components/ui/glass-card";
import { GlassInput } from "@/components/ui/glass-input";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  forcePullNow,
  forcePushNow,
  getCurrentSyncUserId,
  getLastSyncError,
  onSyncStatusChange,
  type SyncStatus,
} from "@/lib/supabase/sync";
import { applyRemoteFinanceState, getFinanceState } from "@/store/finance-store";

export default function SyncPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("offline");
  const [syncError, setSyncError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) return;

    const supabase = createClient();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    const unsubscribe = onSyncStatusChange((next, error) => {
      setSyncStatus(next);
      setSyncError(error ?? getLastSyncError());
    });

    return () => {
      subscription.unsubscribe();
      unsubscribe();
    };
  }, [configured]);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    setMessage("Signed in. Your data will sync across devices.");
    setLoading(false);
  }

  async function handleSignUp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    setMessage(
      "Account created. If email confirmation is enabled, check your inbox, then sign in on every device with the same account."
    );
    setLoading(false);
  }

  async function handleSignOut() {
    const supabase = createClient();
    if (!supabase) return;

    await supabase.auth.signOut();
    setMessage("Signed out. This device will keep using local data only.");
  }

  async function handleForcePull() {
    const userId = user?.id ?? getCurrentSyncUserId();
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      const pulled = await forcePullNow(userId, applyRemoteFinanceState);
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
    const userId = user?.id ?? getCurrentSyncUserId();
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      await forcePushNow(userId, getFinanceState);
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
          Sign in with the same account on every device so Kushvanth and Grishma
          always see the same numbers.
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
              Run the SQL in{" "}
              <code className="text-xs">supabase/migrations/001_household_finance.sql</code>
            </li>
            <li>Restart the dev server</li>
          </ol>
        </GlassCard>
      ) : user ? (
        <GlassCard className="p-6 space-y-4">
          <div>
            <p className="font-medium">Signed in</p>
            <p className="text-sm text-muted">{user.email}</p>
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
                  ? "Error — try Sync now"
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
            <GlassButton variant="secondary" onClick={handleSignOut}>
              Sign out
            </GlassButton>
          </div>

          {syncError ? (
            <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/10 rounded-2xl px-4 py-3">
              {syncError}
            </p>
          ) : null}
        </GlassCard>
      ) : (
        <GlassCard className="p-6">
          <form className="space-y-4" onSubmit={handleSignIn}>
            <GlassInput
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <GlassInput
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            <div className="flex flex-wrap gap-2 pt-2">
              <GlassButton type="submit" disabled={loading}>
                Sign in
              </GlassButton>
              <GlassButton
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={handleSignUp}
              >
                Create account
              </GlassButton>
            </div>
          </form>
        </GlassCard>
      )}

      {message ? (
        <p className="text-sm text-[#34c759] bg-[#34c759]/10 rounded-2xl px-4 py-3">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/10 rounded-2xl px-4 py-3">
          {error}
        </p>
      ) : null}

      <GlassCard className="p-6 space-y-2">
        <p className="font-medium text-sm">How it works</p>
        <ul className="text-sm text-muted space-y-1 list-disc list-inside">
          <li>Create one shared login for your household.</li>
          <li>Sign in on phone, laptop, and any other browser.</li>
          <li>Changes upload automatically and refresh every 10 seconds.</li>
          <li>On the second phone, open Sync and tap Download latest if needed.</li>
          <li>Without sign-in, data stays on this device only.</li>
        </ul>
      </GlassCard>
    </div>
  );
}
