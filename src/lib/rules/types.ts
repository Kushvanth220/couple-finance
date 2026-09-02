import type { Person } from "@/types";

/**
 * Rules — the household's own logic, written in the app instead of in code.
 *
 * A rule says: when this happens, ask me these things, wait this long, ask the
 * rest, then work the numbers out this way. The Amazon Flex case is the shape
 * everything else is measured against: a block gets logged with its base pay,
 * 27 hours later the tips are known, and only then is the deposit real.
 *
 * The point is that neither the app nor the assistant should need new code to
 * learn a new one. Kushvanth describes it, the assistant writes it down, and
 * both of them follow the same record from then on.
 */

/** Who the rule belongs to. Household rules apply to both people. */
export type RuleScope = Person | "household";

export type RuleFieldType = "money" | "number" | "text" | "date" | "time";

export interface RuleField {
  /** Machine name used in calculations, e.g. "base_pay". */
  key: string;
  label: string;
  type: RuleFieldType;
  /** The question the assistant asks to fill this in. */
  question?: string;
  /** Asked when the entry is opened, or when the follow-up comes due. */
  askAt: "start" | "follow_up";
  required: boolean;
}

/**
 * A delayed second question. Amazon Flex tips land about 27 hours after the
 * block, so the entry stays open until then rather than being written twice.
 */
export interface RuleFollowUp {
  id: string;
  /** Hours after the entry is opened before this is raised. */
  afterHours: number;
  question: string;
  /** Field keys this follow-up fills in. */
  fields: string[];
}

/**
 * A named number worked out from the fields, e.g. total = base_pay + tips.
 * Expressions are arithmetic over field keys — see `evaluateExpression`, which
 * parses them rather than calling eval.
 */
export interface RuleCalculation {
  key: string;
  label: string;
  expression: string;
  /** Render as currency. Almost always true here. */
  money: boolean;
}

export type RuleChartType =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "scatter"
  | "bubble";

export interface RuleChart {
  id: string;
  title: string;
  type: RuleChartType;
  /** Field/calculation key, or "date" for the entry's own date. */
  x: string;
  /** Field/calculation key to measure. */
  y: string;
  /** Optional third measure — bubble size. */
  size?: string;
}

export type RuleTriggerKind = "daily" | "weekly" | "monthly" | "manual";

export interface RuleTrigger {
  kind: RuleTriggerKind;
  /** HH:mm, when the assistant should raise it. */
  time?: string;
  /** 0 = Sunday, for weekly. */
  weekday?: number;
  /** 1-31, for monthly. */
  dayOfMonth?: number;
  /** What the assistant opens with, e.g. "Any Amazon Flex blocks today?" */
  question: string;
}

/** Post a finished entry into the finance store as real money. */
export interface RulePayout {
  kind: "income" | "expense" | "none";
  /** Which calculation or field carries the amount. */
  amountKey: string;
  /** Income source or spend category name to file it under. */
  target?: string;
  /** Account the money lands in. */
  accountId?: string;
  /** Never post automatically — a rule may compute money it does not move. */
  autoPost: boolean;
}

export interface Rule {
  id: string;
  name: string;
  scope: RuleScope;
  enabled: boolean;
  /**
   * The rule in the user's own words. This is what the assistant reads and
   * follows, so it stays plain English rather than being generated from fields.
   */
  description: string;
  trigger: RuleTrigger;
  fields: RuleField[];
  followUps: RuleFollowUp[];
  calculations: RuleCalculation[];
  charts: RuleChart[];
  payout: RulePayout;
  /** Show this rule's table and charts on the dashboard. */
  showOnDashboard: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One recorded occurrence — a single Flex block, a single shift. */
export interface RuleEntry {
  id: string;
  ruleId: string;
  /** yyyy-MM-dd of the occurrence. */
  date: string;
  /** ISO timestamp the entry was opened, which follow-ups count from. */
  openedAt: string;
  values: Record<string, string | number>;
  /** Follow-up ids already answered. */
  answered: string[];
  /** True once every required field is filled. */
  complete: boolean;
  /** Set when the payout has been written to the finance store. */
  postedTransactionId?: string;
  notes?: string;
}

/** A follow-up that has come due and is still unanswered. */
export interface DueFollowUp {
  rule: Rule;
  entry: RuleEntry;
  followUp: RuleFollowUp;
  dueAt: Date;
  overdueHours: number;
}

export const RULE_CHART_TYPES: { value: RuleChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
  { value: "scatter", label: "Scatter" },
  { value: "bubble", label: "Bubble" },
];

export const RULE_FIELD_TYPES: { value: RuleFieldType; label: string }[] = [
  { value: "money", label: "Money" },
  { value: "number", label: "Number" },
  { value: "text", label: "Text" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
];
