function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type TranslatableDateGroupKey = 'today' | 'yesterday' | 'last7Days' | 'last30Days';
export type DateGroupKey = TranslatableDateGroupKey | { monthLabel: string };

/**
 * `today`/`yesterday`/`last7Days`/`last30Days` are translation keys the
 * caller resolves via `t(`groups.${key}`)`; anything older than 30 days
 * falls back to a month/year label (already localized via
 * `toLocaleDateString`), satisfying the "also support grouping by month"
 * requirement without a separate flat "older" bucket.
 */
export function groupKeyForDate(at: Date, now: Date, locale: string): DateGroupKey {
  const diffDays = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);

  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays <= 7) return 'last7Days';
  if (diffDays <= 30) return 'last30Days';
  return { monthLabel: at.toLocaleDateString(locale, { month: 'long', year: 'numeric' }) };
}

const TRANSLATABLE_KEYS = new Set<TranslatableDateGroupKey>(['today', 'yesterday', 'last7Days', 'last30Days']);

export function isTranslatableGroupKey(key: DateGroupKey): key is TranslatableDateGroupKey {
  if (typeof key !== 'string') return false;
  return TRANSLATABLE_KEYS.has(key);
}

export function dateGroupLabel(key: DateGroupKey): string {
  return typeof key === 'string' ? key : key.monthLabel;
}
