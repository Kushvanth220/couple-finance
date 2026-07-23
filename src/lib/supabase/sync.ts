import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createClient,
  getCachedSyncConfig,
  getHouseholdSyncKey,
  loadSyncConfig,
  type SyncConfig,
} from "@/lib/supabase/client";
import type { FinanceState } from "@/types";

/** Bumped to reset stale per-device sync timestamps from older builds. */
export const SYNC_META_KEY = "couple-finance-sync-meta-v5";

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

export interface SyncMeta {
  lastSyncedAt: string | null;
  lastPushedAt: string | null;
  lastLocalEditAt: string | null;
}

export interface RemoteFinanceRow {
  household_id: string;
  data: FinanceState;
  updated_at: string;
}

export interface SyncDiagnosticStep {
  name: string;
  ok: boolean;
  message: string;
}

export interface SyncDiagnostics {
  ok: boolean;
  householdId: string;
  configured: boolean;
  steps: SyncDiagnosticStep[];
  cloudUpdatedAt?: string;
  cloudTransactionCount?: number;
}

type SyncListener = (status: SyncStatus, error?: string) => void;

let applyingRemote = false;
let pendingLocalChanges = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let activeConfig: SyncConfig | null = null;
let lastSyncError: string | null = null;
let syncInProgress: Promise<void> | null = null;
let pushStateGetter: (() => FinanceState) | null = null;
let pushHouseholdId: string | null = null;
const listeners = new Set<SyncListener>();

const PUSH_DEBOUNCE_MS = 250;
const POLL_INTERVAL_MS = 1_500;

let sessionPullConfig: {
  householdId: string;
  getLocalState: () => FinanceState;
  applyRemoteState: (state: FinanceState) => void;
} | null = null;

function getConfigOrThrow() {
  const config = activeConfig ?? getCachedSyncConfig();
  if (!config) throw new Error("Supabase is not configured");
  return config;
}

export function isApplyingRemoteSync() {
  return applyingRemote;
}

export function getLastSyncError() {
  return lastSyncError;
}

export function getCurrentHouseholdId() {
  return activeConfig?.householdKey ?? getHouseholdSyncKey();
}

export function onSyncStatusChange(listener: SyncListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyStatus(status: SyncStatus, error?: string) {
  if (error) {
    lastSyncError = error;
  } else if (status === "synced") {
    lastSyncError = null;
  }

  for (const listener of listeners) {
    listener(status, error);
  }
}

export function readSyncMeta(): SyncMeta {
  if (typeof window === "undefined") {
    return { lastSyncedAt: null, lastPushedAt: null, lastLocalEditAt: null };
  }

  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) return { lastSyncedAt: null, lastPushedAt: null, lastLocalEditAt: null };
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      lastSyncedAt: parsed.lastSyncedAt ?? null,
      lastPushedAt: parsed.lastPushedAt ?? null,
      lastLocalEditAt: parsed.lastLocalEditAt ?? null,
    };
  } catch {
    return { lastSyncedAt: null, lastPushedAt: null, lastLocalEditAt: null };
  }
}

function writeSyncMeta(meta: SyncMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

function lastSyncedTime(meta = readSyncMeta()) {
  return meta.lastSyncedAt ? new Date(meta.lastSyncedAt).getTime() : 0;
}

function helpfulErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";

  if (message.includes("household_id") && message.includes("does not exist")) {
    return "Database table is outdated. Run supabase/setup.sql in Supabase SQL Editor.";
  }

  if (message.includes("Could not find the table")) {
    return "Table missing. Run supabase/setup.sql in Supabase SQL Editor.";
  }

  if (message.includes("permission denied") || message.includes("RLS")) {
    return "Database permissions blocked sync. Run supabase/setup.sql again.";
  }

  return message;
}

export async function fetchRemoteFinance(
  householdId: string
): Promise<RemoteFinanceRow | null> {
  const config = getConfigOrThrow();
  const supabase = createClient(config);
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("household_finance")
    .select("household_id, data, updated_at")
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) throw new Error(helpfulErrorMessage(error));
  if (!data) return null;

  return {
    household_id: data.household_id,
    data: data.data as FinanceState,
    updated_at: data.updated_at,
  };
}

export async function pushFinanceState(
  householdId: string,
  state: FinanceState
): Promise<RemoteFinanceRow> {
  const config = getConfigOrThrow();
  const supabase = createClient(config);
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase
    .from("household_finance")
    .upsert(
      {
        household_id: householdId,
        data: state,
      },
      { onConflict: "household_id" }
    )
    .select("household_id, data, updated_at")
    .single();

  if (error) throw new Error(helpfulErrorMessage(error));

  pendingLocalChanges = false;
  writeSyncMeta({
    ...readSyncMeta(),
    lastSyncedAt: data.updated_at,
    lastPushedAt: data.updated_at,
    lastLocalEditAt: null,
  });

  const row = {
    household_id: data.household_id,
    data: data.data as FinanceState,
    updated_at: data.updated_at,
  };

  if (sessionPullConfig?.householdId === householdId) {
    void pullRemoteIfNewer(
      householdId,
      sessionPullConfig.getLocalState,
      sessionPullConfig.applyRemoteState
    );
  }

  return row;
}

export function markLocalChangePending() {
  pendingLocalChanges = true;
  const meta = readSyncMeta();
  writeSyncMeta({
    ...meta,
    lastLocalEditAt: new Date().toISOString(),
  });
}

/** Clear false-positive pending flag from store rehydration (not a user edit). */
export function clearPendingLocalChanges() {
  pendingLocalChanges = false;
}

export function scheduleFinancePush(
  householdId: string,
  getState: () => FinanceState
) {
  if (applyingRemote || !activeConfig) return;

  pendingLocalChanges = true;
  pushHouseholdId = householdId;
  pushStateGetter = getState;

  if (pushTimer) clearTimeout(pushTimer);

  pushTimer = setTimeout(async () => {
    pushTimer = null;
    notifyStatus("syncing");

    try {
      await pushFinanceState(householdId, getState());
      notifyStatus("synced");
    } catch (err) {
      notifyStatus("error", helpfulErrorMessage(err));
    }
  }, PUSH_DEBOUNCE_MS);
}

export async function flushPendingPush() {
  if (!pendingLocalChanges || !pushHouseholdId || !pushStateGetter) return;

  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  notifyStatus("syncing");
  await pushFinanceState(pushHouseholdId, pushStateGetter());
  notifyStatus("synced");
}

function applyRemoteRow(
  row: RemoteFinanceRow,
  applyRemoteState: (state: FinanceState) => void
) {
  applyingRemote = true;
  applyRemoteState(row.data);
  applyingRemote = false;
  pendingLocalChanges = false;
  writeSyncMeta({
    lastSyncedAt: row.updated_at,
    lastPushedAt: readSyncMeta().lastPushedAt,
    lastLocalEditAt: null,
  });
  notifyStatus("synced");
}

function lastLocalEditTime(meta = readSyncMeta()) {
  return meta.lastLocalEditAt ? new Date(meta.lastLocalEditAt).getTime() : 0;
}

function shouldPullRemote(
  remote: RemoteFinanceRow,
  _localState: FinanceState,
  meta = readSyncMeta()
) {
  if (pendingLocalChanges) return false;

  const remoteTime = new Date(remote.updated_at).getTime();
  const syncedTime = lastSyncedTime(meta);
  const localEditTime = lastLocalEditTime(meta);

  if (localEditTime > remoteTime) return false;

  if (remoteTime > syncedTime) return true;

  if (!meta.lastSyncedAt) return true;

  return false;
}

function shouldPushLocalOverRemote(
  remote: RemoteFinanceRow,
  meta = readSyncMeta()
) {
  const remoteTime = new Date(remote.updated_at).getTime();
  const localEditTime = lastLocalEditTime(meta);
  return localEditTime > remoteTime;
}

export function pullRemoteIfNewer(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<boolean> {
  return (async () => {
    const remote = await fetchRemoteFinance(householdId);
    if (!remote) return false;

    const localState = getLocalState();
    if (!shouldPullRemote(remote, localState)) return false;

    applyRemoteRow(remote, applyRemoteState);
    return true;
  })();
}

export async function resolveInitialSync(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<"local" | "remote" | "none"> {
  clearPendingLocalChanges();

  const remote = await fetchRemoteFinance(householdId);
  const localState = getLocalState();
  const meta = readSyncMeta();

  if (!remote) {
    await pushFinanceState(householdId, localState);
    notifyStatus("synced");
    return "local";
  }

  if (shouldPushLocalOverRemote(remote, meta)) {
    await pushFinanceState(householdId, localState);
    notifyStatus("synced");
    return "local";
  }

  if (shouldPullRemote(remote, localState, meta)) {
    applyRemoteRow(remote, applyRemoteState);
    return "remote";
  }

  notifyStatus("synced");
  return "none";
}

export function subscribeToFinanceChanges(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
) {
  const config = getConfigOrThrow();
  const supabase = createClient(config);
  if (!supabase) return;

  unsubscribeFromFinanceChanges();

  activeConfig = config;
  realtimeChannel = supabase
    .channel(`household_finance:${householdId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "household_finance",
        filter: `household_id=eq.${householdId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") return;

        void (async () => {
          try {
            const remote = await fetchRemoteFinance(householdId);
            if (!remote?.data) return;
            if (!shouldPullRemote(remote, getLocalState())) return;
            applyRemoteRow(remote, applyRemoteState);
          } catch (err) {
            notifyStatus("error", helpfulErrorMessage(err));
          }
        })();
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        notifyStatus("error", "Live sync unavailable — refreshing every 2s");
      }
    });
}

export function startPollingSync(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
) {
  stopPollingSync();

  pollTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;

    void (async () => {
      if (pendingLocalChanges) {
        await flushPendingPush();
      }
      await pullRemoteIfNewer(householdId, getLocalState, applyRemoteState);
    })().catch((err) => {
      notifyStatus("error", helpfulErrorMessage(err));
    });
  }, POLL_INTERVAL_MS);
}

export async function runAutoSyncCycle(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
) {
  if (pendingLocalChanges) {
    await flushPendingPush();
  }
  await pullRemoteIfNewer(householdId, getLocalState, applyRemoteState);
}

export function stopPollingSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function unsubscribeFromFinanceChanges() {
  if (realtimeChannel) {
    const config = activeConfig ?? getCachedSyncConfig();
    const supabase = createClient(config);
    if (supabase) {
      supabase.removeChannel(realtimeChannel);
    }
    realtimeChannel = null;
  }
  stopPollingSync();
}

export async function forcePushNow(
  householdId: string,
  getState: () => FinanceState
) {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  pendingLocalChanges = true;
  notifyStatus("syncing");
  await pushFinanceState(householdId, getState());
  notifyStatus("synced");
}

export async function forcePullNow(
  householdId: string,
  applyRemoteState: (state: FinanceState) => void
) {
  notifyStatus("syncing");

  const remote = await fetchRemoteFinance(householdId);
  if (!remote) {
    notifyStatus("synced");
    return false;
  }

  applyRemoteRow(remote, applyRemoteState);
  return true;
}

export async function runInitialSyncSession(
  config: SyncConfig,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
) {
  if (syncInProgress) {
    await syncInProgress;
    return;
  }

  activeConfig = config;
  const householdId = config.householdKey;

  syncInProgress = (async () => {
    notifyStatus("syncing");

    try {
      sessionPullConfig = { householdId, getLocalState, applyRemoteState };
      clearPendingLocalChanges();
      await resolveInitialSync(householdId, getLocalState, applyRemoteState);
      subscribeToFinanceChanges(householdId, getLocalState, applyRemoteState);
      startPollingSync(householdId, getLocalState, applyRemoteState);
    } catch (err) {
      notifyStatus("error", helpfulErrorMessage(err));
      throw err;
    }
  })();

  try {
    await syncInProgress;
  } finally {
    syncInProgress = null;
  }
}

export function stopSyncSession() {
  unsubscribeFromFinanceChanges();
  activeConfig = null;
  syncInProgress = null;
  pushHouseholdId = null;
  pushStateGetter = null;
  sessionPullConfig = null;
}

export function getActiveHouseholdId() {
  return activeConfig?.householdKey ?? getHouseholdSyncKey();
}

export async function diagnoseSync(
  getLocalState: () => FinanceState
): Promise<SyncDiagnostics> {
  const config = await loadSyncConfig();
  const householdId = config?.householdKey ?? getHouseholdSyncKey();
  const steps: SyncDiagnosticStep[] = [];

  if (!config) {
    return {
      ok: false,
      configured: false,
      householdId,
      steps: [
        {
          name: "Supabase config",
          ok: false,
          message:
            "Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        },
      ],
    };
  }

  activeConfig = config;
  steps.push({
    name: "Supabase config",
    ok: true,
    message: "URL and key found",
  });

  let remote: RemoteFinanceRow | null = null;

  try {
    remote = await fetchRemoteFinance(householdId);
    steps.push({
      name: "Read cloud",
      ok: true,
      message: remote
        ? `Cloud has ${remote.data.transactions?.length ?? 0} transactions, updated ${new Date(remote.updated_at).toLocaleString()}`
        : "No cloud data yet — will upload automatically",
    });
  } catch (err) {
    steps.push({
      name: "Read cloud",
      ok: false,
      message: helpfulErrorMessage(err),
    });
    return { ok: false, configured: true, householdId, steps };
  }

  try {
    await pushFinanceState(householdId, getLocalState());
    steps.push({
      name: "Write cloud",
      ok: true,
      message: "Upload test succeeded",
    });
  } catch (err) {
    steps.push({
      name: "Write cloud",
      ok: false,
      message: helpfulErrorMessage(err),
    });
    return {
      ok: false,
      configured: true,
      householdId,
      steps,
      cloudUpdatedAt: remote?.updated_at,
      cloudTransactionCount: remote?.data.transactions?.length,
    };
  }

  return {
    ok: true,
    configured: true,
    householdId,
    steps,
    cloudUpdatedAt: remote?.updated_at,
    cloudTransactionCount: remote?.data.transactions?.length,
  };
}
