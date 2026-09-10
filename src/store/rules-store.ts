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
  /**
   * Ids of rules and entries that were deleted here, and when.
   *
   * Merging two devices by union is what stops a block logged on the phone
   * being wiped by the laptop's next save — but a plain union also resurrects
   * anything either side deleted. These headstones are the difference.
   */
  deleted: Record<string, string>;

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

  /** Merge the household copy into this one, in both directions. */
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
      deleted: {},

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
        const now = stamp();
        const gone: Record<string, string> = { ...(get().deleted ?? {}), [id]: now };
        for (const entry of get().entries) {
          if (entry.ruleId === id) gone[entry.id] = now;
        }
        set({
          rules: get().rules.filter((rule) => rule.id !== id),
          entries: get().entries.filter((entry) => entry.ruleId !== id),
          deleted: gone,
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
          updatedAt: stamp(),
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
            updatedAt: stamp(),
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
            const merged = { ...entry, ...updates, id: entry.id, updatedAt: stamp() };
            const rule = get().getRule(entry.ruleId);
            merged.complete = rule ? isEntryComplete(rule, merged) : merged.complete;
            return merged;
          }),
        });
        void get().syncToServer();
      },

      deleteEntry: (entryId) => {
        set({
          entries: get().entries.filter((entry) => entry.id !== entryId),
          deleted: { ...(get().deleted ?? {}), [entryId]: stamp() },
        });
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
          const remoteDeleted = (payload.deleted ?? {}) as Record<string, string>;
          const local = get();

          // Headstones from both devices. Pruned after 90 days so the document
          // does not grow forever; by then every device has seen the delete.
          const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
          const deleted: Record<string, string> = {};
          for (const [id, at] of Object.entries({
            ...remoteDeleted,
            ...(local.deleted ?? {}),
          })) {
            if (typeof at === "string" && at > cutoff) deleted[id] = at;
          }

          /**
           * Union by id, latest write winning.
           *
           * The old merge adopted only rules this device had never seen, and
           * so never pulled entries for a rule it already knew — every block
           * logged on the other phone stayed invisible here, and this device's
           * next save overwrote them. A union cannot drop a record that only
           * one side holds, which is the whole point.
           */
          const merge = <T extends { id: string }>(
            mine: T[],
            theirs: T[],
            at: (item: T) => string
          ): T[] => {
            const byId = new Map<string, T>();
            for (const item of theirs) byId.set(item.id, item);
            for (const item of mine) {
              const other = byId.get(item.id);
              if (!other || at(item) >= at(other)) byId.set(item.id, item);
            }
            return [...byId.values()].filter((item) => !deleted[item.id]);
          };

          const rules = merge(
            local.rules,
            remoteRules,
            (rule) => rule.updatedAt ?? rule.createdAt ?? ""
          );
          const liveRules = new Set(rules.map((rule) => rule.id));
          // An entry whose rule is gone has nothing left to explain it.
          const entries = merge(
            local.entries,
            remoteEntries,
            (entry) => entry.updatedAt ?? entry.openedAt ?? ""
          ).filter((entry) => liveRules.has(entry.ruleId));

          const shape = (
            rs: Rule[],
            es: RuleEntry[],
            gone: Record<string, string>
          ): string =>
            JSON.stringify([
              rs.map((r) => [r.id, r.updatedAt ?? ""]).sort(),
              es.map((e) => [e.id, e.updatedAt ?? e.openedAt ?? ""]).sort(),
              Object.keys(gone).sort(),
            ]);

          const merged = shape(rules, entries, deleted);
          // Only touch state when something actually moved, so a poll that
          // finds nothing new does not re-render every screen watching this.
          if (merged !== shape(local.rules, local.entries, local.deleted ?? {})) {
            set({ rules, entries, deleted });
          }
          // And push back whenever the server is the side that is behind.
          if (merged !== shape(remoteRules, remoteEntries, remoteDeleted)) {
            void get().syncToServer();
          }
        } catch {
          // No cloud, or the table is not created yet — local still works.
        }
      },

      syncToServer: async () => {
        try {
          await fetch("/api/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rules: get().rules,
              entries: get().entries,
              deleted: get().deleted ?? {},
            }),
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
