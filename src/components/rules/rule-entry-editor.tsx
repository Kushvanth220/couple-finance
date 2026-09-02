"use client";

import { useState } from "react";
import { GlassModal } from "@/components/ui/glass-modal";
import { GlassButton } from "@/components/ui/glass-button";
import { resolveEntry } from "@/lib/rules/engine";
import { toIsoDate } from "@/lib/ai/reminders";
import type { Rule, RuleEntry } from "@/lib/rules/types";
import { formatCurrency } from "@/lib/formatters";

/**
 * Record one occurrence under a rule, or answer the question it came back to
 * ask later.
 *
 * The running total is shown as it is typed, because the whole point of the
 * Flex rule is that the deposit is base plus tips — seeing it land is the
 * confirmation that the rule was written correctly.
 */
export function RuleEntryEditor({
  open,
  rule,
  entry,
  mode,
  onSave,
  onClose,
}: {
  open: boolean;
  rule: Rule;
  entry?: RuleEntry;
  /** "start" opens a new entry; "follow_up" fills in what was pending. */
  mode: "start" | "follow_up";
  onSave: (values: Record<string, string | number>, date?: string) => void;
  onClose: () => void;
}) {
  const asked = rule.fields.filter((item) =>
    mode === "start" ? item.askAt === "start" : item.askAt === "follow_up"
  );

  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const item of asked) {
      const existing = entry?.values[item.key];
      seed[item.key] = existing === undefined ? "" : String(existing);
    }
    return seed;
  });
  const [date, setDate] = useState(entry?.date ?? toIsoDate(new Date()));

  const typed: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw === "") continue;
    const item = rule.fields.find((f) => f.key === key);
    typed[key] = item && (item.type === "money" || item.type === "number") ? Number(raw) : raw;
  }

  const preview = resolveEntry(rule, {
    id: entry?.id ?? "preview",
    ruleId: rule.id,
    date,
    openedAt: entry?.openedAt ?? new Date().toISOString(),
    values: { ...(entry?.values ?? {}), ...typed },
    answered: entry?.answered ?? [],
    complete: false,
  });

  const canSave = asked.every((item) => !item.required || values[item.key]?.trim());

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={mode === "start" ? `Log · ${rule.name}` : rule.followUps[0]?.question || "Fill in"}
    >
      <div className="space-y-3">
        {mode === "start" ? (
          <div>
            <label className="text-[11px] font-medium text-muted">Which day?</label>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
          </div>
        ) : null}

        {asked.map((item) => (
          <div key={item.key}>
            <label className="text-[11px] font-medium text-muted">
              {item.question || item.label}
            </label>
            <input
              value={values[item.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [item.key]: event.target.value }))
              }
              inputMode={item.type === "money" || item.type === "number" ? "decimal" : "text"}
              type={item.type === "date" ? "date" : item.type === "time" ? "time" : "text"}
              placeholder={item.type === "money" ? "0.00" : item.label}
              autoFocus={item === asked[0]}
              className="mt-1 w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
          </div>
        ))}

        {rule.calculations.length > 0 ? (
          <div className="rounded-xl border border-[#007aff]/25 bg-[#007aff]/[0.07] px-3 py-2">
            {rule.calculations.map((calculation) => (
              <p key={calculation.key} className="flex justify-between text-[12px]">
                <span>{calculation.label}</span>
                <span className="font-semibold tabular-nums">
                  {calculation.money
                    ? formatCurrency(Number(preview[calculation.key] ?? 0))
                    : String(preview[calculation.key] ?? 0)}
                </span>
              </p>
            ))}
            {mode === "start" && rule.followUps.length > 0 ? (
              <p className="mt-1 text-[10px] text-muted">
                {rule.followUps[0]!.question} — in {rule.followUps[0]!.afterHours}h
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <GlassButton variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </GlassButton>
          <GlassButton
            className="flex-1"
            onClick={() => canSave && onSave(typed, mode === "start" ? date : undefined)}
            disabled={!canSave}
          >
            Save
          </GlassButton>
        </div>
      </div>
    </GlassModal>
  );
}
