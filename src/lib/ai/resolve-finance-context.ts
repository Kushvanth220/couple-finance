import { fetchHouseholdFinance } from "@/lib/ai/chat-store";
import {
  buildFinanceContextSummary,
  buildHouseholdFinanceContextSummary,
  scopeFinanceStateForUser,
} from "@/lib/ai/finance-scope";
import type { AiUserId } from "@/lib/ai/person";
import type { FinanceState } from "@/types";

function isFinanceState(value: unknown): value is FinanceState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as FinanceState;
  return Array.isArray(candidate.accounts) && Array.isArray(candidate.transactions);
}

/** Prefer live client store data; fall back to Supabase when missing. */
export async function resolveScopedFinanceForUser(
  userId: AiUserId,
  clientFinanceState?: unknown
): Promise<FinanceState> {
  if (isFinanceState(clientFinanceState)) {
    return scopeFinanceStateForUser(clientFinanceState, userId);
  }

  const financeRaw = await fetchHouseholdFinance();
  if (!financeRaw) {
    throw new Error("No household finance data in Supabase.");
  }

  return scopeFinanceStateForUser(financeRaw as FinanceState, userId);
}

export async function resolveHouseholdFinanceContext(
  clientFinanceState?: unknown,
  compact = false
): Promise<string> {
  const state = isFinanceState(clientFinanceState)
    ? clientFinanceState
    : ((await fetchHouseholdFinance()) as FinanceState | null);

  if (!state) {
    throw new Error("No household finance data in Supabase.");
  }

  return buildHouseholdFinanceContextSummary(state, { compact });
}

export async function resolveFinanceContextForUser(
  userId: AiUserId,
  clientFinanceState?: unknown
): Promise<string> {
  const scoped = await resolveScopedFinanceForUser(userId, clientFinanceState);
  return buildFinanceContextSummary(scoped, userId);
}
