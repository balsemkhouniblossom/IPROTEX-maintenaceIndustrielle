import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.FILE_STORAGE_DRIVER = 'supabase';
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'service-role-secret';
    process.env.SUPABASE_STORAGE_BUCKET = 'uploads';
    process.env.GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY =
      'google-login-exchange-encryption-key';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts valid production configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.EMAIL_VERIFICATION_SECRET = 'c'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY =
      'google-login-exchange-encryption-key';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.API_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.EMAIL_FROM = 'noreply@example.com';
    process.env.ENABLE_LEGACY_EMAIL_TOKENS = 'false';
    process.env.ENABLE_LEGACY_RESET_TOKENS = 'false';
    process.env.ENABLE_EVENT_BASED_EMAILS = 'false';

    const env = validateEnvironment();

    expect(env.nodeEnv).toBe('production');
    expect(env.port).toBe(3001);
    expect(env.corsOrigins).toEqual(['https://app.example.com']);
    expect(env.enableLegacyEmailTokens).toBe(false);
    expect(env.enableLegacyResetTokens).toBe(false);
    expect(env.enableEventBasedEmails).toBe(false);
    expect(env.fileStorageDriver).toBe('supabase');
  });

  it('defaults legacy authentication compatibility flags to disabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.EMAIL_VERIFICATION_SECRET = 'c'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    delete process.env.ENABLE_LEGACY_EMAIL_TOKENS;
    delete process.env.ENABLE_LEGACY_RESET_TOKENS;
    delete process.env.LEGACY_AUTH_MIGRATION_DEADLINE;

    const env = validateEnvironment();

    expect(env.enableLegacyEmailTokens).toBe(false);
    expect(env.enableLegacyResetTokens).toBe(false);
  });

  it('allows temporary legacy authentication migration mode with a future production deadline', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.EMAIL_VERIFICATION_SECRET = 'c'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.ENABLE_LEGACY_EMAIL_TOKENS = 'true';
    process.env.ENABLE_LEGACY_RESET_TOKENS = 'true';
    process.env.LEGACY_AUTH_MIGRATION_DEADLINE = '2099-01-01T00:00:00.000Z';

    const env = validateEnvironment();

    expect(env.enableLegacyEmailTokens).toBe(true);
    expect(env.enableLegacyResetTokens).toBe(true);
  });

  it('rejects production legacy authentication migration mode without a deadline', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.EMAIL_VERIFICATION_SECRET = 'c'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.ENABLE_LEGACY_RESET_TOKENS = 'true';
    delete process.env.LEGACY_AUTH_MIGRATION_DEADLINE;

    expect(() => validateEnvironment()).toThrow(
      'LEGACY_AUTH_MIGRATION_DEADLINE is required when legacy authentication compatibility flags are enabled in production',
    );
  });

  it('rejects production legacy authentication migration mode with an expired deadline', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.EMAIL_VERIFICATION_SECRET = 'c'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.ENABLE_LEGACY_EMAIL_TOKENS = 'true';
    process.env.LEGACY_AUTH_MIGRATION_DEADLINE = '2020-01-01T00:00:00.000Z';

    expect(() => validateEnvironment()).toThrow(
      'LEGACY_AUTH_MIGRATION_DEADLINE must be a future date',
    );
  });

  it('throws on missing required production variables', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MONGODB_URI;

    expect(() => validateEnvironment()).toThrow(
      'Missing required environment variable: MONGODB_URI',
    );
  });

  it('throws when production Supabase storage configuration is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    delete process.env.SUPABASE_SECRET_KEY;

    expect(() => validateEnvironment()).toThrow(
      'Missing required environment variable: SUPABASE_SECRET_KEY',
    );
  });

  it('throws when production Google exchange encryption key is missing or weak', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    delete process.env.GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY;

    expect(() => validateEnvironment()).toThrow(
      'Missing required environment variable: GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY',
    );

    process.env.GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY = 'short-key';
    expect(() => validateEnvironment()).toThrow(
      'GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY must be a 32-byte base64 key or at least 32 characters',
    );
  });

  it('throws when production does not explicitly select Supabase storage', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.FILE_STORAGE_DRIVER = 'local';

    expect(() => validateEnvironment()).toThrow(
      'FILE_STORAGE_DRIVER=supabase is required in production',
    );
  });

  it('rejects wildcard CORS in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = '*';

    expect(() => validateEnvironment()).toThrow(
      'CORS_ORIGINS=* is not allowed in production',
    );
  });

  it('rejects missing CORS allow-list in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    delete process.env.CORS_ORIGINS;
    delete process.env.ALLOWED_ORIGINS;

    expect(() => validateEnvironment()).toThrow(
      'CORS_ORIGINS must be set to a comma-separated list of trusted frontend origins in production',
    );
  });

  it('rejects localhost and non-https CORS origins in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';

    process.env.CORS_ORIGINS = 'http://localhost:3000';
    expect(() => validateEnvironment()).toThrow(
      'CORS_ORIGINS entries must use https in production',
    );

    process.env.CORS_ORIGINS = 'https://localhost:3000';
    expect(() => validateEnvironment()).toThrow(
      'CORS_ORIGINS cannot include localhost in production',
    );
  });

  it('rejects multiple or mismatched production CORS origins', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS =
      'https://app.example.com,https://preview.example.com';

    expect(() => validateEnvironment()).toThrow(
      'CORS_ORIGINS must contain exactly one Vercel production frontend origin in production',
    );

    process.env.CORS_ORIGINS = 'https://other.example.com';

    expect(() => validateEnvironment()).toThrow(
      'CORS_ORIGINS must exactly match FRONTEND_BASE_URL in production',
    );
  });

  it('keeps flexible wildcard CORS support in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'http://localhost:3001';
    process.env.APP_URL = 'http://localhost:3000';
    process.env.FILE_STORAGE_DRIVER = 'local';
    process.env.CORS_ORIGINS = '*';

    const env = validateEnvironment();
    expect(env.corsOrigins).toHaveLength(1);
    expect(env.corsOrigins[0]).toBeInstanceOf(RegExp);
    expect((env.corsOrigins[0] as RegExp).test('https://app.example.com')).toBe(
      true,
    );
  });

  it('keeps localhost fallback CORS support in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'http://localhost:3001';
    process.env.APP_URL = 'http://localhost:3000';
    process.env.FILE_STORAGE_DRIVER = 'local';
    delete process.env.CORS_ORIGINS;
    delete process.env.ALLOWED_ORIGINS;

    const env = validateEnvironment();

    expect(env.corsOrigins).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
    ]);
  });

  it('accepts frontend URL from FRONTEND_URL alias', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    delete process.env.FRONTEND_BASE_URL;
    delete process.env.APP_URL;

    const env = validateEnvironment();

    expect(env.frontendBaseUrl).toBe('https://app.example.com');
  });

  it('accepts CORS origins from ALLOWED_ORIGINS alias', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    delete process.env.CORS_ORIGINS;

    const env = validateEnvironment();

    expect(env.corsOrigins).toEqual(['https://app.example.com']);
  });

  it('allows production when EMAIL_VERIFICATION_SECRET is missing but JWT_SECRET exists', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.FRONTEND_BASE_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    delete process.env.EMAIL_VERIFICATION_SECRET;

    const env = validateEnvironment();

    expect(env.emailVerificationSecret).toBe(process.env.JWT_SECRET);
  });

  it('allows production when frontend URL comes from RENDER_EXTERNAL_URL', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID =
      'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.RENDER_EXTERNAL_URL = 'https://gmao-api.onrender.com';
    process.env.CORS_ORIGINS = 'https://gmao-api.onrender.com';
    delete process.env.FRONTEND_BASE_URL;
    delete process.env.APP_URL;

    const env = validateEnvironment();

    expect(env.frontendBaseUrl).toBe('https://gmao-api.onrender.com');
  });

  it('does not require strict env variables during tests', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.MONGODB_URI;
    delete process.env.JWT_SECRET;

    const env = validateEnvironment();

    expect(env.nodeEnv).toBe('test');
    expect(env.port).toBe(3001);
  });

  it('defaults BUSINESS_TIMEZONE to Africa/Tunis when unset', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.BUSINESS_TIMEZONE;

    const env = validateEnvironment();

    expect(env.businessTimezone).toBe('Africa/Tunis');
  });

  it('accepts a configured IANA BUSINESS_TIMEZONE', () => {
    process.env.NODE_ENV = 'test';
    process.env.BUSINESS_TIMEZONE = 'America/New_York';

    const env = validateEnvironment();

    expect(env.businessTimezone).toBe('America/New_York');
  });

  it('rejects an invalid BUSINESS_TIMEZONE', () => {
    process.env.NODE_ENV = 'test';
    process.env.BUSINESS_TIMEZONE = 'Not/A_Real_Zone';

    expect(() => validateEnvironment()).toThrow(
      'BUSINESS_TIMEZONE must be a valid IANA timezone name',
    );
  });

  it('defaults the AI assistant to disabled', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.AI_ASSISTANT_ENABLED;

    const env = validateEnvironment();

    expect(env.aiAssistantEnabled).toBe(false);
  });

  it('rejects AI_ASSISTANT_ENABLED=true with a non-Gemini provider', () => {
    process.env.NODE_ENV = 'test';
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_ASSISTANT_PROVIDER = 'anthropic';

    expect(() => validateEnvironment()).toThrow(
      'AI_ASSISTANT_PROVIDER must be "gemini" when AI_ASSISTANT_ENABLED=true',
    );
  });

  it('rejects AI_ASSISTANT_ENABLED=true in production without a GEMINI_API_KEY', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_ASSISTANT_PROVIDER = 'gemini';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    delete process.env.GEMINI_API_KEY;

    expect(() => validateEnvironment()).toThrow(
      'GEMINI_API_KEY is required when AI_ASSISTANT_ENABLED=true and AI_ASSISTANT_PROVIDER=gemini in production',
    );
  });

  it('rejects AI_ASSISTANT_ENABLED=true in production without a GEMINI_MODEL', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_ASSISTANT_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    delete process.env.GEMINI_MODEL;

    expect(() => validateEnvironment()).toThrow(
      'GEMINI_MODEL is required when AI_ASSISTANT_ENABLED=true and AI_ASSISTANT_PROVIDER=gemini in production',
    );
  });

  it('accepts AI_ASSISTANT_ENABLED=true in production with Gemini configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/gmao';
    process.env.JWT_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.BACKEND_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.AI_ASSISTANT_ENABLED = 'true';
    process.env.AI_ASSISTANT_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';

    const env = validateEnvironment();

    expect(env.aiAssistantEnabled).toBe(true);
  });

  it('rejects a non-numeric AI_ASSISTANT_TIMEOUT_MS', () => {
    process.env.NODE_ENV = 'test';
    process.env.AI_ASSISTANT_TIMEOUT_MS = 'not-a-number';

    expect(() => validateEnvironment()).toThrow(
      'AI_ASSISTANT_TIMEOUT_MS must be a positive integer number of milliseconds',
    );
  });

  it('rejects a non-positive AI_ASSISTANT_RATE_LIMIT_PER_HOUR', () => {
    process.env.NODE_ENV = 'test';
    process.env.AI_ASSISTANT_RATE_LIMIT_PER_HOUR = '0';

    expect(() => validateEnvironment()).toThrow(
      'AI_ASSISTANT_RATE_LIMIT_PER_HOUR must be a positive integer',
    );
  });

  it('defaults the predictive maintenance scheduler to enabled', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PREDICTIVE_MAINTENANCE_ENABLED;

    const env = validateEnvironment();

    expect(env.predictiveMaintenanceEnabled).toBe(true);
  });

  it('allows disabling the predictive maintenance scheduler', () => {
    process.env.NODE_ENV = 'test';
    process.env.PREDICTIVE_MAINTENANCE_ENABLED = 'false';

    const env = validateEnvironment();

    expect(env.predictiveMaintenanceEnabled).toBe(false);
  });

  it('defaults PREDICTION_HISTORY_RETENTION_SECONDS to 180 days', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PREDICTION_HISTORY_RETENTION_SECONDS;

    const env = validateEnvironment();

    expect(env.predictionHistoryRetentionSeconds).toBe(180 * 24 * 60 * 60);
  });

  it('rejects a non-positive PREDICTION_HISTORY_RETENTION_SECONDS', () => {
    process.env.NODE_ENV = 'test';
    process.env.PREDICTION_HISTORY_RETENTION_SECONDS = '-1';

    expect(() => validateEnvironment()).toThrow(
      'PREDICTION_HISTORY_RETENTION_SECONDS must be a positive integer number of seconds',
    );
  });

  it('defaults TRUST_PROXY to false when unset', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.TRUST_PROXY;

    const env = validateEnvironment();

    expect(env.trustProxy).toBe(false);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['yes', true],
    ['no', false],
  ])('parses TRUST_PROXY=%s as boolean %s', (value, expected) => {
    process.env.NODE_ENV = 'test';
    process.env.TRUST_PROXY = value;

    const env = validateEnvironment();

    expect(env.trustProxy).toBe(expected);
  });

  it('parses a numeric TRUST_PROXY as a hop count', () => {
    process.env.NODE_ENV = 'test';
    process.env.TRUST_PROXY = '2';

    const env = validateEnvironment();

    expect(env.trustProxy).toBe(2);
  });

  it('accepts a TRUST_PROXY subnet/CIDR string as-is', () => {
    process.env.NODE_ENV = 'test';
    process.env.TRUST_PROXY = '10.0.0.0/8';

    const env = validateEnvironment();

    expect(env.trustProxy).toBe('10.0.0.0/8');
  });

  it.each([
    'THROTTLE_DEFAULT_LIMIT',
    'THROTTLE_DEFAULT_TTL_MS',
    'THROTTLE_DEVICE_LIMIT',
    'THROTTLE_DEVICE_TTL_MS',
  ])('rejects a non-positive-integer %s', (key) => {
    process.env.NODE_ENV = 'test';
    process.env[key] = '0';

    expect(() => validateEnvironment()).toThrow(`${key} must be a positive integer`);
  });

  it('allows throttle env vars to be unset, relying on defaults applied at point of use', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.THROTTLE_DEFAULT_LIMIT;
    delete process.env.THROTTLE_DEFAULT_TTL_MS;
    delete process.env.THROTTLE_DEVICE_LIMIT;
    delete process.env.THROTTLE_DEVICE_TTL_MS;

    expect(() => validateEnvironment()).not.toThrow();
  });
});
