/**
 * Extracts a user-facing message from an API error, preferring the
 * backend's translated message and falling back to a caller-supplied
 * string. A 409 (conflict) status is treated as "this task was already
 * submitted" — callers pass in the already-translated string for that case
 * so this function stays free of any dependency on `next-intl`.
 */
export function extractPreventiveApiErrorMessage(
  error: unknown,
  fallback: string,
  conflictMessage?: string,
): string {
  const apiError = error as {
    response?: { status?: number; data?: { message?: string | string[] } };
  };
  if (conflictMessage && apiError?.response?.status === 409) {
    return conflictMessage;
  }
  const raw = apiError?.response?.data?.message;
  if (Array.isArray(raw) && raw.length) {
    return raw.join(" ");
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw;
  }
  return fallback;
}
