/**
 * Post-deploy smoke test: hits a running backend's public health endpoints
 * and confirms they respond with the expected shape. Deliberately limited
 * to unauthenticated, side-effect-free routes (`/health`, `/health/api`) —
 * everything else the API exposes requires a role-scoped JWT, and minting
 * one here would mean embedding or acquiring real credentials in a CI
 * step, which is out of scope for this check.
 *
 * Usage:
 *   npm run smoke-test -- --url=https://pfe-maintenaceindustrielle.onrender.com
 *   SMOKE_TEST_BASE_URL=https://gmao-staging-api.onrender.com npm run smoke-test
 *
 * Exits non-zero (and prints exactly what failed) on any unreachable route,
 * unexpected status code, or unexpected response shape — suitable as a
 * post-deploy gate in `cd-deploy.yml`.
 */

type SmokeCheck = {
  name: string;
  path: string;
  expectedStatus: number;
  validate: (body: unknown) => string | null; // returns an error message, or null if valid
};

const CHECKS: SmokeCheck[] = [
  {
    name: 'API liveness',
    path: '/health/api',
    expectedStatus: 200,
    validate: (body) => validateStatusField(body, 'ok'),
  },
  {
    name: 'Public readiness (API + database)',
    path: '/health',
    expectedStatus: 200,
    validate: (body) => validateStatusField(body, 'ok'),
  },
];

function validateStatusField(body: unknown, expected: string): string | null {
  if (typeof body !== 'object' || body === null) {
    return `expected a JSON object, got ${typeof body}`;
  }
  const status = (body as { status?: unknown }).status;
  if (status !== expected) {
    return `expected status="${expected}", got ${JSON.stringify(status)}`;
  }
  return null;
}

function resolveBaseUrl(): string {
  const fromArg = process.argv
    .find((arg) => arg.startsWith('--url='))
    ?.slice('--url='.length);
  const baseUrl = fromArg || process.env.SMOKE_TEST_BASE_URL;

  if (!baseUrl) {
    throw new Error(
      'Missing target URL — pass --url=<base> or set SMOKE_TEST_BASE_URL',
    );
  }

  return baseUrl.replace(/\/$/, '');
}

async function runCheck(baseUrl: string, check: SmokeCheck): Promise<void> {
  const url = `${baseUrl}${check.path}`;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `${check.name} (${url}): request failed — ${String(error)}`,
    );
  }

  const durationMs = Date.now() - startedAt;

  if (response.status !== check.expectedStatus) {
    throw new Error(
      `${check.name} (${url}): expected HTTP ${check.expectedStatus}, got ${response.status}`,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  const validationError = check.validate(body);
  if (validationError) {
    throw new Error(`${check.name} (${url}): ${validationError}`);
  }

  console.log(`  ok — ${check.name} (${durationMs}ms)`);
}

async function main() {
  const baseUrl = resolveBaseUrl();
  console.log(`Smoke testing ${baseUrl}`);

  const failures: string[] = [];
  for (const check of CHECKS) {
    try {
      await runCheck(baseUrl, check);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    console.error('\nSmoke test FAILED:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log('\nSmoke test passed.');
}

void main();
