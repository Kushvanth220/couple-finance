import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const DEFAULT_HOUSEHOLD_KEY = "grik-finance-couple";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createSupabaseClient(url, key);
}

export function getHouseholdSyncKey() {
  return process.env.NEXT_PUBLIC_HOUSEHOLD_SYNC_KEY ?? DEFAULT_HOUSEHOLD_KEY;
}

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
