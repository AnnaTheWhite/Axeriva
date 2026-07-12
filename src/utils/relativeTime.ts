// Relative-time formatting for "last login" style timestamps. i18n-aware:
// callers pass their `t` function so the strings stay translatable. Falls
// back to the raw locale date string for anything older than ~30 days.
//
// i18n keys expected under `time.*`:
//   time.justNow, time.minuteAgo, time.minutesAgo, time.hourAgo,
//   time.hoursAgo, time.yesterday, time.daysAgo, time.weekAgo,
//   time.weeksAgo  (each *sAgo / *Ago takes a {{count}} var where relevant)

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Returns a human, relative label like "5 minutes ago" / "Yesterday".
export function formatRelativeTime(value: string | null, t: TranslateFn): string {
  if (!value) return "—";

  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";

  const seconds = Math.round((Date.now() - then) / 1000);

  // Guard against clock skew / future timestamps.
  if (seconds < 30) return t("time.justNow");

  if (seconds < HOUR) {
    const minutes = Math.floor(seconds / MINUTE);
    return minutes <= 1 ? t("time.minuteAgo") : t("time.minutesAgo", { count: minutes });
  }

  if (seconds < DAY) {
    const hours = Math.floor(seconds / HOUR);
    return hours <= 1 ? t("time.hourAgo") : t("time.hoursAgo", { count: hours });
  }

  const days = Math.floor(seconds / DAY);
  if (days === 1) return t("time.yesterday");
  if (seconds < WEEK) return t("time.daysAgo", { count: days });

  const weeks = Math.floor(seconds / WEEK);
  if (weeks < 5) {
    return weeks <= 1 ? t("time.weekAgo") : t("time.weeksAgo", { count: weeks });
  }

  // Older than ~a month — show the absolute date.
  return new Date(value).toLocaleDateString();
}

// Full, exact timestamp for tooltips.
export function formatExact(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}
