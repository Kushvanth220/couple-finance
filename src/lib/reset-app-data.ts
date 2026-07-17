export const FINANCE_STORAGE_KEY = "couple-finance-storage-v2";

const LEGACY_STORAGE_KEY = "couple-finance-storage";

const REMINDER_KEYS = [
  "couple-finance-dismissed-reminders",
  "couple-finance-notified-reminders",
] as const;

/** Remove all persisted finance and reminder data from localStorage. */
export function clearPersistedAppData() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(FINANCE_STORAGE_KEY);

  for (const key of REMINDER_KEYS) {
    localStorage.removeItem(key);
  }
}
