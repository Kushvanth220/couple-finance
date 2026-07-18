import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createClient,
  getCachedSyncConfig,
  getHouseholdSyncKey,
  loadSyncConfig,
  type SyncConfig,
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
}

type SyncListener = (status: SyncStatus, error?: string) => void;

let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let activeConfig: SyncConfig | null = null;
let lastSyncError: string | null = null;
let syncInProgress: Promise<void> | null = null;
const listeners = new Set<SyncListener>();

const PUSH_DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 5_000;

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
  if (applyingRemote || !activeConfig) return;

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
  const remoteTxCount = remote.data.transactions?.length ?? 0;
  const localTxCount = localState.transactions?.length ?? 0;

  if (
    remoteTime > Math.max(localTime, lastSyncedTime) ||
    (remoteTime >= localTime && remoteTxCount > localTxCount)
  ) {
    applyRemoteRow(remote, applyRemoteState);
    return "remote";
  }

  if (localTime > remoteTime || localTxCount > remoteTxCount) {
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
        notifyStatus("error", "Live sync unavailable — using refresh every 5s");
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
      notifyStatus("error", helpfulErrorMessage(err));
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
      await resolveInitialSync(householdId, getLocalState, applyRemoteState);
      subscribeToFinanceChanges(householdId, applyRemoteState);
      startPollingSync(householdId, applyRemoteState);
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
            "Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local or hosting settings.",
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

  try {
    const remote = await fetchRemoteFinance(householdId);
    steps.push({
      name: "Read cloud",
      ok: true,
      message: remote
        ? `Cloud data found (${remote.data.transactions?.length ?? 0} transactions)`
        : "No cloud data yet — will upload on first change",
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
    return { ok: false, configured: true, householdId, steps };
  }

  return { ok: true, configured: true, householdId, steps };
}
