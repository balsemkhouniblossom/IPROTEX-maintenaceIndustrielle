import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function parseEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) {
    return {};
  }

  const envFile = readFileSync(envPath, 'utf8');
  const values: Record<string, string> = {};

  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key) {
      values[key] = value;
    }
  }

  return values;
}

/**
 * Loads backend environment configuration from `backendDir` only — never
 * from the repository root. Precedence, lowest to highest:
 * `.env` -> `.env.local` -> `.env.<NODE_ENV>`. A value already present in
 * `env` before this call (platform-injected vars on Render, CI, the real
 * `process.env`, etc.) always wins over anything read from a file.
 */
export function loadBackendEnv(
  backendDir: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const nodeEnv = env.NODE_ENV?.trim();

  const filesLowToHighPriority = [
    '.env',
    '.env.local',
    ...(nodeEnv ? [`.env.${nodeEnv}`] : []),
  ];

  const merged: Record<string, string> = {};
  for (const fileName of filesLowToHighPriority) {
    Object.assign(merged, parseEnvFile(resolve(backendDir, fileName)));
  }

  for (const [key, value] of Object.entries(merged)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

// Jest sets JEST_WORKER_ID for every test worker; skip the real filesystem
// side effect there so unit tests can exercise `loadBackendEnv` directly
// against fixture directories instead of this process's actual env files.
if (process.env.JEST_WORKER_ID === undefined) {
  loadBackendEnv(process.cwd());
}
