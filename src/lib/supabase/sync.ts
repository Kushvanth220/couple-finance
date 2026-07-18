import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createClient,
  getHouseholdSyncKey,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { FinanceState } from "@/types";

export const SYNC_META_KEY = "couple-finance-sync-meta";

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

export interface SyncMeta {
  localUpdatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface RemoteFinanceRow {
  household_id: string;
  data: FinanceState;
  updated_at: string;
}

type SyncListener = (status: SyncStatus, error?: string) => void;

let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let currentHouseholdId: string | null = null;
let lastSyncError: string | null = null;
let syncInProgress: Promise<void> | null = null;
const listeners = new Set<SyncListener>();

const PUSH_DEBOUNCE_MS = 800;
const POLL_INTERVAL_MS = 10_000;

export function isApplyingRemoteSync() {
  return applyingRemote;
}

export function getLastSyncError() {
  return lastSyncError;
}

export function getCurrentHouseholdId() {
  return currentHouseholdId;
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
    return { localUpdatedAt: null, lastSyncedAt: null };
  }

  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) return { localUpdatedAt: null, lastSyncedAt: null };
    return JSON.parse(raw) as SyncMeta;
  } catch {
    return { localUpdatedAt: null, lastSyncedAt: null };
  }
}

function writeSyncMeta(meta: SyncMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

export async function fetchRemoteFinance(
  householdId: string
): Promise<RemoteFinanceRow | null> {
  const supabase = createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("household_finance")
    .select("household_id, data, updated_at")
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) throw new Error(error.message);
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
  const supabase = createClient();
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

  if (error) throw new Error(error.message);

  writeSyncMeta({
    localUpdatedAt: data.updated_at,
    lastSyncedAt: data.updated_at,
  });

  return {
    household_id: data.household_id,
    data: data.data as FinanceState,
    updated_at: data.updated_at,
  };
}

export function scheduleFinancePush(
  householdId: string,
  getState: () => FinanceState
) {
  if (applyingRemote || !isSupabaseConfigured()) return;

  if (pushTimer) clearTimeout(pushTimer);

  pushTimer = setTimeout(async () => {
    pushTimer = null;
    notifyStatus("syncing");

    try {
      await pushFinanceState(householdId, getState());
      notifyStatus("synced");
    } catch (err) {
      notifyStatus("error", err instanceof Error ? err.message : "Sync failed");
    }
  }, PUSH_DEBOUNCE_MS);
}

function applyRemoteRow(
  row: RemoteFinanceRow,
  applyRemoteState: (state: FinanceState) => void
) {
  applyingRemote = true;
  applyRemoteState(row.data);
  applyingRemote = false;
  writeSyncMeta({
    localUpdatedAt: row.updated_at,
    lastSyncedAt: row.updated_at,
  });
  notifyStatus("synced");
}

export function pullRemoteIfNewer(
  householdId: string,
  applyRemoteState: (state: FinanceState) => void
): Promise<boolean> {
  return (async () => {
    const remote = await fetchRemoteFinance(householdId);
    if (!remote) return false;

    const meta = readSyncMeta();
    const remoteTime = new Date(remote.updated_at).getTime();
    const localTime = meta.localUpdatedAt
      ? new Date(meta.localUpdatedAt).getTime()
      : 0;

    if (remoteTime <= localTime) return false;

    applyRemoteRow(remote, applyRemoteState);
    return true;
  })();
}

export async function resolveInitialSync(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<"local" | "remote" | "none"> {
  const remote = await fetchRemoteFinance(householdId);
  const meta = readSyncMeta();
  const localState = getLocalState();

  if (!remote) {
    await pushFinanceState(householdId, localState);
    notifyStatus("synced");
    return "local";
  }

  const remoteTime = new Date(remote.updated_at).getTime();
  const localTime = meta.localUpdatedAt
    ? new Date(meta.localUpdatedAt).getTime()
    : 0;
  const lastSyncedTime = meta.lastSyncedAt
    ? new Date(meta.lastSyncedAt).getTime()
    : 0;

  if (remoteTime > Math.max(localTime, lastSyncedTime)) {
    applyRemoteRow(remote, applyRemoteState);
    return "remote";
  }

  if (localTime > remoteTime) {
    await pushFinanceState(householdId, localState);
    notifyStatus("synced");
    return "local";
  }

  notifyStatus("synced");
  return "none";
}

export function subscribeToFinanceChanges(
  householdId: string,
  applyRemoteState: (state: FinanceState) => void
) {
  const supabase = createClient();
  if (!supabase) return;

  unsubscribeFromFinanceChanges();

  currentHouseholdId = householdId;
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

        const row = payload.new as RemoteFinanceRow | null;
        if (!row?.data) return;

        const meta = readSyncMeta();
        const remoteTime = new Date(row.updated_at).getTime();
        const localTime = meta.localUpdatedAt
          ? new Date(meta.localUpdatedAt).getTime()
          : 0;

        if (remoteTime <= localTime) return;

        applyRemoteRow(row, applyRemoteState);
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        notifyStatus("error", "Live sync unavailable — using periodic refresh");
      }
    });
}

export function startPollingSync(
  householdId: string,
  applyRemoteState: (state: FinanceState) => void
) {
  stopPollingSync();

  pollTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;

    void pullRemoteIfNewer(householdId, applyRemoteState).catch((err) => {
      notifyStatus(
        "error",
        err instanceof Error ? err.message : "Could not refresh data"
      );
    });
  }, POLL_INTERVAL_MS);
}

export function stopPollingSync() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function unsubscribeFromFinanceChanges() {
  if (realtimeChannel) {
    const supabase = createClient();
    if (supabase) {
      supabase.removeChannel(realtimeChannel);
    }
    realtimeChannel = null;
  }
  currentHouseholdId = null;
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
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
) {
  if (syncInProgress) {
    await syncInProgress;
    return;
  }

  syncInProgress = (async () => {
    notifyStatus("syncing");

    try {
      await resolveInitialSync(householdId, getLocalState, applyRemoteState);
      subscribeToFinanceChanges(householdId, applyRemoteState);
      startPollingSync(householdId, applyRemoteState);
    } catch (err) {
      notifyStatus(
        "error",
        err instanceof Error ? err.message : "Initial sync failed"
      );
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
  currentHouseholdId = null;
  syncInProgress = null;
}

export function getActiveHouseholdId() {
  return currentHouseholdId ?? getHouseholdSyncKey();
}
