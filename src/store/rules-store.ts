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

  /** Pull the household copy; adopts it when nothing is stored here yet. */
  hydrateFromServer: () => Promise<void>;
  /** Push the current rules and entries. Fire-and-forget after every change. */
  syncToServer: () => Promise<void>;
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
        void get().syncToServer();
        return rule;
      },

      updateRule: (id, updates) => {
        set({
          rules: get().rules.map((rule) =>
            rule.id === id ? { ...rule, ...updates, id: rule.id, updatedAt: stamp() } : rule
          ),
        });
        void get().syncToServer();
      },

      deleteRule: (id) => {
        // Entries belong to their rule; leaving them behind would haunt the
        // tables as rows nothing can explain.
        set({
          rules: get().rules.filter((rule) => rule.id !== id),
          entries: get().entries.filter((entry) => entry.ruleId !== id),
        });
        void get().syncToServer();
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
        void get().syncToServer();
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
        void get().syncToServer();
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
        void get().syncToServer();
      },

      deleteEntry: (entryId) => {
        set({ entries: get().entries.filter((entry) => entry.id !== entryId) });
        void get().syncToServer();
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

      hydrateFromServer: async () => {
        try {
          const response = await fetch("/api/rules", { cache: "no-store" });
          const payload = await response.json();
          if (!payload.ok || !payload.synced) return;

          // A rule arriving without a scope would match neither person on the
          // Rules page — invisible, and so impossible to edit or delete while
          // it kept syncing. Anything unrecognised is treated as household's,
          // which at least puts it on screen where it can be dealt with.
          const remoteRules = ((payload.rules ?? []) as Rule[])
            .filter((rule) => rule && typeof rule.id === "string" && rule.id)
            .map((rule) => ({
              ...rule,
              scope:
                rule.scope === "kushvanth" || rule.scope === "grishma"
                  ? rule.scope
                  : ("household" as const),
              enabled: rule.enabled !== false,
              fields: Array.isArray(rule.fields) ? rule.fields : [],
              followUps: Array.isArray(rule.followUps) ? rule.followUps : [],
              calculations: Array.isArray(rule.calculations) ? rule.calculations : [],
              charts: Array.isArray(rule.charts) ? rule.charts : [],
            }));
          const remoteEntries = ((payload.entries ?? []) as RuleEntry[]).filter(
            (entry) => entry && typeof entry.id === "string" && entry.ruleId
          );
          const local = get();

          // Local is the working copy and wins while it holds anything. The
          // remote is here for the case that actually hurt: storage emptied,
          // and the only surviving copy is the household one.
          if (local.rules.length === 0 && remoteRules.length > 0) {
            set({ rules: remoteRules, entries: remoteEntries });
            return;
          }

          // Otherwise adopt only rules this device has never seen, so a rule
          // written on the other phone appears without disturbing anything here.
          const known = new Set(local.rules.map((rule) => rule.id));
          const added = remoteRules.filter((rule) => !known.has(rule.id));
          if (added.length === 0) return;

          const addedIds = new Set(added.map((rule) => rule.id));
          const addedEntries = remoteEntries.filter((entry) => addedIds.has(entry.ruleId));
          set({
            rules: [...local.rules, ...added],
            entries: [...local.entries, ...addedEntries],
          });
        } catch {
          // No cloud, or the table is not created yet — local still works.
        }
      },

      syncToServer: async () => {
        try {
          await fetch("/api/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rules: get().rules, entries: get().entries }),
          });
        } catch {
          // Offline is fine; the next change pushes the whole document again.
        }
      },
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
