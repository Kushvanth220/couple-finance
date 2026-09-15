import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createClient,
  getCachedSyncConfig,
  getHouseholdSyncKey,
  loadSyncConfig,
  type SyncConfig,
} from "@/lib/supabase/client";
import type { FinanceState } from "@/types";
import { pickRicherState, readLocalFinanceBackup, scoreFinanceState } from "@/lib/recover-finance-data";
import { mergeFinanceStates } from "@/lib/finance-merge";
import { seedData } from "@/lib/seed-data";

/** Bumped to reset stale per-device sync timestamps from older builds. */
export const SYNC_META_KEY = "couple-finance-sync-meta-v5";
/**
 * The last state this phone and the cloud agreed on. It is what a three-way
 * merge needs to tell "added here" from "deleted there" when both phones
 * have moved since. Written after every successful push or pull.
 */
const SYNC_BASE_KEY = "couple-finance-sync-base-v1";
const SYNC_PROJECT_KEY = "couple-finance-sync-project-url";

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
const initialSyncListeners = new Set<() => void>();

let initialSyncComplete = typeof window === "undefined";
let cloudReachable = false;

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

export function isInitialSyncComplete() {
  return initialSyncComplete;
}

export function onInitialSyncComplete(listener: () => void) {
  if (initialSyncComplete) {
    listener();
    return () => {};
  }

  initialSyncListeners.add(listener);
  return () => {
    initialSyncListeners.delete(listener);
  };
}

export function markInitialSyncComplete() {
  if (initialSyncComplete) return;
  initialSyncComplete = true;
  for (const listener of initialSyncListeners) {
    listener();
  }
  initialSyncListeners.clear();
}

/** Clear stale sync timestamps when switching Supabase projects. */
export function ensureSyncProjectForConfig(config: SyncConfig) {
  if (typeof window === "undefined") return;

  const previousUrl = localStorage.getItem(SYNC_PROJECT_KEY);
  if (previousUrl && previousUrl !== config.supabaseUrl) {
    localStorage.removeItem(SYNC_META_KEY);
  }

  localStorage.setItem(SYNC_PROJECT_KEY, config.supabaseUrl);
}

let currentStatus: SyncStatus = "idle";
let lastCheckedAt: string | null = null;

/** When this phone last heard back from the cloud, whether or not anything changed. */
export function getLastCheckedAt(): string | null {
  return lastCheckedAt;
}

/** The status as of the last event, for a page that mounts between events. */
export function getCurrentSyncStatus(): SyncStatus {
  return currentStatus;
}

/** Edits made here that have not reached the cloud yet. */
export function hasPendingLocalChanges(): boolean {
  return pendingLocalChanges || Boolean(readSyncMeta().lastLocalEditAt);
}

/** A sync on demand: send what is waiting, then pick up what is new. */
export async function syncNow(): Promise<void> {
  if (!sessionPullConfig) return;
  await runAutoSyncCycle(
    sessionPullConfig.householdId,
    sessionPullConfig.getLocalState,
    sessionPullConfig.applyRemoteState
  );
}

function notifyStatus(status: SyncStatus, error?: string) {
  currentStatus = status;
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

function readSyncBase(): RemoteFinanceRow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SYNC_BASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RemoteFinanceRow>;
    return parsed && parsed.data && typeof parsed.updated_at === "string" ? (parsed as RemoteFinanceRow) : null;
  } catch {
    return null;
  }
}

function writeSyncBase(row: RemoteFinanceRow) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(row));
  } catch {
    // Out of room: the next merge falls back to a union, which loses nothing.
  }
}

/** Has the cloud changed since this phone last agreed with it? */
function cloudMovedSince(remote: RemoteFinanceRow, meta = readSyncMeta()): boolean {
  return !meta.lastSyncedAt || remote.updated_at !== meta.lastSyncedAt;
}

/** Anything typed here that the cloud has not yet been told about. */
function hasUnsyncedLocalEdits(meta = readSyncMeta()): boolean {
  return pendingLocalChanges || Boolean(meta.lastLocalEditAt);
}

/**
 * Both sides moved: fold the cloud's changes and ours together, show the
 * result here, and send it up — so neither phone's work is lost.
 */
async function mergeAndPush(
  householdId: string,
  remote: RemoteFinanceRow,
  localState: FinanceState,
  applyRemoteState: (state: FinanceState) => void,
  attempt = 0
): Promise<RemoteFinanceRow> {
  const base = readSyncBase();
  const merged = mergeFinanceStates(base?.data ?? null, localState, remote.data);
  applyingRemote = true;
  applyRemoteState(merged);
  applyingRemote = false;
  try {
    const row = await pushFinanceState(householdId, merged, {
      skipSafetyCheck: true,
      expectStamp: remote.updated_at,
    });
    notifyStatus("synced");
    return row;
  } catch (error) {
    // The other phone saved between our read and our write: read again and
    // fold that in too. Two tries covers any realistic race.
    if (error instanceof SyncConflictError && attempt < 2) {
      const fresh = await fetchRemoteFinance(householdId);
      if (fresh) return mergeAndPush(householdId, fresh, merged, applyRemoteState, attempt + 1);
    }
    throw error;
  }
}

function countFinanceRecords(state: FinanceState): number {
  return (
    (state.transactions?.length ?? 0) +
    (state.incomeEntries?.length ?? 0) +
    (state.accounts?.length ?? 0) +
    (state.debts?.length ?? 0) +
    (state.incomeSources?.length ?? 0)
  );
}

/** True when downloading remote state would erase meaningful local history. */
export function wouldWipeLocalData(remote: FinanceState, local: FinanceState): boolean {
  const remoteTx = remote.transactions?.length ?? 0;
  const localTx = local.transactions?.length ?? 0;
  const remoteRecords = countFinanceRecords(remote);
  const localRecords = countFinanceRecords(local);

  if (localTx > 0 && remoteTx === 0) return true;
  if (localRecords > 10 && remoteRecords < localRecords * 0.25) return true;
  if (localTx >= 5 && remoteTx < Math.ceil(localTx * 0.2)) return true;

  return false;
}

/** True when uploading local state would erase meaningful cloud history. */
export function wouldWipeRemoteData(remote: FinanceState, local: FinanceState): boolean {
  const remoteTx = remote.transactions?.length ?? 0;
  const localTx = local.transactions?.length ?? 0;
  const remoteRecords = countFinanceRecords(remote);
  const localRecords = countFinanceRecords(local);

  if (remoteTx > 0 && localTx === 0) return true;
  if (remoteRecords > 10 && localRecords < remoteRecords * 0.25) return true;
  if (remoteTx >= 5 && localTx < Math.ceil(remoteTx * 0.2)) return true;

  return false;
}

function assertSafeToPush(remote: FinanceState | null, local: FinanceState) {
  if (!remote) return;
  if (wouldWipeRemoteData(remote, local)) {
    throw new Error(
      "Blocked upload — your device data looks empty compared to the cloud. Restoring from cloud instead."
    );
  }
}

function helpfulErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";

  if (
    message.includes("Failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("ENOTFOUND") ||
    message.includes("getaddrinfo") ||
    message.includes("could not be resolved")
  ) {
    return "Cannot reach Supabase. Copy the exact Project URL from Supabase → Settings → API into .env.local, then restart the app.";
  }

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

export function isCloudReachable() {
  return cloudReachable;
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
  // Any answer from the cloud proves it is there. Without this, one failed
  // fetch at launch left the whole session refusing to upload.
  cloudReachable = true;
  lastCheckedAt = new Date().toISOString();
  if (!data) return null;

  return {
    household_id: data.household_id,
    data: data.data as FinanceState,
    updated_at: data.updated_at,
  };
}

/** Just the cloud's timestamp — a few bytes, so polling can stay cheap. */
async function fetchRemoteStamp(householdId: string): Promise<string | null> {
  const config = getConfigOrThrow();
  const supabase = createClient(config);
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("household_finance")
    .select("updated_at")
    .eq("household_id", householdId)
    .maybeSingle();
  if (error) throw new Error(helpfulErrorMessage(error));
  cloudReachable = true;
  lastCheckedAt = new Date().toISOString();
  return data?.updated_at ?? null;
}

/** Thrown when the cloud changed under a push; the caller merges again and retries. */
export class SyncConflictError extends Error {
  constructor() {
    super("The cloud changed while saving; merging again.");
    this.name = "SyncConflictError";
  }
}

export async function pushFinanceState(
  householdId: string,
  state: FinanceState,
  options?: {
    skipSafetyCheck?: boolean;
    /**
     * The cloud stamp this state was built on. The save only lands if the
     * cloud still carries it — otherwise the other phone saved in between,
     * and writing now would bury that save.
     */
    expectStamp?: string;
  }
): Promise<RemoteFinanceRow> {
  if (!cloudReachable && !options?.skipSafetyCheck) {
    throw new Error(
      "Cloud is unreachable — upload blocked to protect your database. Fix the Supabase URL first."
    );
  }

  const config = getConfigOrThrow();
  const supabase = createClient(config);
  if (!supabase) throw new Error("Supabase is not configured");

  if (!options?.skipSafetyCheck) {
    const existing = await fetchRemoteFinance(householdId);
    assertSafeToPush(existing?.data ?? null, state);
  }

  let data: { household_id: string; data: unknown; updated_at: string };
  if (options?.expectStamp) {
    const result = await supabase
      .from("household_finance")
      .update({ data: state })
      .eq("household_id", householdId)
      .eq("updated_at", options.expectStamp)
      .select("household_id, data, updated_at")
      .maybeSingle();
    if (result.error) throw new Error(helpfulErrorMessage(result.error));
    if (!result.data) throw new SyncConflictError();
    data = result.data;
  } else {
    const result = await supabase
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
    if (result.error) throw new Error(helpfulErrorMessage(result.error));
    data = result.data;
  }

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
  writeSyncBase(row);

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
      await pushLocalState(householdId, getState);
    } catch (err) {
      const message = helpfulErrorMessage(err);
      if (message.includes("Blocked upload") && sessionPullConfig) {
        try {
          await forcePullNow(householdId, sessionPullConfig.applyRemoteState);
          notifyStatus("synced");
          return;
        } catch {
          // fall through
        }
      }
      notifyStatus("error", message);
    }
  }, PUSH_DEBOUNCE_MS);
}

/**
 * Send this phone's edits up without burying anyone else's. If the cloud
 * moved since we last agreed with it, merge first; either way the save is
 * conditional on the stamp we read, so a save that lands in between is
 * folded in rather than overwritten.
 */
async function pushLocalState(householdId: string, getState: () => FinanceState) {
  const localState = getState();
  const existing = await fetchRemoteFinance(householdId);

  if (existing && sessionPullConfig) {
    if (cloudMovedSince(existing) || wouldWipeRemoteData(existing.data, localState)) {
      await mergeAndPush(householdId, existing, localState, sessionPullConfig.applyRemoteState);
      return;
    }
    try {
      await pushFinanceState(householdId, localState, { expectStamp: existing.updated_at });
      notifyStatus("synced");
      return;
    } catch (error) {
      if (!(error instanceof SyncConflictError)) throw error;
      const fresh = await fetchRemoteFinance(householdId);
      if (fresh) {
        await mergeAndPush(householdId, fresh, getState(), sessionPullConfig.applyRemoteState);
        return;
      }
    }
  }

  await pushFinanceState(householdId, localState);
  notifyStatus("synced");
}

export async function flushPendingPush() {
  if (!pendingLocalChanges || !pushHouseholdId || !pushStateGetter) return;

  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  notifyStatus("syncing");
  await pushLocalState(pushHouseholdId, pushStateGetter);
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
  writeSyncBase(row);
  notifyStatus("synced");
}

function ensureBestLocalState(
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): FinanceState {
  const backup = readLocalFinanceBackup();
  const current = getLocalState();
  if (!backup) return current;

  const best = pickRicherState(backup, current);
  if (scoreFinanceState(best) > scoreFinanceState(current)) {
    applyingRemote = true;
    applyRemoteState(best);
    applyingRemote = false;
    return best;
  }

  return current;
}


/**
 * Bring this phone level with the cloud. Nothing to do when the cloud has
 * not moved; a plain pull when only the cloud moved; a merge when both did.
 */
async function reconcileWithRemote(
  householdId: string,
  remote: RemoteFinanceRow,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<boolean> {
  if (!cloudMovedSince(remote)) return false;
  const localState = getLocalState();

  if (hasUnsyncedLocalEdits()) {
    await mergeAndPush(householdId, remote, localState, applyRemoteState);
    return true;
  }

  // A cloud row that has lost most of what this phone holds is a reset or a
  // bad upload, not the other phone's edits; merging keeps everything.
  if (wouldWipeLocalData(remote.data, localState)) {
    await mergeAndPush(householdId, remote, localState, applyRemoteState);
    return true;
  }

  applyRemoteRow(remote, applyRemoteState);
  return true;
}

export function pullRemoteIfNewer(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<boolean> {
  return (async () => {
    // Cheap check first; the full row only when the stamp says it changed.
    const stamp = await fetchRemoteStamp(householdId);
    if (!stamp) return false;
    if (stamp === readSyncMeta().lastSyncedAt) return false;

    const remote = await fetchRemoteFinance(householdId);
    if (!remote) return false;
    return reconcileWithRemote(householdId, remote, getLocalState, applyRemoteState);
  })();
}

export async function resolveInitialSync(
  householdId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<"local" | "remote" | "none"> {
  clearPendingLocalChanges();
  cloudReachable = false;

  const localState = ensureBestLocalState(getLocalState, applyRemoteState);
  let remote: RemoteFinanceRow | null;

  try {
    remote = await fetchRemoteFinance(householdId);
    cloudReachable = true;
  } catch (err) {
    notifyStatus("error", helpfulErrorMessage(err));
    return "none";
  }

  const meta = readSyncMeta();

  if (!remote) {
    const best = pickRicherState(seedData, localState);

    if (scoreFinanceState(best) > 0) {
      applyingRemote = true;
      applyRemoteState(best);
      applyingRemote = false;
      await pushFinanceState(householdId, best, { skipSafetyCheck: true });
      notifyStatus("synced");
      return "local";
    }

    notifyStatus(
      "error",
      `No cloud row for household "${householdId}" and no bundled data to upload.`
    );
    return "none";
  }

  if (
    scoreFinanceState(remote.data) < scoreFinanceState(seedData) - 50 &&
    scoreFinanceState(localState) < scoreFinanceState(seedData) - 50
  ) {
    applyingRemote = true;
    applyRemoteState(seedData);
    applyingRemote = false;
    await pushFinanceState(householdId, seedData, { skipSafetyCheck: true });
    notifyStatus("synced");
    return "local";
  }

  const moved = cloudMovedSince(remote, meta);
  const edits = Boolean(meta.lastLocalEditAt);

  // Both sides changed since this phone last agreed with the cloud — or one
  // of them looks wiped: fold them together rather than pick a winner.
  if (
    (moved && edits) ||
    wouldWipeLocalData(remote.data, localState) ||
    wouldWipeRemoteData(remote.data, localState)
  ) {
    await mergeAndPush(householdId, remote, localState, applyRemoteState);
    return "local";
  }

  if (edits) {
    await pushFinanceState(householdId, localState);
    notifyStatus("synced");
    return "local";
  }

  if (moved || scoreFinanceState(remote.data) > scoreFinanceState(localState) + 50) {
    applyRemoteRow(remote, applyRemoteState);
    return "remote";
  }

  // Level already: remember this as the point of agreement, so the next
  // merge has a base to reason from.
  writeSyncBase(remote);
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
            await reconcileWithRemote(householdId, remote, getLocalState, applyRemoteState);
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
  ensureBestLocalState(getLocalState, applyRemoteState);

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
  getState: () => FinanceState,
  options?: { skipSafetyCheck?: boolean }
) {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  pendingLocalChanges = true;
  notifyStatus("syncing");
  await pushFinanceState(householdId, getState(), options);
  notifyStatus("synced");
}

export async function restoreFinanceBackupToCloud(
  householdId: string,
  backup: FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<RemoteFinanceRow> {
  applyRemoteState(backup);
  return pushFinanceState(householdId, backup, { skipSafetyCheck: true });
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
      ensureSyncProjectForConfig(config);
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
    const localState = getLocalState();
    if (remote && wouldWipeRemoteData(remote.data, localState)) {
      steps.push({
        name: "Write cloud",
        ok: true,
        message: "Skipped test upload — cloud has more data than this device",
      });
    } else {
      await pushFinanceState(householdId, localState);
      steps.push({
        name: "Write cloud",
        ok: true,
        message: "Upload test succeeded",
      });
    }
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
