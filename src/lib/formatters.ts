/**
 * Parse stored date/time fields in the user's local timezone.
 * Avoids the JS pitfall where `new Date("yyyy-MM-dd")` is treated as UTC midnight.
 */
export function parseAppDateTime(
  date: string,
  time?: string,
  timestamp?: string
): Date {
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return new Date();

  if (time) {
    const [hours = 0, minutes = 0, seconds = 0] = time.split(":").map(Number);
    return new Date(year, month - 1, day, hours, minutes, seconds);
  }

  // Noon local avoids DST edge cases when displaying date-only values
  return new Date(year, month - 1, day, 12, 0, 0);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(date: string, time?: string, timestamp?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseAppDateTime(date, time, timestamp));
}

export function formatTime(date: string, time: string, timestamp?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(parseAppDateTime(date, time, timestamp));
}

export function formatDateTime(date: string, time?: string, timestamp?: string): string {
  const d = parseAppDateTime(date, time ?? "00:00:00", timestamp);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

/** Compare two stored records for sorting (newest first) */
export function compareByDateTime(
  a: { date: string; time?: string; timestamp?: string },
  b: { date: string; time?: string; timestamp?: string }
): number {
  return (
    parseAppDateTime(b.date, b.time, b.timestamp).getTime() -
    parseAppDateTime(a.date, a.time, a.timestamp).getTime()
  );
}
