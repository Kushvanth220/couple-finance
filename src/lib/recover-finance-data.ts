import { FINANCE_STORAGE_KEY } from "@/lib/reset-app-data";
import type { FinanceState } from "@/types";

const LEGACY_STORAGE_KEY = "couple-finance-storage";

export interface LocalBackupSummary {
  source: string;
  transactions: number;
  incomeEntries: number;
  accounts: number;
  debts: number;
  deletedHistory: number;
}

function normalizeFinanceState(state: FinanceState): FinanceState {
  return {
    ...state,
    deletedHistory: state.deletedHistory ?? [],
    spendCategories: state.spendCategories ?? [],
    greenDotTrackingStartDate: state.greenDotTrackingStartDate,
  };
}

export function readLocalFinanceBackup(): FinanceState | null {
  if (typeof window === "undefined") return null;

  let best: FinanceState | null = null;
  let bestScore = -1;

  for (const key of [FINANCE_STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as { state?: FinanceState } | FinanceState;
      const state = normalizeFinanceState(("state" in parsed && parsed.state ? parsed.state : parsed) as FinanceState);
      const score =
        (state.transactions?.length ?? 0) +
        (state.incomeEntries?.length ?? 0) +
        (state.accounts?.length ?? 0);

      if (score > bestScore) {
        best = state;
        bestScore = score;
      }
    } catch {
      continue;
    }
  }

  return best;
}

export function summarizeFinanceState(state: FinanceState): LocalBackupSummary {
  return {
    source: FINANCE_STORAGE_KEY,
    transactions: state.transactions?.length ?? 0,
    incomeEntries: state.incomeEntries?.length ?? 0,
    accounts: state.accounts?.length ?? 0,
    debts: state.debts?.length ?? 0,
    deletedHistory: state.deletedHistory?.length ?? 0,
  };
}

export function scoreFinanceState(state: FinanceState): number {
  return (
    (state.transactions?.length ?? 0) * 10 +
    (state.incomeEntries?.length ?? 0) * 5 +
    (state.accounts?.length ?? 0) +
    (state.debts?.length ?? 0)
  );
}

export function pickRicherState(a: FinanceState, b: FinanceState): FinanceState {
  return scoreFinanceState(a) >= scoreFinanceState(b) ? a : b;
}

export function downloadFinanceBackup(state: FinanceState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kg-finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseFinanceBackupJson(raw: string): FinanceState {
  const parsed = JSON.parse(raw) as FinanceState | { state: FinanceState };
  const state = ("state" in parsed && parsed.state ? parsed.state : parsed) as FinanceState;
  return normalizeFinanceState(state);
}
