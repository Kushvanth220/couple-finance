import { v4 as uuidv4 } from "uuid";
import { validateExpression } from "./engine";
import type {
  Rule,
  RuleCalculation,
  RuleChart,
  RuleChartType,
  RuleField,
  RuleFieldType,
  RuleFollowUp,
  RuleScope,
  RuleTrigger,
  RuleTriggerKind,
} from "./types";
import type { RuleDraft } from "@/store/rules-store";

/**
 * Turning what the model said into a rule the app can run.
 *
 * Everything here is defensive on purpose. The arguments arrive from a language
 * model describing a sentence Kushvanth spoke, so field keys arrive with spaces
 * in them, numbers arrive as strings, and a calculation can reference a field
 * that was never declared. A rule that saves in a broken state would fail
 * silently weeks later, when a follow-up quietly computes the wrong deposit.
 */

type Built<T> = { ok: true } & T;
type Failed = { ok: false; error: string };

const CHART_TYPES: RuleChartType[] = ["bar", "line", "area", "pie", "donut", "scatter", "bubble"];
const FIELD_TYPES: RuleFieldType[] = ["money", "number", "text", "date", "time"];
const TRIGGER_KINDS: RuleTriggerKind[] = ["daily", "weekly", "monthly", "manual"];

/** "Base Pay" -> "base_pay". Calculations reference these, so they must be stable. */
export function toKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f$1");
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  return [];
}

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function parseFields(raw: unknown): RuleField[] {
  return asArray(raw).flatMap<RuleField>((item) => {
    const label = String(item.label ?? item.name ?? item.key ?? "").trim();
    const key = toKey(String(item.key ?? label));
    if (!key || !label) return [];
    const type = String(item.type ?? "money").toLowerCase() as RuleFieldType;
    const askAt = String(item.ask_at ?? item.askAt ?? "start").toLowerCase();
    return [
      {
        key,
        label,
        type: FIELD_TYPES.includes(type) ? type : "money",
        askAt: askAt === "follow_up" || askAt === "followup" ? "follow_up" : "start",
        required: asBool(item.required, true),
        ...(item.question ? { question: String(item.question) } : {}),
      },
    ];
  });
}

function parseFollowUps(raw: unknown, fieldKeys: string[]): RuleFollowUp[] {
  return asArray(raw).flatMap<RuleFollowUp>((item) => {
    const afterHours = asNumber(item.after_hours ?? item.afterHours);
    const question = String(item.question ?? "").trim();
    if (afterHours === undefined || afterHours <= 0 || !question) return [];
    const fields = Array.isArray(item.fields)
      ? item.fields.map((f) => toKey(String(f))).filter((f) => fieldKeys.includes(f))
      : [];
    return [{ id: String(item.id ?? uuidv4()), afterHours, question, fields }];
  });
}

function parseCalculations(
  raw: unknown,
  fieldKeys: string[]
): { ok: true; calculations: RuleCalculation[] } | Failed {
  const calculations: RuleCalculation[] = [];

  for (const item of asArray(raw)) {
    const label = String(item.label ?? item.name ?? item.key ?? "").trim();
    const key = toKey(String(item.key ?? label));
    const expression = String(item.expression ?? item.formula ?? "").trim();
    if (!key || !expression) continue;

    // Calculations may build on earlier calculations, so each one can see the
    // keys declared before it.
    const known = [...fieldKeys, ...calculations.map((calc) => calc.key)];
    const check = validateExpression(expression, known);
    if (!check.ok) {
      return { ok: false, error: `Calculation "${label || key}": ${check.error}` };
    }

    calculations.push({
      key,
      label: label || key,
      expression,
      money: asBool(item.money, true),
    });
  }

  return { ok: true, calculations };
}

function parseCharts(raw: unknown, known: string[]): RuleChart[] {
  return asArray(raw).flatMap<RuleChart>((item) => {
    const type = String(item.type ?? "bar").toLowerCase() as RuleChartType;
    const x = toKey(String(item.x ?? "date")) || "date";
    const y = toKey(String(item.y ?? ""));
    // A chart of a column that does not exist would render an empty box.
    if (!y || !known.includes(y)) return [];
    if (x !== "date" && !known.includes(x)) return [];
    const size = item.size ? toKey(String(item.size)) : undefined;
    return [
      {
        id: String(item.id ?? uuidv4()),
        title: String(item.title ?? "").trim() || `${y} by ${x}`,
        type: CHART_TYPES.includes(type) ? type : "bar",
        x,
        y,
        ...(size && known.includes(size) ? { size } : {}),
      },
    ];
  });
}

function parseTrigger(args: Record<string, unknown>, fallback?: RuleTrigger): RuleTrigger {
  const kindRaw = String(args.trigger_kind ?? fallback?.kind ?? "daily").toLowerCase();
  const kind = TRIGGER_KINDS.includes(kindRaw as RuleTriggerKind)
    ? (kindRaw as RuleTriggerKind)
    : "daily";
  const time = String(args.trigger_time ?? fallback?.time ?? "").trim();

  return {
    kind,
    question: String(args.trigger_question ?? fallback?.question ?? "").trim(),
    ...(/^\d{1,2}:\d{2}$/.test(time) ? { time } : {}),
    ...(asNumber(args.trigger_weekday) !== undefined
      ? { weekday: asNumber(args.trigger_weekday) }
      : fallback?.weekday !== undefined
        ? { weekday: fallback.weekday }
        : {}),
    ...(asNumber(args.trigger_day_of_month) !== undefined
      ? { dayOfMonth: asNumber(args.trigger_day_of_month) }
      : fallback?.dayOfMonth !== undefined
        ? { dayOfMonth: fallback.dayOfMonth }
        : {}),
  };
}

function parseScope(raw: unknown, fallback: RuleScope = "kushvanth"): RuleScope {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "kushvanth" || value === "grishma" || value === "household") return value;
  return fallback;
}

/** Build a complete rule from a create_rule call. */
export function ruleDraftFromArgs(
  args: Record<string, unknown>
): Built<{ draft: RuleDraft }> | Failed {
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false, error: "The rule needs a name." };

  const question = String(args.trigger_question ?? "").trim();
  if (!question) return { ok: false, error: "The rule needs an opening question to ask." };

  const fields = parseFields(args.fields);
  const fieldKeys = fields.map((field) => field.key);

  const calculations = parseCalculations(args.calculations, fieldKeys);
  if (!calculations.ok) return calculations;

  const known = [...fieldKeys, ...calculations.calculations.map((calc) => calc.key)];
  const followUps = parseFollowUps(args.follow_ups, fieldKeys);
  const charts = parseCharts(args.charts, known);

  const payoutKindRaw = String(args.payout_kind ?? "none").toLowerCase();
  const payoutKind =
    payoutKindRaw === "income" || payoutKindRaw === "expense" ? payoutKindRaw : "none";
  const amountKey = toKey(String(args.payout_amount_key ?? ""));

  if (payoutKind !== "none" && amountKey && !known.includes(amountKey)) {
    return {
      ok: false,
      error: `The payout points at "${amountKey}", which the rule does not work out.`,
    };
  }

  return {
    ok: true,
    draft: {
      name,
      scope: parseScope(args.scope),
      enabled: true,
      description: String(args.description ?? "").trim() || question,
      trigger: parseTrigger(args),
      fields,
      followUps,
      calculations: calculations.calculations,
      charts,
      payout: {
        kind: payoutKind,
        amountKey,
        target: args.payout_target ? String(args.payout_target).trim() : undefined,
        // Money never moves on its own. The rule computes it; a person agrees
        // to it. This mirrors the confirmation gate on every other write.
        autoPost: false,
      },
      showOnDashboard: asBool(args.show_on_dashboard, true),
    },
  };
}

/** Build a partial update from an update_rule call, keeping what was not mentioned. */
export function ruleUpdatesFromArgs(
  args: Record<string, unknown>,
  current: Rule
): Built<{ updates: Partial<Rule> }> | Failed {
  const updates: Partial<Rule> = {};

  if (args.name != null && String(args.name).trim()) updates.name = String(args.name).trim();
  if (args.description != null) updates.description = String(args.description).trim();
  if (args.scope != null) updates.scope = parseScope(args.scope, current.scope);
  if (args.enabled != null) updates.enabled = asBool(args.enabled, current.enabled);
  if (args.show_on_dashboard != null) {
    updates.showOnDashboard = asBool(args.show_on_dashboard, current.showOnDashboard);
  }

  const touchesTrigger =
    args.trigger_kind != null ||
    args.trigger_question != null ||
    args.trigger_time != null ||
    args.trigger_weekday != null ||
    args.trigger_day_of_month != null;
  if (touchesTrigger) updates.trigger = parseTrigger(args, current.trigger);

  const fields = args.fields != null ? parseFields(args.fields) : current.fields;
  if (args.fields != null) updates.fields = fields;
  const fieldKeys = fields.map((field) => field.key);

  let calculations = current.calculations;
  if (args.calculations != null) {
    const parsed = parseCalculations(args.calculations, fieldKeys);
    if (!parsed.ok) return parsed;
    calculations = parsed.calculations;
    updates.calculations = calculations;
  }

  if (args.follow_ups != null) updates.followUps = parseFollowUps(args.follow_ups, fieldKeys);

  const known = [...fieldKeys, ...calculations.map((calc) => calc.key)];
  if (args.charts != null) updates.charts = parseCharts(args.charts, known);

  // Replacing fields can orphan a calculation that referenced an old key.
  if (args.fields != null && args.calculations == null) {
    for (const calculation of current.calculations) {
      const check = validateExpression(calculation.expression, known);
      if (!check.ok) {
        return {
          ok: false,
          error: `Changing the fields would break "${calculation.label}": ${check.error} Update the calculations in the same change.`,
        };
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: "Nothing in that changes the rule." };
  }

  return { ok: true, updates };
}

/** "base pay $62.50, tips $11.25, total deposit $73.75" — for reading back. */
export function describeRuleValues(
  rule: Rule,
  resolved: Record<string, string | number>
): string {
  const parts: string[] = [];
  const money = (value: unknown) => `$${Number(value).toFixed(2)}`;

  for (const field of rule.fields) {
    const value = resolved[field.key];
    if (value === undefined || value === "") continue;
    parts.push(`${field.label.toLowerCase()} ${field.type === "money" ? money(value) : value}`);
  }
  for (const calculation of rule.calculations) {
    const value = resolved[calculation.key];
    if (value === undefined) continue;
    parts.push(
      `${calculation.label.toLowerCase()} ${calculation.money ? money(value) : value}`
    );
  }

  return parts.length > 0 ? parts.join(", ") : "nothing recorded yet";
}
