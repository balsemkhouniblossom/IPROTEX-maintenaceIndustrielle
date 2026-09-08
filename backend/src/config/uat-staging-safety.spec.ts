import {
  assertSafeUatDatabase,
  assertSafeUatTarget,
  UAT_CONFIRMATION,
} from './uat-staging-safety';

const safeEnv = (): NodeJS.ProcessEnv => ({
  UAT_SEED_CONFIRM: UAT_CONFIRMATION,
  UAT_EXPECTED_DATABASE: 'gmao_uat_staging',
  MONGODB_URI:
    'mongodb+srv://user:secret@example.invalid/gmao_uat_staging?retryWrites=true',
  UAT_ADMIN_PASSWORD: 'admin-secret-123',
  UAT_TECHNICIAN_PASSWORD: 'technician-secret-123',
  UAT_OPERATOR_PASSWORD: 'operator-secret-123',
});

describe('UAT staging database guard', () => {
  it('accepts only an explicitly confirmed matching staging database', () => {
    expect(assertSafeUatDatabase(safeEnv())).toBe('gmao_uat_staging');
  });

  it.each([
    { ...safeEnv(), UAT_SEED_CONFIRM: undefined },
    { ...safeEnv(), UAT_EXPECTED_DATABASE: 'gmao' },
    { ...safeEnv(), UAT_EXPECTED_DATABASE: 'gmao_uat_other' },
    { ...safeEnv(), UAT_EXPECTED_DATABASE: 'production_uat' },
  ])('rejects unsafe or mismatched targets', (env) => {
    expect(() => assertSafeUatDatabase(env)).toThrow();
  });

  it('requires secret-fed passwords before seeding', () => {
    const env = safeEnv();
    delete env.UAT_OPERATOR_PASSWORD;
    expect(() => assertSafeUatTarget(env)).toThrow('UAT_OPERATOR_PASSWORD');
  });
});
