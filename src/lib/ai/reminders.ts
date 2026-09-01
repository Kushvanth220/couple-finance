/**
 * Structured reminders.
 *
 * Reminders used to be plain strings, so "when" only existed as words inside
 * the sentence — and `get_daily_briefing` had to guess what was due by
 * substring-matching the day number against the text. That is wrong the moment
 * an amount contains the same digits.
 *
 * A reminder now carries its schedule as data. The sentence the assistant reads
 * is DERIVED from that data (`renderReminderLine`), so there is one source of
 * truth and the model still gets something it can speak aloud.
 */

export type ReminderRepeat = "once" | "weekly" | "monthly" | "yearly";

export interface Reminder {
  id: string;
  /** What to remind about, in the user's own words. */
  text: string;
  done: boolean;
  repeat: ReminderRepeat;
  /** once — ISO yyyy-MM-dd */
  date?: string;
  /** monthly / yearly — 1..31 */
  dayOfMonth?: number;
  /** yearly — 1..12 */
  month?: number;
  /** weekly — 0 = Sunday */
  weekday?: number;
  /** HH:mm, 24h. Optional: plenty of reminders have no time of day. */
  time?: string;
  /** How many days ahead to raise it. The household default is 5. */
  leadDays: number;
  /**
   * The last occurrence that was actually completed, as yyyy-MM-dd.
   *
   * Recurring reminders are never "finished" — paying rent in March does not
   * mean rent is over. Marking one done records the occurrence it satisfied
   * and the reminder rolls to the next one. Only a one-off sets `done`.
   */
  doneThrough?: string;
}

export const DEFAULT_LEAD_DAYS = 5;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "09:00" -> "9:00 AM". Returns null for anything unparseable. */
export function formatTime(time?: string): string | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(m)} ${suffix}`;
}

/** Plain-English schedule, e.g. "the 3rd of each month at 9:00 AM". */
export function describeSchedule(reminder: Reminder): string {
  const at = formatTime(reminder.time);
  const time = at ? ` at ${at}` : "";

  switch (reminder.repeat) {
    case "weekly":
      return reminder.weekday != null
        ? `every ${WEEKDAYS[reminder.weekday]}${time}`
        : `every week${time}`;
    case "monthly":
      return reminder.dayOfMonth
        ? `the ${ordinal(reminder.dayOfMonth)} of each month${time}`
        : `every month${time}`;
    case "yearly":
      return reminder.dayOfMonth && reminder.month
        ? `every ${MONTHS[reminder.month - 1]} ${ordinal(reminder.dayOfMonth)}${time}`
        : `every year${time}`;
    case "once":
    default:
      return reminder.date ? `on ${reminder.date}${time}` : time.trim() || "no set date";
  }
}

/**
 * The line the assistant actually reads. Kept human — the model speaks these
 * aloud — and prefixed with [DONE] to match the convention the tools use.
 */
export function renderReminderLine(reminder: Reminder): string {
  const parts = [reminder.text.trim()];
  const schedule = describeSchedule(reminder);
  if (schedule && schedule !== "no set date") parts.push(`due ${schedule}`);
  if (reminder.leadDays > 0) parts.push(`remind ${reminder.leadDays} days before`);
  const line = parts.join(" — ");
  return reminder.done ? `[DONE] ${line}` : line;
}

/**
 * yyyy-MM-dd in LOCAL time. `toISOString` would shift to UTC and, for anyone
 * west of Greenwich, hand back yesterday.
 */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function atMidnight(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * The next time this reminder comes due, at or after `from`.
 * Returns null when there is nothing to compute (a once-off with no date, or a
 * past one-off), which the caller treats as "never due".
 */
export function nextDueDate(reminder: Reminder, from: Date = new Date()): Date | null {
  let today = atMidnight(from);

  // An occurrence already ticked off cannot be the next one due. Start the
  // search the day after it, so a rent paid on the 3rd points at next month.
  if (reminder.repeat !== "once" && reminder.doneThrough) {
    const settled = new Date(`${reminder.doneThrough}T00:00:00`);
    if (!Number.isNaN(settled.getTime()) && settled >= today) {
      today = new Date(settled);
      today.setDate(today.getDate() + 1);
    }
  }

  if (reminder.repeat === "once") {
    if (!reminder.date) return null;
    const parsed = new Date(`${reminder.date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed < today ? null : parsed;
  }

  if (reminder.repeat === "weekly") {
    if (reminder.weekday == null) return null;
    const next = new Date(today);
    const delta = (reminder.weekday - today.getDay() + 7) % 7;
    next.setDate(today.getDate() + delta);
    return next;
  }

  if (reminder.repeat === "monthly") {
    if (!reminder.dayOfMonth) return null;
    // Clamp for short months: "the 31st" lands on the 30th in November.
    const inMonth = (year: number, monthIndex: number) => {
      const lastDay = new Date(year, monthIndex + 1, 0).getDate();
      return new Date(year, monthIndex, Math.min(reminder.dayOfMonth!, lastDay));
    };
    const thisMonth = inMonth(today.getFullYear(), today.getMonth());
    if (thisMonth >= today) return thisMonth;
    return inMonth(today.getFullYear(), today.getMonth() + 1);
  }

  // yearly
  if (!reminder.dayOfMonth || !reminder.month) return null;
  const monthIndex = reminder.month - 1;
  const inYear = (year: number) => {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return new Date(year, monthIndex, Math.min(reminder.dayOfMonth!, lastDay));
  };
  const thisYear = inYear(today.getFullYear());
  return thisYear >= today ? thisYear : inYear(today.getFullYear() + 1);
}

/** Whole days from `from` until the reminder is due. Null when never due. */
export function daysUntilDue(reminder: Reminder, from: Date = new Date()): number | null {
  const due = nextDueDate(reminder, from);
  if (!due) return null;
  const ms = due.getTime() - atMidnight(from).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Should the assistant raise this now? True inside the lead window, which is
 * what "remind me 5 days before" actually means.
 */
export function isDueSoon(reminder: Reminder, from: Date = new Date()): boolean {
  if (reminder.done) return false;
  const days = daysUntilDue(reminder, from);
  if (days == null) return false;
  return days >= 0 && days <= reminder.leadDays;
}

/** "Due today", "in 3 days", "overdue" — for the UI, not the model. */
export function dueLabel(reminder: Reminder, from: Date = new Date()): string {
  const days = daysUntilDue(reminder, from);
  if (days == null) return "No date set";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

/**
 * Adopt a legacy plain-string reminder. The text is kept exactly as written —
 * guessing a schedule out of prose would invent data the user never entered.
 */
export function reminderFromLegacyLine(line: string, id: string): Reminder {
  const done = /^\[DONE\]\s*/i.test(line);
  return {
    id,
    text: line.replace(/^\[DONE\]\s*/i, "").trim(),
    done,
    repeat: "once",
    leadDays: DEFAULT_LEAD_DAYS,
  };
}
