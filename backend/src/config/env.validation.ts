import {
  CorsOrigin,
  PRODUCTION_FRONTEND_ORIGIN,
  PRODUCTION_RENDER_API_ORIGIN,
  RuntimeMode,
  normalizeCorsOrigin,
  parseConfiguredCorsOrigin,
} from './cors-origin-policy';

export type TrustProxySetting = boolean | number | string;

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
  businessTimezone: string;
  mqttBrokerUrl?: string;
  telemetryRetentionSeconds: number;
  faultEventRetentionSeconds: number;
  aiAssistantEnabled: boolean;
  predictiveMaintenanceEnabled: boolean;
  predictionHistoryRetentionSeconds: number;
  trustProxy: TrustProxySetting;
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
  const configuredDriver =
    process.env.FILE_STORAGE_DRIVER?.trim().toLowerCase();

  if (
    configuredDriver &&
    configuredDriver !== 'local' &&
    configuredDriver !== 'supabase'
  ) {
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

/**
 * The IANA timezone every "today"/"this month"/overdue boundary in the app
 * (dashboards, KPIs, calendars) is computed against — see
 * `common/business-time.ts`. Validated here purely to fail fast at startup
 * on a typo'd zone name; the runtime value is still read directly from
 * `process.env.BUSINESS_TIMEZONE` by that module (mirroring how the rest of
 * this file's already-validated variables are re-read elsewhere), not
 * threaded through `ConfigService`.
 */
function validateBusinessTimezone(value: string | undefined): string {
  const timezone = value?.trim() || 'Africa/Tunis';
  try {
    // Throws a RangeError for an unrecognized IANA zone name.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(
      `BUSINESS_TIMEZONE must be a valid IANA timezone name (got "${timezone}")`,
    );
  }
  return timezone;
}

/**
 * MQTT ingestion is entirely optional infrastructure (see
 * `MqttIngestionService`) — with no `MQTT_BROKER_URL` set the app simply
 * never connects to a broker, so this only validates the URL *shape* when
 * one is actually configured, never requires it.
 */
function validateMqttBrokerUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  // MQTT broker URLs use mqtt(s):// / ws(s):// schemes, which the WHATWG
  // URL parser (used elsewhere in this file via `parseUrl`) accepts fine —
  // it only rejects genuinely malformed input, not the scheme.
  try {
    return new URL(trimmed).toString().replace(/\/$/, '');
  } catch {
    throw new Error(
      'MQTT_BROKER_URL must be a valid URL (e.g. mqtt://host:1883)',
    );
  }
}

/**
 * The AI corrective assistant is disabled-by-default optional infrastructure
 * (same posture as `validateMqttBrokerUrl` above): with `AI_ASSISTANT_ENABLED`
 * unset or false, the app never calls out to a provider (see `NullAiProvider`
 * / `AiAssistantModule`'s provider factory) and no key is required anywhere.
 * The one thing validated here at boot, fail-fast, is that a production
 * deployment which *does* opt in isn't silently running with no credentials
 * — `AI_ASSISTANT_TIMEOUT_MS` / `AI_ASSISTANT_RATE_LIMIT_PER_HOUR` are
 * re-read directly from `ConfigService` at call time by the module (same
 * pattern as `MqttIngestionService` re-reading `MQTT_BROKER_URL`), so their
 * shape is validated here without threading the values through this file's
 * return object.
 */
function validateAiAssistant(nodeEnv: RuntimeMode): boolean {
  const enabled = parseBoolean(process.env.AI_ASSISTANT_ENABLED, false);
  const provider =
    process.env.AI_ASSISTANT_PROVIDER?.trim().toLowerCase() || 'gemini';

  if (enabled && provider !== 'gemini') {
    throw new Error(
      'AI_ASSISTANT_PROVIDER must be "gemini" when AI_ASSISTANT_ENABLED=true',
    );
  }

  if (
    enabled &&
    nodeEnv === 'production' &&
    !process.env.GEMINI_API_KEY?.trim()
  ) {
    throw new Error(
      'GEMINI_API_KEY is required when AI_ASSISTANT_ENABLED=true and AI_ASSISTANT_PROVIDER=gemini in production',
    );
  }

  if (
    enabled &&
    nodeEnv === 'production' &&
    !process.env.GEMINI_MODEL?.trim()
  ) {
    throw new Error(
      'GEMINI_MODEL is required when AI_ASSISTANT_ENABLED=true and AI_ASSISTANT_PROVIDER=gemini in production',
    );
  }

  const timeoutMs = process.env.AI_ASSISTANT_TIMEOUT_MS;
  if (timeoutMs?.trim()) {
    const parsed = Number(timeoutMs);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        'AI_ASSISTANT_TIMEOUT_MS must be a positive integer number of milliseconds',
      );
    }
  }

  const rateLimit = process.env.AI_ASSISTANT_RATE_LIMIT_PER_HOUR;
  if (rateLimit?.trim()) {
    const parsed = Number(rateLimit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        'AI_ASSISTANT_RATE_LIMIT_PER_HOUR must be a positive integer',
      );
    }
  }

  return enabled;
}

/**
 * Express's `trust proxy` setting, applied in `main.ts`. Left untrusted
 * (`false`) unless an operator explicitly configures it for their real
 * reverse-proxy topology — this is the same reason `AuthThrottleService`'s
 * manual `x-forwarded-for` read (`auth-throttle.service.ts`) is only ever
 * safe behind a proxy that actually sets/overwrites that header; blindly
 * trusting it with no proxy in front lets any client spoof their source IP
 * and bypass every IP-scoped rate limit in the app (this one included, see
 * `common/throttler/app-throttler.guard.ts`). Accepts a boolean, a hop
 * count, or any of Express's own string presets/CIDR list syntax — those are
 * validated lazily by Express itself at request time, not here.
 */
function validateTrustProxy(value: string | undefined): TrustProxySetting {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  const asBoolean = parseBoolean(trimmed, false);
  if (
    ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(
      trimmed.toLowerCase(),
    )
  ) {
    return asBoolean;
  }

  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  return trimmed;
}

/**
 * Shape-validates the optional global-throttling knobs at boot (fail fast on
 * garbage), mirroring `validateAiAssistant`/`validateMqttBrokerUrl`'s
 * "optional, re-read directly via ConfigService at the point of use" style —
 * `ThrottlerModule`'s factory (`app.module.ts`) and the two guards under
 * `common/throttler/` read these same variables again rather than threading
 * resolved values through this file's return object. `THROTTLE_ENABLED`
 * itself defaults to `false` in the `test` runtime so the large existing
 * e2e suite (which never sets it) is never retroactively subject to a rate
 * limit it wasn't written to expect; the one throttling-specific e2e spec
 * opts back in explicitly.
 */
function validateThrottleConfig(): void {
  const positiveIntVars = [
    'THROTTLE_DEFAULT_LIMIT',
    'THROTTLE_DEFAULT_TTL_MS',
    'THROTTLE_DEVICE_LIMIT',
    'THROTTLE_DEVICE_TTL_MS',
  ];

  for (const key of positiveIntVars) {
    const value = process.env[key];
    if (!value?.trim()) continue;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
}

function validateRetentionSeconds(
  value: string | undefined,
  key: string,
  fallbackSeconds: number,
): number {
  if (!value?.trim()) return fallbackSeconds;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer number of seconds`);
  }
  return parsed;
}

function isAtlasUri(uri: string): boolean {
  const normalized = uri.trim().toLowerCase();
  return (
    normalized.startsWith('mongodb+srv://') ||
    normalized.includes('.mongodb.net')
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
  frontendBaseUrl?: string,
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
    .map((origin) => parseConfiguredCorsOrigin(origin, nodeEnv));

  if (nodeEnv === 'production' && origins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must include at least one trusted frontend origin in production',
    );
  }

  const uniqueOrigins = Array.from(new Set(origins));

  if (nodeEnv === 'production') {
    if (uniqueOrigins.length !== 1) {
      throw new Error(
        'CORS_ORIGINS must contain exactly one Vercel production frontend origin in production',
      );
    }

    const frontendOrigin = frontendBaseUrl
      ? normalizeCorsOrigin(frontendBaseUrl, 'FRONTEND_BASE_URL')
      : undefined;
    if (frontendOrigin && uniqueOrigins[0] !== frontendOrigin) {
      throw new Error(
        'CORS_ORIGINS must exactly match FRONTEND_BASE_URL in production',
      );
    }

    if (uniqueOrigins[0] !== PRODUCTION_FRONTEND_ORIGIN) {
      throw new Error(
        `CORS_ORIGINS must exactly match ${PRODUCTION_FRONTEND_ORIGIN} in production`,
      );
    }
  }

  return uniqueOrigins;
}

function validateProductionDeploymentUrls(
  nodeEnv: RuntimeMode,
  frontendBaseUrl: string,
  backendUrl?: string,
): void {
  if (nodeEnv !== 'production') return;

  if (new URL(frontendBaseUrl).origin !== PRODUCTION_FRONTEND_ORIGIN) {
    throw new Error(
      `FRONTEND_BASE_URL must be ${PRODUCTION_FRONTEND_ORIGIN} in production`,
    );
  }

  if (!backendUrl) {
    throw new Error('BACKEND_URL is required in production');
  }

  if (new URL(backendUrl).origin !== PRODUCTION_RENDER_API_ORIGIN) {
    throw new Error(
      `BACKEND_URL must be ${PRODUCTION_RENDER_API_ORIGIN} in production`,
    );
  }
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
  validateProductionDeploymentUrls(nodeEnv, frontendBaseUrl, backendUrl);

  const port = parsePort(process.env.PORT);
  const configuredCorsOrigins =
    process.env.CORS_ORIGINS?.trim() || process.env.ALLOWED_ORIGINS?.trim();
  const corsOrigins = parseCorsOrigins(
    configuredCorsOrigins,
    buildCorsFallbackOrigins(frontendBaseUrl, backendUrl),
    nodeEnv,
    frontendBaseUrl,
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
  const businessTimezone = validateBusinessTimezone(
    process.env.BUSINESS_TIMEZONE,
  );
  const mqttBrokerUrl = validateMqttBrokerUrl(process.env.MQTT_BROKER_URL);
  const telemetryRetentionSeconds = validateRetentionSeconds(
    process.env.TELEMETRY_RETENTION_SECONDS,
    'TELEMETRY_RETENTION_SECONDS',
    7 * 24 * 60 * 60,
  );
  const faultEventRetentionSeconds = validateRetentionSeconds(
    process.env.FAULT_EVENT_RETENTION_SECONDS,
    'FAULT_EVENT_RETENTION_SECONDS',
    90 * 24 * 60 * 60,
  );
  const aiAssistantEnabled = validateAiAssistant(nodeEnv);
  // Predictive maintenance is pure local computation (no external service,
  // no secret) — unlike MQTT/AI-assistant this needs no production-gating,
  // just a simple on/off switch for ops to pause the nightly sweep.
  const predictiveMaintenanceEnabled = parseBoolean(
    process.env.PREDICTIVE_MAINTENANCE_ENABLED,
    true,
  );
  const predictionHistoryRetentionSeconds = validateRetentionSeconds(
    process.env.PREDICTION_HISTORY_RETENTION_SECONDS,
    'PREDICTION_HISTORY_RETENTION_SECONDS',
    180 * 24 * 60 * 60,
  );
  const trustProxy = validateTrustProxy(process.env.TRUST_PROXY);
  validateThrottleConfig();

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
    businessTimezone,
    mqttBrokerUrl,
    telemetryRetentionSeconds,
    faultEventRetentionSeconds,
    aiAssistantEnabled,
    predictiveMaintenanceEnabled,
    predictionHistoryRetentionSeconds,
    trustProxy,
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
