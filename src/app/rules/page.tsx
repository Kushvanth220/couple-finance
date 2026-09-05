"use client";

import { useMemo, useState } from "react";
import { Clock, Pause, Play, Plus, ScrollText, Table2, Trash2 } from "lucide-react";
import { CompactPageShell } from "@/components/ui/compact-page-shell";
import { GlassCard } from "@/components/ui/glass-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FlexChart, type FlexChartType } from "@/components/charts/flex-chart";
import { RuleEditor } from "@/components/rules/rule-editor";
import { RuleEntryEditor } from "@/components/rules/rule-entry-editor";
import { useRulesStore } from "@/store/rules-store";
import {
  buildRuleTable,
  describeRule,
  summariseTable,
} from "@/lib/rules/engine";
import type { Rule, RuleEntry } from "@/lib/rules/types";
import { formatCurrency } from "@/lib/formatters";
import type { Person } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The rule book.
 *
 * This is the page that makes the app's behaviour inspectable: every standing
 * instruction the assistant follows is written here, in the same words it
 * reads, and can be changed by hand. Nothing the assistant does under a rule
 * should be a surprise to someone reading this page.
 */
export default function RulesPage() {
  const rules = useRulesStore((state) => state.rules);
  const entries = useRulesStore((state) => state.entries);
  const addRule = useRulesStore((state) => state.addRule);
  const updateRule = useRulesStore((state) => state.updateRule);
  const deleteRule = useRulesStore((state) => state.deleteRule);
  const toggleRule = useRulesStore((state) => state.toggleRule);
  const openEntry = useRulesStore((state) => state.openEntry);
  const answerEntry = useRulesStore((state) => state.answerEntry);
  const deleteEntry = useRulesStore((state) => state.deleteEntry);

  const [person, setPerson] = useState<Person>("kushvanth");
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  const [loggingFor, setLoggingFor] = useState<Rule | null>(null);
  const [answering, setAnswering] = useState<{ rule: Rule; entry: RuleEntry } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Rule | null>(null);
  const [pendingEntryDelete, setPendingEntryDelete] = useState<RuleEntry | null>(null);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);

  const visible = useMemo(
    () => rules.filter((rule) => rule.scope === person || rule.scope === "household"),
    [rules, person]
  );

  const due = useRulesStore((state) => state.dueNow)();

  return (
    <CompactPageShell
      title="Rules"
      subtitle="What the app and Jarvis both follow"
      person={person}
      onPersonChange={setPerson}
      action={
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-[#007aff] px-2.5 py-1.5 text-[11px] font-semibold text-white"
        >
          <Plus className="w-3 h-3" /> New rule
        </button>
      }
    >
      {due.length > 0 ? (
        <GlassCard className="!p-0 overflow-hidden">
          <div className="border-l-[3px] border-[#ff9500] px-4 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#ff9500]">
              <Clock className="w-3 h-3" /> Waiting on you ({due.length})
            </p>
          </div>
          <div className="divide-y divide-black/5 dark:divide-white/[0.07]">
            {due.map((item) => (
              <button
                key={`${item.entry.id}-${item.followUp.id}`}
                type="button"
                onClick={() => setAnswering({ rule: item.rule, entry: item.entry })}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                <div className="min-w-0">
                  <p className="text-[13px]">{item.followUp.question}</p>
                  <p className="text-[10px] text-muted">
                    {item.rule.name} · logged {item.entry.date}
                    {item.overdueHours > 0 ? ` · ${item.overdueHours}h ago` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-[#007aff]">Answer</span>
              </button>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {visible.length === 0 ? (
        <GlassCard>
          <div className="py-6 text-center">
            <ScrollText className="mx-auto mb-2 h-6 w-6 text-muted" />
            <p className="text-[13px] font-medium">No rules yet</p>
            <p className="mx-auto mt-1 max-w-xs text-[11px] text-muted">
              A rule is how something actually works — &ldquo;Flex tips land 27 hours after the
              block, deposit is base plus tips.&rdquo; Write one here, or just tell Jarvis and it
              will write it for you.
            </p>
          </div>
        </GlassCard>
      ) : null}

      {visible.map((rule) => {
        const ruleEntries = entries.filter((entry) => entry.ruleId === rule.id);
        const table = buildRuleTable(rule, ruleEntries);
        const totals = summariseTable(table, rule);
        const expanded = openRuleId === rule.id;

        return (
          <GlassCard key={rule.id} className="!p-0 overflow-hidden">
            <div
              className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-3 dark:border-white/10"
              style={{ borderLeft: `3px solid ${rule.enabled ? "#34c759" : "#8e8e93"}` }}
            >
              <button
                type="button"
                onClick={() => setOpenRuleId(expanded ? null : rule.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold">{rule.name}</h2>
                  {rule.scope === "household" ? (
                    <span className="rounded-full bg-[#5ac8fa]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#5ac8fa]">
                      BOTH
                    </span>
                  ) : null}
                  {!rule.enabled ? (
                    <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[9px] font-semibold text-muted dark:bg-white/15">
                      PAUSED
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{describeRule(rule)}</p>
                {ruleEntries.length > 0 ? (
                  <p className="mt-1 text-[10px] text-muted">
                    {ruleEntries.length} {ruleEntries.length === 1 ? "entry" : "entries"}
                    {rule.calculations[0] && totals[rule.calculations[0].key] !== undefined
                      ? ` · ${rule.calculations[0].label} ${formatCurrency(totals[rule.calculations[0].key]!)}`
                      : ""}
                  </p>
                ) : null}
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleRule(rule.id)}
                  title={rule.enabled ? "Pause" : "Resume"}
                  className="rounded-md p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {rule.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(rule)}
                  className="rounded-md px-1.5 py-1.5 text-[11px] font-semibold text-[#007aff] hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(rule)}
                  aria-label={`Delete rule ${rule.name}`}
                  className="rounded-md p-1.5 text-[#ff3b30] hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {expanded ? (
              <div className="space-y-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setLoggingFor(rule)}
                  className="w-full rounded-xl bg-[#007aff] py-2 text-[12px] font-semibold text-white"
                >
                  Log one now
                </button>

                {rule.charts.map((chart) => {
                  const points = table.rows
                    .slice()
                    .reverse()
                    .map((row) => ({
                      label: String(row[chart.x] ?? row.date ?? ""),
                      value: Number(row[chart.y] ?? 0),
                      ...(chart.size ? { size: Number(row[chart.size] ?? 1) } : {}),
                    }));
                  const money =
                    table.columns.find((column) => column.key === chart.y)?.money ?? true;
                  return (
                    <div key={chart.id}>
                      <p className="mb-1 text-[11px] font-semibold">{chart.title}</p>
                      <FlexChart
                        type={chart.type as FlexChartType}
                        data={points}
                        money={money}
                        height={200}
                      />
                    </div>
                  );
                })}

                {table.rows.length > 0 ? (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
                      <Table2 className="h-3 w-3" /> Recorded
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[320px] text-[11px]">
                        <thead>
                          <tr className="text-muted">
                            {table.columns.map((column) => (
                              <th key={column.key} className="px-2 py-1.5 text-left font-medium">
                                {column.label}
                              </th>
                            ))}
                            <th className="px-2 py-1.5" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/[0.07]">
                          {table.rows.map((row) => {
                            const entry = ruleEntries.find(
                              (item) => item.id === row.__entryId
                            );
                            return (
                              <tr key={row.__entryId}>
                                {table.columns.map((column) => {
                                  const value = row[column.key];
                                  return (
                                    <td
                                      key={column.key}
                                      className={cn(
                                        "px-2 py-1.5",
                                        column.money && "tabular-nums font-medium"
                                      )}
                                    >
                                      {value === undefined || value === ""
                                        ? "—"
                                        : column.money
                                          ? formatCurrency(Number(value))
                                          : String(value)}
                                    </td>
                                  );
                                })}
                                <td className="px-2 py-1.5 text-right">
                                  {entry ? (
                                    <button
                                      type="button"
                                      onClick={() => setPendingEntryDelete(entry)}
                                      aria-label="Delete entry"
                                      className="text-[#ff3b30]"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-black/10 dark:border-white/15">
                            {table.columns.map((column, index) => (
                              <td
                                key={column.key}
                                className="px-2 py-1.5 text-[11px] font-semibold tabular-nums"
                              >
                                {index === 0
                                  ? "Total"
                                  : totals[column.key] !== undefined
                                    ? column.money
                                      ? formatCurrency(totals[column.key]!)
                                      : totals[column.key]
                                    : ""}
                              </td>
                            ))}
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="py-3 text-center text-[11px] text-muted">
                    Nothing logged under this rule yet.
                  </p>
                )}
              </div>
            ) : null}
          </GlassCard>
        );
      })}

      <RuleEditor
        open={creating || editing !== null}
        initial={editing ?? undefined}
        defaultScope={person}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={(draft) => {
          if (editing) updateRule(editing.id, draft);
          else addRule(draft);
          setCreating(false);
          setEditing(null);
        }}
      />

      {loggingFor ? (
        <RuleEntryEditor
          open
          rule={loggingFor}
          mode="start"
          onClose={() => setLoggingFor(null)}
          onSave={(values, date) => {
            openEntry(loggingFor.id, values, date);
            setLoggingFor(null);
            setOpenRuleId(loggingFor.id);
          }}
        />
      ) : null}

      {answering ? (
        <RuleEntryEditor
          open
          rule={answering.rule}
          entry={answering.entry}
          mode="follow_up"
          onClose={() => setAnswering(null)}
          onSave={(values) => {
            const followUp = answering.rule.followUps.find(
              (item) => !answering.entry.answered.includes(item.id)
            );
            answerEntry(answering.entry.id, values, followUp?.id);
            setAnswering(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this rule?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" and everything recorded under it will be removed.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDelete) deleteRule(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingEntryDelete !== null}
        title="Delete this entry?"
        message={pendingEntryDelete ? `The row for ${pendingEntryDelete.date} will be removed.` : ""}
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingEntryDelete) deleteEntry(pendingEntryDelete.id);
          setPendingEntryDelete(null);
        }}
        onCancel={() => setPendingEntryDelete(null)}
      />
    </CompactPageShell>
  );
}
