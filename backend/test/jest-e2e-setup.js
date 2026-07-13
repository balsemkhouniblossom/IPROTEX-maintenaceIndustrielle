/**
 * Global setup for e2e tests.
 * Supplies stub values for required env vars so AppModule can boot without real secrets.
 */
module.exports = async function () {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.GOOGLE_CLIENT_ID =
    process.env.GOOGLE_CLIENT_ID ||
    'e2e-test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_CLIENT_SECRET || 'e2e-test-google-client-secret';
  process.env.GOOGLE_CALLBACK_URL =
    process.env.GOOGLE_CALLBACK_URL ||
    'http://localhost:3001/auth/google/callback';
  process.env.FRONTEND_URL =
    process.env.FRONTEND_URL || 'http://localhost:3000';
  process.env.BACKEND_URL =
    process.env.BACKEND_URL || 'http://localhost:3001';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'e2e-test-refresh-secret';
  process.env.EMAIL_VERIFICATION_SECRET =
    process.env.EMAIL_VERIFICATION_SECRET || 'e2e-test-email-verification-secret';
  process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/GMAO_IPROTEX_TEST';
  process.env.PORT = process.env.PORT || '3001';
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:3000';
};
