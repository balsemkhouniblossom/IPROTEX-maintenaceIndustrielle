/**
 * Single shared implementation of "pull a human-readable message out of an
 * Axios error" — previously copy-pasted (with drift: some copies also
 * returned an HTTP status, most didn't) across 9+ page files. `withStatus`
 * opts into the `{message, status}` shape a couple of pages relied on.
 */
export function extractApiErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as { response?: { data?: { message?: string | string[] } } };
  const raw = apiError?.response?.data?.message;
  if (Array.isArray(raw) && raw.length) return raw.join(' ');
  if (typeof raw === 'string' && raw.trim()) return raw;
  return fallback;
}

export function extractApiErrorDetails(
  error: unknown,
  fallback: string,
): { message: string; status?: number } {
  const apiError = error as {
    response?: { status?: number; data?: { message?: string | string[] } };
  };
  return {
    message: extractApiErrorMessage(error, fallback),
    status: apiError?.response?.status,
  };
}
