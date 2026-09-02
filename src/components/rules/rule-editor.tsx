"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { GlassModal } from "@/components/ui/glass-modal";
import { GlassButton } from "@/components/ui/glass-button";
import { CHART_TYPE_OPTIONS } from "@/components/charts/flex-chart";
import { validateExpression } from "@/lib/rules/engine";
import { toKey } from "@/lib/rules/from-assistant";
import {
  RULE_FIELD_TYPES,
  type Rule,
  type RuleCalculation,
  type RuleChart,
  type RuleChartType,
  type RuleField,
  type RuleFieldType,
  type RuleFollowUp,
  type RuleScope,
  type RuleTriggerKind,
} from "@/lib/rules/types";
import type { RuleDraft } from "@/store/rules-store";
import { PERSON_LABELS, type Person } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Build or change a rule by hand.
 *
 * The assistant writes most rules, but everything it can express has to be
 * editable here too — otherwise a rule that came out slightly wrong could only
 * be fixed by talking to the thing that got it wrong.
 */

const field = "mt-1 w-full glass rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#007aff]/40";
const label = "text-[11px] font-medium text-muted";
const chip = "rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors";

const TRIGGERS: { value: RuleTriggerKind; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "manual", label: "Manual" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RuleEditor({
  open,
  initial,
  defaultScope,
  onSave,
  onClose,
}: {
  open: boolean;
  initial?: Rule;
  defaultScope: Person;
  onSave: (draft: RuleDraft) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [scope, setScope] = useState<RuleScope>(initial?.scope ?? defaultScope);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerKind, setTriggerKind] = useState<RuleTriggerKind>(initial?.trigger.kind ?? "daily");
  const [question, setQuestion] = useState(initial?.trigger.question ?? "");
  const [time, setTime] = useState(initial?.trigger.time ?? "");
  const [weekday, setWeekday] = useState<number | "">(initial?.trigger.weekday ?? "");
  const [dayOfMonth, setDayOfMonth] = useState<number | "">(initial?.trigger.dayOfMonth ?? "");
  const [fields, setFields] = useState<RuleField[]>(initial?.fields ?? []);
  const [followUps, setFollowUps] = useState<RuleFollowUp[]>(initial?.followUps ?? []);
  const [calculations, setCalculations] = useState<RuleCalculation[]>(initial?.calculations ?? []);
  const [charts, setCharts] = useState<RuleChart[]>(initial?.charts ?? []);
  const [onDashboard, setOnDashboard] = useState(initial?.showOnDashboard ?? true);

  const fieldKeys = fields.map((item) => item.key);
  const knownKeys = [...fieldKeys, ...calculations.map((item) => item.key)];

  // A calculation naming a field that no longer exists is the one way this
  // form can save something that silently computes nothing.
  const calcErrors = calculations.map((calculation) => {
    const check = validateExpression(calculation.expression, fieldKeys);
    return check.ok ? null : check.error;
  });

  const canSave =
    name.trim().length > 0 && question.trim().length > 0 && calcErrors.every((error) => !error);

  const submit = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      scope,
      enabled: initial?.enabled ?? true,
      description: description.trim() || question.trim(),
      trigger: {
        kind: triggerKind,
        question: question.trim(),
        ...(time ? { time } : {}),
        ...(triggerKind === "weekly" && weekday !== "" ? { weekday: Number(weekday) } : {}),
        ...(triggerKind === "monthly" && dayOfMonth !== ""
          ? { dayOfMonth: Number(dayOfMonth) }
          : {}),
      },
      fields,
      followUps,
      calculations,
      charts: charts.filter((chart) => knownKeys.includes(chart.y)),
      payout: initial?.payout ?? { kind: "none", amountKey: "", autoPost: false },
      showOnDashboard: onDashboard,
    });
  };

  return (
    <GlassModal open={open} onClose={onClose} title={initial ? "Edit rule" : "New rule"}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div>
          <label className={label}>What is this rule called?</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Amazon Flex blocks"
            autoFocus
            className={field}
          />
        </div>

        <div>
          <label className={label}>Whose rule?</label>
          <div className="mt-1 flex gap-1.5">
            {(["kushvanth", "grishma", "household"] as RuleScope[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                className={cn(
                  chip,
                  "flex-1",
                  scope === option ? "bg-[#007aff] text-white" : "glass text-muted"
                )}
              >
                {option === "household" ? "Both" : PERSON_LABELS[option as Person]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={label}>In your own words</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="Base pay when the block finishes, tips about 27 hours later, deposit is both added up."
            className={cn(field, "resize-none")}
          />
        </div>

        <div className="rounded-xl border border-black/5 p-2.5 dark:border-white/10">
          <p className="text-[11px] font-semibold">When does it ask?</p>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {TRIGGERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTriggerKind(option.value)}
                className={cn(
                  chip,
                  triggerKind === option.value ? "bg-[#007aff] text-white" : "glass text-muted"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {triggerKind === "weekly" ? (
            <select
              value={weekday}
              onChange={(event) =>
                setWeekday(event.target.value === "" ? "" : Number(event.target.value))
              }
              className={field}
            >
              <option value="">Pick a day</option>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          ) : null}

          {triggerKind === "monthly" ? (
            <select
              value={dayOfMonth}
              onChange={(event) =>
                setDayOfMonth(event.target.value === "" ? "" : Number(event.target.value))
              }
              className={field}
            >
              <option value="">Day of month</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          ) : null}

          <div className="mt-2">
            <label className={label}>What does Jarvis ask?</label>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Any Amazon Flex blocks today?"
              className={field}
            />
          </div>

          <div className="mt-2">
            <label className={label}>Time (optional)</label>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className={field}
            />
          </div>
        </div>

        <Section
          title="What gets recorded"
          onAdd={() =>
            setFields((current) => [
              ...current,
              { key: "", label: "", type: "money", askAt: "start", required: true },
            ])
          }
        >
          {fields.map((item, index) => (
            <div key={index} className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
              <div className="flex gap-1.5">
                <input
                  value={item.label}
                  onChange={(event) => {
                    const next = event.target.value;
                    setFields((current) =>
                      current.map((row, i) =>
                        i === index
                          ? { ...row, label: next, key: row.key || toKey(next) }
                          : row
                      )
                    );
                  }}
                  placeholder="Base pay"
                  className="flex-1 glass rounded-lg px-2 py-1.5 text-[12px] outline-none"
                />
                <button
                  type="button"
                  onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
                  className="rounded-lg px-1.5 text-[#ff3b30]"
                  aria-label="Remove field"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <select
                  value={item.type}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, type: event.target.value as RuleFieldType } : row
                      )
                    )
                  }
                  className="flex-1 glass rounded-lg px-2 py-1.5 text-[11px] outline-none"
                >
                  {RULE_FIELD_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={item.askAt}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((row, i) =>
                        i === index
                          ? { ...row, askAt: event.target.value as RuleField["askAt"] }
                          : row
                      )
                    )
                  }
                  className="flex-1 glass rounded-lg px-2 py-1.5 text-[11px] outline-none"
                >
                  <option value="start">Ask at the start</option>
                  <option value="follow_up">Ask later</option>
                </select>
              </div>
              {item.key ? (
                <p className="mt-1 text-[10px] text-muted">
                  Use <code>{item.key}</code> in calculations
                </p>
              ) : null}
            </div>
          ))}
        </Section>

        <Section
          title="Ask again later"
          onAdd={() =>
            setFollowUps((current) => [
              ...current,
              { id: uuidv4(), afterHours: 27, question: "", fields: [] },
            ])
          }
        >
          {followUps.map((item, index) => (
            <div key={item.id} className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  value={item.afterHours}
                  onChange={(event) =>
                    setFollowUps((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, afterHours: Number(event.target.value) } : row
                      )
                    )
                  }
                  className="w-16 glass rounded-lg px-2 py-1.5 text-[12px] outline-none"
                />
                <span className="text-[11px] text-muted">hours later, ask</span>
                <button
                  type="button"
                  onClick={() => setFollowUps((current) => current.filter((_, i) => i !== index))}
                  className="ml-auto rounded-lg px-1.5 text-[#ff3b30]"
                  aria-label="Remove follow-up"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={item.question}
                onChange={(event) =>
                  setFollowUps((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, question: event.target.value } : row
                    )
                  )
                }
                placeholder="Any tips on that block yet?"
                className="mt-1.5 w-full glass rounded-lg px-2 py-1.5 text-[12px] outline-none"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {fields
                  .filter((f) => f.askAt === "follow_up")
                  .map((f) => {
                    const on = item.fields.includes(f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() =>
                          setFollowUps((current) =>
                            current.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    fields: on
                                      ? row.fields.filter((k) => k !== f.key)
                                      : [...row.fields, f.key],
                                  }
                                : row
                            )
                          )
                        }
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          on ? "bg-[#007aff] text-white" : "glass text-muted"
                        )}
                      >
                        {f.label || f.key}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </Section>

        <Section
          title="Work it out"
          onAdd={() =>
            setCalculations((current) => [
              ...current,
              { key: "", label: "", expression: "", money: true },
            ])
          }
        >
          {calculations.map((item, index) => (
            <div key={index} className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
              <div className="flex gap-1.5">
                <input
                  value={item.label}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCalculations((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, label: next, key: row.key || toKey(next) } : row
                      )
                    );
                  }}
                  placeholder="Total deposit"
                  className="flex-1 glass rounded-lg px-2 py-1.5 text-[12px] outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    setCalculations((current) => current.filter((_, i) => i !== index))
                  }
                  className="rounded-lg px-1.5 text-[#ff3b30]"
                  aria-label="Remove calculation"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={item.expression}
                onChange={(event) =>
                  setCalculations((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, expression: event.target.value } : row
                    )
                  )
                }
                placeholder="base_pay + tips"
                className="mt-1.5 w-full glass rounded-lg px-2 py-1.5 font-mono text-[12px] outline-none"
              />
              {calcErrors[index] ? (
                <p className="mt-1 text-[10px] text-[#ff3b30]">{calcErrors[index]}</p>
              ) : fieldKeys.length > 0 ? (
                <p className="mt-1 text-[10px] text-muted">Available: {fieldKeys.join(", ")}</p>
              ) : null}
            </div>
          ))}
        </Section>

        <Section
          title="Charts"
          onAdd={() =>
            setCharts((current) => [
              ...current,
              {
                id: uuidv4(),
                title: "",
                type: "bar",
                x: "date",
                y: knownKeys[knownKeys.length - 1] ?? "",
              },
            ])
          }
        >
          {charts.map((item, index) => (
            <div key={item.id} className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
              <div className="flex gap-1.5">
                <input
                  value={item.title}
                  onChange={(event) =>
                    setCharts((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, title: event.target.value } : row
                      )
                    )
                  }
                  placeholder="Deposit by day"
                  className="flex-1 glass rounded-lg px-2 py-1.5 text-[12px] outline-none"
                />
                <button
                  type="button"
                  onClick={() => setCharts((current) => current.filter((_, i) => i !== index))}
                  className="rounded-lg px-1.5 text-[#ff3b30]"
                  aria-label="Remove chart"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <select
                  value={item.type}
                  onChange={(event) =>
                    setCharts((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, type: event.target.value as RuleChartType } : row
                      )
                    )
                  }
                  className="flex-1 glass rounded-lg px-2 py-1.5 text-[11px] outline-none"
                >
                  {CHART_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={item.y}
                  onChange={(event) =>
                    setCharts((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, y: event.target.value } : row
                      )
                    )
                  }
                  className="flex-1 glass rounded-lg px-2 py-1.5 text-[11px] outline-none"
                >
                  <option value="">Measure…</option>
                  {knownKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </Section>

        <button
          type="button"
          onClick={() => setOnDashboard((value) => !value)}
          className="flex w-full items-center justify-between rounded-xl glass px-3 py-2.5 text-left"
        >
          <span>
            <span className="block text-xs font-semibold">Show on the dashboard</span>
            <span className="block text-[10px] text-muted">Its charts appear on the home page</span>
          </span>
          <span
            className={cn(
              "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
              onDashboard ? "bg-[#34c759]" : "bg-black/15 dark:bg-white/20"
            )}
          >
            <span
              className={cn(
                "block h-4 w-4 rounded-full bg-white transition-transform",
                onDashboard && "translate-x-4"
              )}
            />
          </span>
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <GlassButton variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </GlassButton>
        <GlassButton className="flex-1" onClick={submit} disabled={!canSave}>
          {initial ? "Save changes" : "Create rule"}
        </GlassButton>
      </div>
    </GlassModal>
  );
}

function Section({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-black/5 p-2.5 dark:border-white/10">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold">{title}</p>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-lg bg-[#007aff]/10 px-2 py-1 text-[10px] font-semibold text-[#007aff]"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}
