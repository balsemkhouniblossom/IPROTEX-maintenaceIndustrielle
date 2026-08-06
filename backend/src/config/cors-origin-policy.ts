export type RuntimeMode = 'development' | 'test' | 'production';
export type CorsOrigin = string | RegExp;

export function normalizeCorsOrigin(value: string, key = 'origin'): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
    return url.origin;
  } catch {
    throw new Error(`${key} must be a valid http or https URL`);
  }
}

export function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost')
  );
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins: CorsOrigin[],
): boolean {
  if (!origin) return false;

  let normalized: string;
  try {
    normalized = normalizeCorsOrigin(origin);
  } catch {
    return false;
  }

  return allowedOrigins.some((allowedOrigin) => {
    if (typeof allowedOrigin === 'string') {
      return normalizeCorsOrigin(allowedOrigin) === normalized;
    }
    return allowedOrigin.test(normalized);
  });
}

export function buildCorsOriginDelegate(
  allowedOrigins: CorsOrigin[],
  options: { allowOriginless: boolean },
): (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) => void {
  return (origin, callback) => {
    if (!origin && options.allowOriginless) {
      callback(null, true);
      return;
    }

    callback(null, isAllowedCorsOrigin(origin, allowedOrigins));
  };
}

export function wildcardToRegex(originPattern: string): RegExp {
  const escaped = originPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  return new RegExp(`^${escaped}$`);
}

export function parseConfiguredCorsOrigin(
  origin: string,
  nodeEnv: RuntimeMode,
): CorsOrigin {
  if (origin.includes('*')) {
    if (nodeEnv === 'production') {
      throw new Error('CORS_ORIGINS cannot contain wildcards in production');
    }

    return wildcardToRegex(origin);
  }

  const parsed = normalizeCorsOrigin(origin, 'CORS_ORIGINS');
  const url = new URL(parsed);

  if (nodeEnv === 'production') {
    if (url.protocol !== 'https:') {
      throw new Error('CORS_ORIGINS entries must use https in production');
    }

    if (isLocalhost(url.hostname)) {
      throw new Error('CORS_ORIGINS cannot include localhost in production');
    }
  }

  return url.origin;
}
