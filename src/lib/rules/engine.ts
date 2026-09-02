import { roundMoney } from "@/lib/money";
import type {
  DueFollowUp,
  Rule,
  RuleEntry,
  RuleField,
  RuleFollowUp,
} from "./types";

/**
 * The rule engine: works out what a rule computes, what it is still waiting
 * for, and when to ask.
 *
 * Expressions are PARSED, never evaluated as code. They arrive from chat, so
 * `eval` here would let a sentence become a program. A tiny recursive-descent
 * parser over + - * / ( ) and field names covers everything a household rule
 * has needed, and refuses anything it does not recognise.
 */

type Token = { kind: "num"; value: number } | { kind: "name"; value: string } | { kind: "op"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let raw = "";
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        raw += input[i];
        i += 1;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Not a number: "${raw}"`);
      tokens.push({ kind: "num", value });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let raw = "";
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i]!)) {
        raw += input[i];
        i += 1;
      }
      tokens.push({ kind: "name", value: raw });
      continue;
    }

    if ("+-*/()".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }

    throw new Error(`Cannot use "${ch}" in a calculation.`);
  }

  return tokens;
}

/**
 * Arithmetic over the entry's values. Unknown names resolve to 0 rather than
 * throwing: a Flex block logged before its tips are known should still show a
 * running total, not an error.
 */
export function evaluateExpression(
  expression: string,
  values: Record<string, string | number>
): number {
  const tokens = tokenize(expression);
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (value: string) => {
    const token = peek();
    if (token && token.kind === "op" && token.value === value) {
      pos += 1;
      return true;
    }
    return false;
  };

  // primary := number | name | "(" expr ")" | "-" primary
  function primary(): number {
    if (eat("(")) {
      const inner = expr();
      if (!eat(")")) throw new Error("Missing a closing bracket.");
      return inner;
    }
    if (eat("-")) return -primary();
    if (eat("+")) return primary();

    const token = peek();
    if (!token) throw new Error("The calculation stops in the middle.");
    pos += 1;

    if (token.kind === "num") return token.value;
    if (token.kind === "name") {
      const raw = values[token.value];
      const num = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(num) ? num : 0;
    }
    throw new Error(`Did not expect "${token.value}" here.`);
  }

  function term(): number {
    let left = primary();
    for (;;) {
      if (eat("*")) left *= primary();
      else if (eat("/")) {
        const right = primary();
        // Dividing by nothing yields nothing, not Infinity on a money screen.
        left = right === 0 ? 0 : left / right;
      } else return left;
    }
  }

  function expr(): number {
    let left = term();
    for (;;) {
      if (eat("+")) left += term();
      else if (eat("-")) left -= term();
      else return left;
    }
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error("There is leftover text in the calculation.");
  return Number.isFinite(result) ? result : 0;
}

/** Check an expression before saving it, so a bad rule fails at write time. */
export function validateExpression(
  expression: string,
  fieldKeys: string[]
): { ok: true } | { ok: false; error: string } {
  if (!expression.trim()) return { ok: false, error: "The calculation is empty." };
  try {
    const probe: Record<string, number> = {};
    for (const key of fieldKeys) probe[key] = 1;
    evaluateExpression(expression, probe);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Bad calculation." };
  }

  const used = expression.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  const unknown = used.filter((name) => !fieldKeys.includes(name));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `The calculation mentions ${unknown.map((n) => `"${n}"`).join(", ")}, which the rule does not collect.`,
    };
  }
  return { ok: true };
}

/** Every field plus every calculation, resolved for one entry. */
export function resolveEntry(rule: Rule, entry: RuleEntry): Record<string, number | string> {
  const resolved: Record<string, number | string> = { ...entry.values };

  for (const calculation of rule.calculations) {
    try {
      const value = evaluateExpression(calculation.expression, resolved);
      resolved[calculation.key] = calculation.money ? roundMoney(value) : value;
    } catch {
      resolved[calculation.key] = 0;
    }
  }

  return resolved;
}

function fieldsAskedAt(rule: Rule, when: RuleField["askAt"]): RuleField[] {
  return rule.fields.filter((field) => field.askAt === when);
}

/** Fields still missing from an entry, so the assistant knows what to ask. */
export function missingFields(rule: Rule, entry: RuleEntry): RuleField[] {
  return rule.fields.filter((field) => {
    if (!field.required) return false;
    const value = entry.values[field.key];
    return value === undefined || value === "" || value === null;
  });
}

/**
 * Complete means nothing more to collect — every required field filled AND
 * every follow-up answered.
 *
 * The follow-up half matters: a Flex block whose tips are optional would
 * otherwise be "complete" the moment the base pay was logged, while the rule
 * was still going to come back 27 hours later and ask about tips.
 */
export function isEntryComplete(rule: Rule, entry: RuleEntry): boolean {
  if (missingFields(rule, entry).length > 0) return false;
  return rule.followUps.every((followUp) => entry.answered.includes(followUp.id));
}

/** When a follow-up on this entry comes due. */
export function followUpDueAt(entry: RuleEntry, followUp: RuleFollowUp): Date {
  const opened = new Date(entry.openedAt);
  return new Date(opened.getTime() + followUp.afterHours * 3_600_000);
}

/**
 * Follow-ups that are due now and still unanswered, oldest first.
 *
 * This is what turns "ask me about tips 27 hours later" from a note into
 * something the assistant actually raises on its own.
 */
export function dueFollowUps(
  rules: Rule[],
  entries: RuleEntry[],
  now: Date = new Date()
): DueFollowUp[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const due: DueFollowUp[] = [];

  for (const entry of entries) {
    const rule = byId.get(entry.ruleId);
    if (!rule || !rule.enabled) continue;

    for (const followUp of rule.followUps) {
      if (entry.answered.includes(followUp.id)) continue;
      const dueAt = followUpDueAt(entry, followUp);
      if (dueAt > now) continue;
      due.push({
        rule,
        entry,
        followUp,
        dueAt,
        overdueHours: Math.floor((now.getTime() - dueAt.getTime()) / 3_600_000),
      });
    }
  }

  return due.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/** Should the rule's opening question be asked today? */
export function triggerDueToday(rule: Rule, now: Date = new Date()): boolean {
  if (!rule.enabled) return false;
  const { kind, weekday, dayOfMonth } = rule.trigger;
  if (kind === "manual") return false;
  if (kind === "daily") return true;
  if (kind === "weekly") return weekday == null || now.getDay() === weekday;
  if (kind === "monthly") {
    if (dayOfMonth == null) return false;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() === Math.min(dayOfMonth, lastDay);
  }
  return false;
}

export interface RuleTable {
  columns: { key: string; label: string; money: boolean }[];
  /**
   * Each row carries the id of the entry it came from.
   *
   * Callers used to re-sort the entries themselves and pair them with rows by
   * position. Two Flex blocks on the same day made those two orders disagree,
   * so the delete button on a row removed a different block than the one being
   * looked at. The row knows what it is; nobody should have to guess.
   *
   * `__entryId` cannot collide with a field key — `toKey` strips leading
   * underscores, so no user-authored field can ever produce this name.
   */
  rows: (Record<string, string | number> & { __entryId: string })[];
}

/**
 * The rule's entries as a table — the same shape whether it is rendered on the
 * page, drawn as a chart, or read back to the assistant as markdown.
 */
export function buildRuleTable(rule: Rule, entries: RuleEntry[]): RuleTable {
  const columns = [
    { key: "date", label: "Date", money: false },
    ...rule.fields.map((field) => ({
      key: field.key,
      label: field.label,
      money: field.type === "money",
    })),
    ...rule.calculations.map((calculation) => ({
      key: calculation.key,
      label: calculation.label,
      money: calculation.money,
    })),
  ];

  const rows = entries
    .filter((entry) => entry.ruleId === rule.id)
    .slice()
    // Newest first, and same-day entries keep the order they were logged in.
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : 0;
    })
    .map((entry) => ({
      __entryId: entry.id,
      date: entry.date,
      ...resolveEntry(rule, entry),
    }));

  return { columns, rows };
}

/** Markdown table, for reading a rule's data back in chat. */
export function renderTableMarkdown(table: RuleTable, limit = 20): string {
  if (table.rows.length === 0) return "_No entries yet._";

  const head = `| ${table.columns.map((c) => c.label).join(" | ")} |`;
  const rule = `| ${table.columns.map(() => "---").join(" | ")} |`;
  const body = table.rows.slice(0, limit).map((row) => {
    const cells = table.columns.map((column) => {
      const value = row[column.key];
      if (value === undefined || value === "") return "—";
      if (column.money) return `$${Number(value).toFixed(2)}`;
      return String(value);
    });
    return `| ${cells.join(" | ")} |`;
  });

  const more = table.rows.length > limit ? `\n_${table.rows.length - limit} more rows._` : "";
  return [head, rule, ...body].join("\n") + more;
}

/** Totals per column, for the summary line under a rule's table. */
export function summariseTable(table: RuleTable): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const column of table.columns) {
    if (column.key === "date") continue;
    let sum = 0;
    let numeric = false;
    for (const row of table.rows) {
      const value = Number(row[column.key]);
      if (Number.isFinite(value)) {
        sum += value;
        numeric = true;
      }
    }
    if (numeric) totals[column.key] = column.money ? roundMoney(sum) : sum;
  }
  return totals;
}

/** Plain-English summary of a rule, used in confirmation cards and on the page. */
export function describeRule(rule: Rule): string {
  const parts: string[] = [];

  const { trigger } = rule;
  if (trigger.kind === "daily") parts.push("Every day");
  else if (trigger.kind === "weekly") {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    parts.push(trigger.weekday != null ? `Every ${days[trigger.weekday]}` : "Every week");
  } else if (trigger.kind === "monthly") {
    parts.push(trigger.dayOfMonth ? `On the ${trigger.dayOfMonth} of each month` : "Every month");
  } else parts.push("When you say so");

  if (trigger.time) parts.push(`at ${trigger.time}`);
  parts.push(`ask "${trigger.question}"`);

  const startFields = fieldsAskedAt(rule, "start");
  if (startFields.length > 0) {
    parts.push(`record ${startFields.map((f) => f.label.toLowerCase()).join(", ")}`);
  }

  for (const followUp of rule.followUps) {
    parts.push(`then ${followUp.afterHours}h later ask "${followUp.question}"`);
  }

  for (const calculation of rule.calculations) {
    parts.push(`${calculation.label.toLowerCase()} = ${calculation.expression}`);
  }

  if (rule.payout.kind !== "none") {
    parts.push(
      `${rule.payout.autoPost ? "post" : "offer to post"} ${rule.payout.amountKey} as ${rule.payout.kind}`
    );
  }

  return parts.join(", ") + ".";
}
