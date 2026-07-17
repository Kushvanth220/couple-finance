import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { FinanceState } from "@/types";

export const SYNC_META_KEY = "couple-finance-sync-meta";

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

export interface SyncMeta {
  localUpdatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface RemoteFinanceRow {
  user_id: string;
  data: FinanceState;
  updated_at: string;
}

type SyncListener = (status: SyncStatus, error?: string) => void;

let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let currentUserId: string | null = null;
const listeners = new Set<SyncListener>();

const PUSH_DEBOUNCE_MS = 800;

export function isApplyingRemoteSync() {
  return applyingRemote;
}

export function onSyncStatusChange(listener: SyncListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyStatus(status: SyncStatus, error?: string) {
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

export function writeSyncMeta(meta: SyncMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

export function markLocalUpdated() {
  const meta = readSyncMeta();
  writeSyncMeta({
    ...meta,
    localUpdatedAt: new Date().toISOString(),
  });
}

function pickFinanceState(state: Record<string, unknown>): FinanceState {
  return {
    incomeSources: (state.incomeSources as FinanceState["incomeSources"]) ?? [],
    incomeEntries: (state.incomeEntries as FinanceState["incomeEntries"]) ?? [],
    monthlyExpenses: (state.monthlyExpenses as FinanceState["monthlyExpenses"]) ?? [],
    accounts: (state.accounts as FinanceState["accounts"]) ?? [],
    debts: (state.debts as FinanceState["debts"]) ?? [],
    transactions: (state.transactions as FinanceState["transactions"]) ?? [],
    interCoupleHistory:
      (state.interCoupleHistory as FinanceState["interCoupleHistory"]) ?? [],
    interCoupleBalance: (state.interCoupleBalance as number) ?? 0,
  };
}

export async function fetchRemoteFinance(
  userId: string
): Promise<RemoteFinanceRow | null> {
  const supabase = createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("household_finance")
    .select("user_id, data, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    user_id: data.user_id,
    data: data.data as FinanceState,
    updated_at: data.updated_at,
  };
}

export async function pushFinanceState(
  userId: string,
  state: FinanceState
): Promise<RemoteFinanceRow> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const payload = {
    user_id: userId,
    data: state,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("household_finance")
    .upsert(payload, { onConflict: "user_id" })
    .select("user_id, data, updated_at")
    .single();

  if (error) throw new Error(error.message);

  const meta = readSyncMeta();
  writeSyncMeta({
    localUpdatedAt: data.updated_at,
    lastSyncedAt: data.updated_at,
  });

  return {
    user_id: data.user_id,
    data: data.data as FinanceState,
    updated_at: data.updated_at,
  };
}

export function scheduleFinancePush(
  userId: string,
  getState: () => FinanceState
) {
  if (applyingRemote || !isSupabaseConfigured()) return;

  markLocalUpdated();

  if (pushTimer) clearTimeout(pushTimer);

  pushTimer = setTimeout(async () => {
    pushTimer = null;
    notifyStatus("syncing");

    try {
      await pushFinanceState(userId, getState());
      notifyStatus("synced");
    } catch (err) {
      notifyStatus("error", err instanceof Error ? err.message : "Sync failed");
    }
  }, PUSH_DEBOUNCE_MS);
}

export async function resolveInitialSync(
  userId: string,
  getLocalState: () => FinanceState,
  applyRemoteState: (state: FinanceState) => void
): Promise<"local" | "remote" | "none"> {
  const remote = await fetchRemoteFinance(userId);
  const meta = readSyncMeta();
  const localState = getLocalState();

  if (!remote) {
    await pushFinanceState(userId, localState);
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
    applyingRemote = true;
    applyRemoteState(remote.data);
    applyingRemote = false;
    writeSyncMeta({
      localUpdatedAt: remote.updated_at,
      lastSyncedAt: remote.updated_at,
    });
    notifyStatus("synced");
    return "remote";
  }

  if (localTime > remoteTime) {
    await pushFinanceState(userId, localState);
    notifyStatus("synced");
    return "local";
  }

  notifyStatus("synced");
  return "none";
}

export function subscribeToFinanceChanges(
  userId: string,
  applyRemoteState: (state: FinanceState) => void
) {
  const supabase = createClient();
  if (!supabase) return;

  unsubscribeFromFinanceChanges();

  currentUserId = userId;
  realtimeChannel = supabase
    .channel(`household_finance:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "household_finance",
        filter: `user_id=eq.${userId}`,
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

        applyingRemote = true;
        applyRemoteState(row.data);
        applyingRemote = false;
        writeSyncMeta({
          localUpdatedAt: row.updated_at,
          lastSyncedAt: row.updated_at,
        });
        notifyStatus("synced");
      }
    )
    .subscribe();
}

export function unsubscribeFromFinanceChanges() {
  if (realtimeChannel) {
    const supabase = createClient();
    if (supabase) {
      supabase.removeChannel(realtimeChannel);
    }
    realtimeChannel = null;
  }
  currentUserId = null;
}

export function getCurrentSyncUserId() {
  return currentUserId;
}

export async function forcePushNow(
  userId: string,
  getState: () => FinanceState
) {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }

  notifyStatus("syncing");
  await pushFinanceState(userId, getState());
  notifyStatus("synced");
}

export { pickFinanceState };
