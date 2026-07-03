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
  enableEventBasedEmails: boolean;
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
  return trimmed.replace(/^['\"]|['\"]$/g, '');
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

function parseUrl(value: string, key: string): string {
  try {
    const parsed = new URL(value);
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${key} must be a valid URL`);
  }
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

function parseCorsOrigins(value: string | undefined): CorsOrigin[] {
  if (!value || !value.trim()) {
    return [
      'http://localhost:3000',
      'https://iprotex-maintenace-industrielle.vercel.app',
      /^https:\/\/iprotex-maintenace-industrielle-[a-z0-9-]+\.vercel\.app$/,
    ];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => (origin.includes('*') ? wildcardToRegex(origin) : origin));
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
      throw new Error('Missing required environment variable: GOOGLE_CLIENT_ID');
    }

    if (!googleClientSecret) {
      throw new Error(
        'Missing required environment variable: GOOGLE_CLIENT_SECRET',
      );
    }
  }

  const port = parsePort(process.env.PORT);
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  const rawFrontendBaseUrl =
    process.env.FRONTEND_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim();

  const frontendBaseUrl = rawFrontendBaseUrl
    ? parseUrl(rawFrontendBaseUrl, 'FRONTEND_BASE_URL')
    : 'http://localhost:3000';

  const emailVerificationSecret =
    process.env.EMAIL_VERIFICATION_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';

  const enableLegacyEmailTokens = parseBoolean(
    process.env.ENABLE_LEGACY_EMAIL_TOKENS,
    true,
  );

  const enableEventBasedEmails = parseBoolean(
    process.env.ENABLE_EVENT_BASED_EMAILS,
    false,
  );

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
    enableEventBasedEmails,
  };
}
