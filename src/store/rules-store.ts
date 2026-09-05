"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import { dueFollowUps, isEntryComplete, triggerDueToday } from "@/lib/rules/engine";
import type { DueFollowUp, Rule, RuleEntry, RuleScope } from "@/lib/rules/types";
import { householdToday } from "@/lib/household-date";

const STORAGE_KEY = "couple-finance-rules-v1";

export type RuleDraft = Omit<Rule, "id" | "createdAt" | "updatedAt">;

interface RulesState {
  rules: Rule[];
  entries: RuleEntry[];

  addRule: (draft: RuleDraft) => Rule;
  updateRule: (id: string, updates: Partial<Rule>) => void;
  deleteRule: (id: string) => void;
  toggleRule: (id: string) => void;

  /** Open an entry — the block happened, its start fields are known. */
  openEntry: (ruleId: string, values: Record<string, string | number>, date?: string) => RuleEntry | null;
  /** Fill in more values, e.g. answering the 27-hour tips question. */
  answerEntry: (entryId: string, values: Record<string, string | number>, followUpId?: string) => void;
  updateEntry: (entryId: string, updates: Partial<RuleEntry>) => void;
  deleteEntry: (entryId: string) => void;

  getRule: (id: string) => Rule | undefined;
  /** Match a rule by name, the way the assistant refers to it. */
  findRule: (match: string) => Rule[];
  rulesFor: (scope: RuleScope | "all") => Rule[];
  entriesFor: (ruleId: string) => RuleEntry[];
  openEntriesFor: (ruleId: string) => RuleEntry[];
  dueNow: (now?: Date) => DueFollowUp[];
  triggersDueToday: (now?: Date) => Rule[];
}

function stamp(): string {
  return new Date().toISOString();
}

export const useRulesStore = create<RulesState>()(
  persist(
    (set, get) => ({
      rules: [],
      entries: [],

      addRule: (draft) => {
        const rule: Rule = { ...draft, id: uuidv4(), createdAt: stamp(), updatedAt: stamp() };
        set({ rules: [...get().rules, rule] });
        return rule;
      },

      updateRule: (id, updates) => {
        set({
          rules: get().rules.map((rule) =>
            rule.id === id ? { ...rule, ...updates, id: rule.id, updatedAt: stamp() } : rule
          ),
        });
      },

      deleteRule: (id) => {
        // Entries belong to their rule; leaving them behind would haunt the
        // tables as rows nothing can explain.
        set({
          rules: get().rules.filter((rule) => rule.id !== id),
          entries: get().entries.filter((entry) => entry.ruleId !== id),
        });
      },

      toggleRule: (id) => {
        const rule = get().getRule(id);
        if (!rule) return;
        get().updateRule(id, { enabled: !rule.enabled });
      },

      openEntry: (ruleId, values, date) => {
        const rule = get().getRule(ruleId);
        if (!rule) return null;
        const entry: RuleEntry = {
          id: uuidv4(),
          ruleId,
          date: date ?? householdToday(),
          openedAt: stamp(),
          values,
          answered: [],
          complete: false,
        };
        entry.complete = isEntryComplete(rule, entry);
        set({ entries: [...get().entries, entry] });
        return entry;
      },

      answerEntry: (entryId, values, followUpId) => {
        const entries = get().entries.map((entry) => {
          if (entry.id !== entryId) return entry;
          const merged: RuleEntry = {
            ...entry,
            values: { ...entry.values, ...values },
            answered: followUpId && !entry.answered.includes(followUpId)
              ? [...entry.answered, followUpId]
              : entry.answered,
          };
          const rule = get().getRule(entry.ruleId);
          merged.complete = rule ? isEntryComplete(rule, merged) : merged.complete;
          return merged;
        });
        set({ entries });
      },

      updateEntry: (entryId, updates) => {
        set({
          entries: get().entries.map((entry) => {
            if (entry.id !== entryId) return entry;
            const merged = { ...entry, ...updates, id: entry.id };
            const rule = get().getRule(entry.ruleId);
            merged.complete = rule ? isEntryComplete(rule, merged) : merged.complete;
            return merged;
          }),
        });
      },

      deleteEntry: (entryId) => {
        set({ entries: get().entries.filter((entry) => entry.id !== entryId) });
      },

      getRule: (id) => get().rules.find((rule) => rule.id === id),

      findRule: (match) => {
        const needle = match.trim().toLowerCase();
        if (!needle) return [];
        return get().rules.filter((rule) => rule.name.toLowerCase().includes(needle));
      },

      rulesFor: (scope) => {
        const rules = get().rules;
        if (scope === "all") return rules;
        // A household rule belongs to whoever is looking at it.
        return rules.filter((rule) => rule.scope === scope || rule.scope === "household");
      },

      entriesFor: (ruleId) =>
        get()
          .entries.filter((entry) => entry.ruleId === ruleId)
          .slice()
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),

      openEntriesFor: (ruleId) =>
        get().entries.filter((entry) => entry.ruleId === ruleId && !entry.complete),

      dueNow: (now) => dueFollowUps(get().rules, get().entries, now),

      triggersDueToday: (now) => get().rules.filter((rule) => triggerDueToday(rule, now)),
    }),
    { name: STORAGE_KEY }
  )
);

/** Rules as plain text for the assistant's system prompt. */
export function getRulesForAssistant(): Rule[] {
  return useRulesStore.getState().rules.filter((rule) => rule.enabled);
}

/** Follow-ups the assistant should raise right now. */
export function getDueFollowUps(now?: Date): DueFollowUp[] {
  return useRulesStore.getState().dueNow(now);
}

// Re-exported so callers can reach the engine through the store they already
// import, rather than needing both.
export { buildRuleTable, resolveEntry, validateExpression } from "@/lib/rules/engine";
