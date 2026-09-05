/**
 * The household's own idea of "today".
 *
 * Kushvanth and Grishma are in US Central. `new Date().toISOString()` is UTC,
 * which after 7pm local is already tomorrow — so between 7pm and midnight the
 * app reported the wrong day's spending, month totals rolled over early on the
 * last of the month, and the assistant insisted it was the 3rd while he was
 * telling it that it was the 2nd.
 *
 * Everything that means a calendar day to a person goes through here.
 */

export const HOUSEHOLD_TIME_ZONE = "America/Chicago";

/** yyyy-MM-dd in the household's timezone. */
export function householdToday(now: Date = new Date()): string {
  // en-CA formats as yyyy-MM-dd, which is exactly the shape stored on records.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSEHOLD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** yyyy-MM-dd for the day before, in the household's timezone. */
export function householdYesterday(now: Date = new Date()): string {
  return householdToday(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/** yyyy-MM in the household's timezone. */
export function householdMonth(now: Date = new Date()): string {
  return householdToday(now).slice(0, 7);
}

/** "Wednesday, September 2, 2026" — for reading aloud. */
export function householdLongDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSEHOLD_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
}
