export const UAT_CONFIRMATION = 'SEED_ISOLATED_STAGING';

export function assertSafeUatDatabase(env: NodeJS.ProcessEnv): string {
  if (env.UAT_SEED_CONFIRM !== UAT_CONFIRMATION) {
    throw new Error(`UAT_SEED_CONFIRM must equal ${UAT_CONFIRMATION}`);
  }
  const uri = env.MONGODB_URI?.trim();
  const expected = env.UAT_EXPECTED_DATABASE?.trim();
  if (!uri || !expected)
    throw new Error('MONGODB_URI and UAT_EXPECTED_DATABASE are required');
  if (!/^(mongodb(?:\+srv)?):\/\//i.test(uri))
    throw new Error('MONGODB_URI must be a MongoDB connection string');
  if (!/(?:staging|uat|test)/i.test(expected))
    throw new Error(
      'UAT_EXPECTED_DATABASE must be explicitly staging/test named',
    );
  const withoutQuery = uri.split('?')[0].replace(/\/$/, '');
  const actual = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  if (actual !== expected)
    throw new Error(
      'MONGODB_URI database must exactly match UAT_EXPECTED_DATABASE',
    );
  if (/(?:prod|production)/i.test(actual))
    throw new Error('Production-named databases are forbidden');
  return actual;
}

export function assertSafeUatTarget(env: NodeJS.ProcessEnv): string {
  const actual = assertSafeUatDatabase(env);
  for (const name of [
    'UAT_ADMIN_PASSWORD',
    'UAT_TECHNICIAN_PASSWORD',
    'UAT_OPERATOR_PASSWORD',
  ]) {
    if ((env[name]?.length ?? 0) < 12)
      throw new Error(
        `${name} must be provided through the staging secret store`,
      );
  }
  return actual;
}
