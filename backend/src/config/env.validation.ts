type RuntimeMode = 'development' | 'test' | 'production';
type CorsOrigin = string | RegExp;

type EnvValidationResult = {
  nodeEnv: RuntimeMode;
  port: number;
  corsOrigins: CorsOrigin[];
  mongoUri: string;
  mongoDebug: boolean;
  mongoRequireAtlas: boolean;
  frontendBaseUrl: string;
  emailVerificationSecret: string;
  enableLegacyEmailTokens: boolean;
  enableLegacyResetTokens: boolean;
  enableEventBasedEmails: boolean;
  fileStorageDriver: 'local' | 'supabase';
};

function parseNodeEnv(input: string | undefined): RuntimeMode {
  if (input === 'development' || input === 'test' || input === 'production') {
    return input;
  }

  return 'development';
}

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function normalizeMaybeQuotedEnv(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function parsePort(value: string | undefined): number {
  const fallback = 3001;
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error('PORT must be a valid TCP port between 1 and 65535');
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseFutureDeadline(value: string | undefined, key: string): Date {
  if (!value?.trim()) {
    throw new Error(
      `${key} is required when legacy authentication compatibility flags are enabled in production`,
    );
  }

  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) {
    throw new Error(`${key} must be a valid ISO date`);
  }

  if (deadline.getTime() <= Date.now()) {
    throw new Error(`${key} must be a future date`);
  }

  return deadline;
}

function parseUrl(value: string, key: string): string {
  try {
    const parsed = new URL(value);
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
}

function validateFileStorage(nodeEnv: RuntimeMode): 'local' | 'supabase' {
  const configuredDriver = process.env.FILE_STORAGE_DRIVER?.trim().toLowerCase();

  if (configuredDriver && configuredDriver !== 'local' && configuredDriver !== 'supabase') {
    throw new Error('FILE_STORAGE_DRIVER must be either local or supabase');
  }

  if (nodeEnv !== 'production') {
    return (configuredDriver as 'local' | 'supabase' | undefined) ?? 'local';
  }

  if (configuredDriver !== 'supabase') {
    throw new Error('FILE_STORAGE_DRIVER=supabase is required in production');
  }

  parseUrl(requireEnv('SUPABASE_URL'), 'SUPABASE_URL');
  requireEnv('SUPABASE_SECRET_KEY');
  requireEnv('SUPABASE_STORAGE_BUCKET');

  return 'supabase';
}

function isAtlasUri(uri: string): boolean {
  const normalized = uri.trim().toLowerCase();
  return (
    normalized.startsWith('mongodb+srv://') ||
    normalized.includes('.mongodb.net')
  );
}

function wildcardToRegex(originPattern: string): RegExp {
  const escaped = originPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  return new RegExp(`^${escaped}$`);
}

function parseCorsOrigin(origin: string, nodeEnv: RuntimeMode): CorsOrigin {
  if (origin.includes('*')) {
    if (nodeEnv === 'production') {
      throw new Error('CORS_ORIGINS cannot contain wildcards in production');
    }

    return wildcardToRegex(origin);
  }

  const parsed = parseUrl(origin, 'CORS_ORIGINS');
  const url = new URL(parsed);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CORS_ORIGINS entries must use http or https URLs');
  }

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

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost')
  );
}

function buildCorsFallbackOrigins(
  frontendBaseUrl: string,
  backendUrl?: string,
): CorsOrigin[] {
  const origins = new Set<string>([
    'http://localhost:3000',
    'http://localhost:3001',
  ]);

  origins.add(new URL(frontendBaseUrl).origin);
  if (backendUrl) {
    origins.add(new URL(backendUrl).origin);
  }

  return Array.from(origins);
}

function parseCorsOrigins(
  value: string | undefined,
  fallbackOrigins: CorsOrigin[],
  nodeEnv: RuntimeMode,
): CorsOrigin[] {
  if (!value || !value.trim()) {
    if (nodeEnv === 'production') {
      throw new Error(
        'CORS_ORIGINS must be set to a comma-separated list of trusted frontend origins in production',
      );
    }

    return fallbackOrigins;
  }

  if (value.trim() === '*') {
    if (nodeEnv === 'production') {
      throw new Error('CORS_ORIGINS=* is not allowed in production');
    }

    return [/^https?:\/\/.+/i];
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseCorsOrigin(origin, nodeEnv));

  if (nodeEnv === 'production' && origins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must include at least one trusted frontend origin in production',
    );
  }

  return Array.from(new Set(origins));
}

export function validateEnvironment(): EnvValidationResult {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
  process.env.NODE_ENV = nodeEnv;

  const fallbackMongoUri = 'mongodb://localhost:27017/GMAO_IPROTEX_TEST';
  const mongoUri =
    nodeEnv === 'test'
      ? (process.env.MONGODB_URI?.trim() ?? fallbackMongoUri)
      : requireEnv('MONGODB_URI');
  const mongoDebug = parseBoolean(process.env.MONGODB_DEBUG, false);
  const mongoRequireAtlas = parseBoolean(
    process.env.MONGODB_REQUIRE_ATLAS,
    false,
  );

  if (nodeEnv !== 'test') {
    requireEnv('JWT_SECRET');

    const jwtExpires =
      process.env.JWT_EXPIRES_IN ?? process.env.JWT_ACCESS_EXPIRES_IN;
    if (!jwtExpires?.trim()) {
      throw new Error(
        'Missing required environment variable: JWT_EXPIRES_IN (or JWT_ACCESS_EXPIRES_IN)',
      );
    }

    requireEnv('JWT_REFRESH_SECRET');
    const refreshExpires = process.env.JWT_REFRESH_EXPIRES_IN;
    if (!refreshExpires?.trim()) {
      throw new Error(
        'Missing required environment variable: JWT_REFRESH_EXPIRES_IN',
      );
    }

    if (mongoRequireAtlas && !isAtlasUri(mongoUri)) {
      throw new Error(
        'MONGODB_URI must point to MongoDB Atlas when MONGODB_REQUIRE_ATLAS=true',
      );
    }

    const hasEmailVerificationSecret = Boolean(
      process.env.EMAIL_VERIFICATION_SECRET?.trim(),
    );
    const hasJwtSecret = Boolean(process.env.JWT_SECRET?.trim());

    if (!hasEmailVerificationSecret && !hasJwtSecret) {
      throw new Error(
        'Missing required environment variable: EMAIL_VERIFICATION_SECRET (or JWT_SECRET)',
      );
    }

    const googleClientId = normalizeMaybeQuotedEnv(
      process.env.GOOGLE_CLIENT_ID,
    );
    const googleClientSecret = normalizeMaybeQuotedEnv(
      process.env.GOOGLE_CLIENT_SECRET,
    );

    if (!googleClientId) {
      throw new Error(
        'Missing required environment variable: GOOGLE_CLIENT_ID',
      );
    }

    if (!googleClientSecret) {
      throw new Error(
        'Missing required environment variable: GOOGLE_CLIENT_SECRET',
      );
    }

    const googleCallbackUrl = normalizeMaybeQuotedEnv(
      process.env.GOOGLE_CALLBACK_URL,
    );
    const backendUrl = normalizeMaybeQuotedEnv(process.env.BACKEND_URL);

    if (googleCallbackUrl) {
      parseUrl(googleCallbackUrl, 'GOOGLE_CALLBACK_URL');
    } else if (backendUrl) {
      parseUrl(backendUrl, 'BACKEND_URL');
    } else {
      throw new Error(
        'Missing required environment variable: GOOGLE_CALLBACK_URL (or BACKEND_URL)',
      );
    }

    if (nodeEnv === 'production') {
      requireExchangeEncryptionKey();
    }
  }

  const rawFrontendBaseUrl =
    process.env.FRONTEND_BASE_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim();

  const frontendBaseUrl = rawFrontendBaseUrl
    ? parseUrl(rawFrontendBaseUrl, 'FRONTEND_BASE_URL')
    : 'http://localhost:3000';

  const backendUrl = process.env.BACKEND_URL?.trim()
    ? parseUrl(process.env.BACKEND_URL.trim(), 'BACKEND_URL')
    : undefined;

  const port = parsePort(process.env.PORT);
  const configuredCorsOrigins =
    process.env.CORS_ORIGINS?.trim() || process.env.ALLOWED_ORIGINS?.trim();
  const corsOrigins = parseCorsOrigins(
    configuredCorsOrigins,
    buildCorsFallbackOrigins(frontendBaseUrl, backendUrl),
    nodeEnv,
  );

  const emailVerificationSecret =
    process.env.EMAIL_VERIFICATION_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';

  const enableLegacyEmailTokens = parseBoolean(
    process.env.ENABLE_LEGACY_EMAIL_TOKENS,
    false,
  );
  const enableLegacyResetTokens = parseBoolean(
    process.env.ENABLE_LEGACY_RESET_TOKENS,
    false,
  );

  if (
    nodeEnv === 'production' &&
    (enableLegacyEmailTokens || enableLegacyResetTokens)
  ) {
    parseFutureDeadline(
      process.env.LEGACY_AUTH_MIGRATION_DEADLINE,
      'LEGACY_AUTH_MIGRATION_DEADLINE',
    );
  }

  const enableEventBasedEmails = parseBoolean(
    process.env.ENABLE_EVENT_BASED_EMAILS,
    false,
  );
  const fileStorageDriver = validateFileStorage(nodeEnv);

  return {
    nodeEnv,
    port,
    corsOrigins,
    mongoUri,
    mongoDebug,
    mongoRequireAtlas,
    frontendBaseUrl,
    emailVerificationSecret,
    enableLegacyEmailTokens,
    enableLegacyResetTokens,
    enableEventBasedEmails,
    fileStorageDriver,
  };
}

function requireExchangeEncryptionKey(): void {
  const key = process.env.GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error(
      'Missing required environment variable: GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY',
    );
  }

  const decoded = Buffer.from(key, 'base64');
  if (decoded.length !== 32 && key.length < 32) {
    throw new Error(
      'GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY must be a 32-byte base64 key or at least 32 characters',
    );
  }
}
