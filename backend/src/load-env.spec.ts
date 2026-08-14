import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadBackendEnv } from './load-env';

describe('loadBackendEnv', () => {
  let backendDir: string;

  beforeEach(() => {
    backendDir = mkdtempSync(join(tmpdir(), 'gmao-backend-env-'));
  });

  afterEach(() => {
    rmSync(backendDir, { recursive: true, force: true });
  });

  function writeBackendFile(fileName: string, contents: string): void {
    writeFileSync(join(backendDir, fileName), contents, 'utf8');
  }

  it('loads values from backend/.env', () => {
    writeBackendFile('.env', 'FOO=from-backend-env\n');

    const env: NodeJS.ProcessEnv = {};
    loadBackendEnv(backendDir, env);

    expect(env.FOO).toBe('from-backend-env');
  });

  it('never reads a root .env one directory above backendDir', () => {
    writeBackendFile('.env', 'FOO=from-backend-env\n');

    // Simulate the repository root sitting one level above the backend
    // directory, the way `GMAO/.env` sits above `GMAO/backend/`.
    const rootDir = resolve(backendDir, '..');
    const rootEnvPath = join(rootDir, '.env');
    writeFileSync(
      rootEnvPath,
      'FOO=from-root-env\nROOT_ONLY_VAR=should-never-load\n',
      'utf8',
    );

    try {
      const env: NodeJS.ProcessEnv = {};
      loadBackendEnv(backendDir, env);

      expect(env.FOO).toBe('from-backend-env');
      expect(env.ROOT_ONLY_VAR).toBeUndefined();
    } finally {
      rmSync(rootEnvPath, { force: true });
    }
  });

  it('never lets a root .env override backend/.env for a shared key', () => {
    writeBackendFile('.env', 'SHARED_KEY=backend-value\n');

    const rootDir = resolve(backendDir, '..');
    const rootEnvPath = join(rootDir, '.env');
    writeFileSync(rootEnvPath, 'SHARED_KEY=root-value\n', 'utf8');

    try {
      const env: NodeJS.ProcessEnv = {};
      loadBackendEnv(backendDir, env);

      expect(env.SHARED_KEY).toBe('backend-value');
    } finally {
      rmSync(rootEnvPath, { force: true });
    }
  });

  it('does not override a value already present in the process environment', () => {
    writeBackendFile('.env', 'JWT_SECRET=file-value\n');

    const env: NodeJS.ProcessEnv = { JWT_SECRET: 'platform-injected-value' };
    loadBackendEnv(backendDir, env);

    expect(env.JWT_SECRET).toBe('platform-injected-value');
  });

  it('lets an environment-specific file override the base .env', () => {
    writeBackendFile('.env', 'MODE_LABEL=base\n');
    writeBackendFile('.env.production', 'MODE_LABEL=production\n');

    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    loadBackendEnv(backendDir, env);

    expect(env.MODE_LABEL).toBe('production');
  });

  it('reads backend/.env.test when NODE_ENV=test', () => {
    writeBackendFile('.env', 'MODE_LABEL=base\n');
    writeBackendFile('.env.test', 'MODE_LABEL=test\n');

    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    loadBackendEnv(backendDir, env);

    expect(env.MODE_LABEL).toBe('test');
  });

  it('lets backend/.env.local override the base .env when no NODE_ENV file matches', () => {
    writeBackendFile('.env', 'MODE_LABEL=base\n');
    writeBackendFile('.env.local', 'MODE_LABEL=local\n');

    const env: NodeJS.ProcessEnv = {};
    loadBackendEnv(backendDir, env);

    expect(env.MODE_LABEL).toBe('local');
  });

  it('lets an environment-specific file win over .env.local', () => {
    writeBackendFile('.env', 'MODE_LABEL=base\n');
    writeBackendFile('.env.local', 'MODE_LABEL=local\n');
    writeBackendFile('.env.production', 'MODE_LABEL=production\n');

    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    loadBackendEnv(backendDir, env);

    expect(env.MODE_LABEL).toBe('production');
  });

  it('is a no-op when no env files exist in backendDir', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    loadBackendEnv(backendDir, env);

    expect(Object.keys(env)).toEqual(['NODE_ENV']);
  });
});
