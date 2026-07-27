/**
 * Shared helpers for building list-endpoint query filters/sorts. Extracted
 * so every list endpoint (Work Orders, Maintenance Plans, Users, Reports)
 * escapes search input and parses sort params the same way, instead of
 * each service re-implementing (or forgetting to implement) regex
 * escaping — `UsersService` already had its own copy before this file
 * existed; this is that same logic promoted to `common/`.
 */

/** Escapes regex metacharacters so user search input is always treated as a literal substring match, never as a regex. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildCaseInsensitiveSearchFilter(search: string): RegExp {
  return new RegExp(escapeRegExp(search), 'i');
}

/**
 * Parses a `sort` query param of the form `field` (ascending) or
 * `-field` (descending) into a Mongoose sort object, restricted to an
 * allow-list so callers can never sort on a field that isn't indexed or
 * safe to expose (e.g. password hashes).
 */
export function parseSortParam(
  sortInput: string | undefined,
  allowedFields: readonly string[],
  fallback: Record<string, 1 | -1>,
): Record<string, 1 | -1> {
  if (!sortInput) return fallback;

  const descending = sortInput.startsWith('-');
  const field = descending ? sortInput.slice(1) : sortInput;
  if (!allowedFields.includes(field)) return fallback;

  return { [field]: descending ? -1 : 1 };
}

/** Splits a comma-separated query param into a trimmed, non-empty string array (or undefined if absent/empty). */
export function parseCsvParam(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}
