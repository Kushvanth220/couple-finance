import type { FinanceState } from "@/types";
import householdFinance from "@/data/household-finance.json";

type HouseholdFinanceExport = {
  household_id: string;
  updated_at?: string;
  data: FinanceState;
};

const exportPayload = householdFinance as HouseholdFinanceExport;

function normalizeFinanceState(state: FinanceState): FinanceState {
  return {
    ...state,
    deletedHistory: state.deletedHistory ?? [],
    spendCategories: state.spendCategories ?? [],
  };
}

/** Bundled household snapshot — used as default app data and first cloud upload. */
export const seedData: FinanceState = normalizeFinanceState(exportPayload.data);

export const HOUSEHOLD_SEED_ID = exportPayload.household_id ?? "grik-finance-couple";

export const HOUSEHOLD_SEED_UPDATED_AT = exportPayload.updated_at ?? null;

export function getBundledSeedSummary() {
  return {
    householdId: HOUSEHOLD_SEED_ID,
    updatedAt: HOUSEHOLD_SEED_UPDATED_AT,
    transactions: seedData.transactions?.length ?? 0,
    accounts: seedData.accounts?.length ?? 0,
    incomeEntries: seedData.incomeEntries?.length ?? 0,
  };
}
