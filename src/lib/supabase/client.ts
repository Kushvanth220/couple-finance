import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_HOUSEHOLD_KEY = "grik-finance-couple";

export interface SyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  householdKey: string;
}

let cachedConfig: SyncConfig | null = null;
let configPromise: Promise<SyncConfig | null> | null = null;
let cachedClient: SupabaseClient | null = null;

function configFromEnv(): SyncConfig | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    householdKey:
      process.env.NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY ?? DEFAULT_HOUSEHOLD_KEY,
  };
}

export async function loadSyncConfig(): Promise<SyncConfig | null> {
  const envConfig = configFromEnv();
  if (envConfig) {
    cachedConfig = envConfig;
    return envConfig;
  }

  if (cachedConfig) return cachedConfig;
  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const response = await fetch("/api/sync-config", { cache: "no-store" });
      if (!response.ok) return null;

      const data = (await response.json()) as {
        configured?: boolean;
        supabaseUrl?: string | null;
        supabaseAnonKey?: string | null;
        householdKey?: string;
      };

      if (!data.configured || !data.supabaseUrl || !data.supabaseAnonKey) {
        return null;
      }

      cachedConfig = {
        supabaseUrl: data.supabaseUrl,
        supabaseAnonKey: data.supabaseAnonKey,
        householdKey: data.householdKey ?? DEFAULT_HOUSEHOLD_KEY,
      };

      return cachedConfig;
    } catch {
      return null;
    } finally {
      configPromise = null;
    }
  })();

  return configPromise;
}

export function getCachedSyncConfig() {
  return cachedConfig ?? configFromEnv();
}

export function createClient(config?: SyncConfig | null) {
  const resolved = config ?? getCachedSyncConfig();
  if (!resolved) return null;

  if (
    cachedClient &&
    cachedConfig?.supabaseUrl === resolved.supabaseUrl &&
    cachedConfig?.supabaseAnonKey === resolved.supabaseAnonKey
  ) {
    return cachedClient;
  }

  cachedClient = createSupabaseClient(
    resolved.supabaseUrl,
    resolved.supabaseAnonKey
  );
  cachedConfig = resolved;
  return cachedClient;
}

export function getHouseholdSyncKey(config?: SyncConfig | null) {
  return (config ?? getCachedSyncConfig())?.householdKey ?? DEFAULT_HOUSEHOLD_KEY;
}

export function isSupabaseConfigured() {
  return Boolean(getCachedSyncConfig());
}

export async function isSupabaseConfiguredAsync() {
  const config = await loadSyncConfig();
  return Boolean(config);
}

export function resetSyncClientCache() {
  cachedConfig = null;
  cachedClient = null;
  configPromise = null;
}
