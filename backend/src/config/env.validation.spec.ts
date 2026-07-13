import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts valid production configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.CORS_ORIGINS = 'http://localhost:3000,https://app.example.com';
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
    process.env.API_URL = 'https://api.example.com';
    process.env.APP_URL = 'https://app.example.com';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'smtp-user';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.EMAIL_FROM = 'noreply@example.com';
    process.env.ENABLE_LEGACY_EMAIL_TOKENS = 'true';
    process.env.ENABLE_EVENT_BASED_EMAILS = 'false';

    const env = validateEnvironment();

    expect(env.nodeEnv).toBe('production');
    expect(env.port).toBe(3001);
    expect(env.corsOrigins).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ]);
    expect(env.enableLegacyEmailTokens).toBe(true);
    expect(env.enableEventBasedEmails).toBe(false);
  });

  it('throws on missing required production variables', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MONGODB_URI;

    expect(() => validateEnvironment()).toThrow(
      'Missing required environment variable: MONGODB_URI',
    );
  });

  it('accepts wildcard CORS as any http/https origin matcher', () => {
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

    const env = validateEnvironment();

    expect(env.corsOrigins).toHaveLength(1);
    expect(env.corsOrigins[0]).toBeInstanceOf(RegExp);
    expect((env.corsOrigins[0] as RegExp).test('https://app.example.com')).toBe(
      true,
    );
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
    process.env.ALLOWED_ORIGINS =
      'https://app.example.com,https://preview.example.com';
    delete process.env.CORS_ORIGINS;

    const env = validateEnvironment();

    expect(env.corsOrigins).toEqual([
      'https://app.example.com',
      'https://preview.example.com',
    ]);
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
});
