import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SchedulerRuntimeSettings {
  enabled: boolean;
  batchSize: number;
  concurrency: number;
  externalConcurrency: number;
  lockTtlMs: number;
  lockHeartbeatMs: number;
  jobTimeoutMs: number;
  maxItemsPerRun: number;
}

const DEFAULTS: SchedulerRuntimeSettings = {
  enabled: true,
  batchSize: 250,
  concurrency: 4,
  externalConcurrency: 2,
  lockTtlMs: 15 * 60 * 1000,
  lockHeartbeatMs: 60 * 1000,
  jobTimeoutMs: 10 * 60 * 1000,
  maxItemsPerRun: 5000,
};

const LIMITS = {
  batchSize: { min: 1, max: 5000 },
  concurrency: { min: 1, max: 32 },
  externalConcurrency: { min: 1, max: 16 },
  lockTtlMs: { min: 30_000, max: 60 * 60 * 1000 },
  lockHeartbeatMs: { min: 5_000, max: 10 * 60 * 1000 },
  jobTimeoutMs: { min: 10_000, max: 6 * 60 * 60 * 1000 },
  maxItemsPerRun: { min: 1, max: 1_000_000 },
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(
    `Invalid AUTOMATION_SCHEDULER_ENABLED value "${value}". Use true or false.`,
  );
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}.`,
    );
  }
  return parsed;
}

@Injectable()
export class SchedulerConfigService {
  constructor(private readonly configService: ConfigService) {
    this.getSettings();
  }

  getSettings(): SchedulerRuntimeSettings {
    const settings: SchedulerRuntimeSettings = {
      enabled: parseBoolean(
        this.configService.get<string>('AUTOMATION_SCHEDULER_ENABLED'),
        DEFAULTS.enabled,
      ),
      batchSize: parseInteger(
        'AUTOMATION_BATCH_SIZE',
        this.configService.get<string>('AUTOMATION_BATCH_SIZE'),
        DEFAULTS.batchSize,
        LIMITS.batchSize,
      ),
      concurrency: parseInteger(
        'AUTOMATION_CONCURRENCY',
        this.configService.get<string>('AUTOMATION_CONCURRENCY'),
        DEFAULTS.concurrency,
        LIMITS.concurrency,
      ),
      externalConcurrency: parseInteger(
        'AUTOMATION_EXTERNAL_CONCURRENCY',
        this.configService.get<string>('AUTOMATION_EXTERNAL_CONCURRENCY'),
        DEFAULTS.externalConcurrency,
        LIMITS.externalConcurrency,
      ),
      lockTtlMs: parseInteger(
        'AUTOMATION_LOCK_TTL_MS',
        this.configService.get<string>('AUTOMATION_LOCK_TTL_MS'),
        DEFAULTS.lockTtlMs,
        LIMITS.lockTtlMs,
      ),
      lockHeartbeatMs: parseInteger(
        'AUTOMATION_LOCK_HEARTBEAT_MS',
        this.configService.get<string>('AUTOMATION_LOCK_HEARTBEAT_MS'),
        DEFAULTS.lockHeartbeatMs,
        LIMITS.lockHeartbeatMs,
      ),
      jobTimeoutMs: parseInteger(
        'AUTOMATION_JOB_TIMEOUT_MS',
        this.configService.get<string>('AUTOMATION_JOB_TIMEOUT_MS'),
        DEFAULTS.jobTimeoutMs,
        LIMITS.jobTimeoutMs,
      ),
      maxItemsPerRun: parseInteger(
        'AUTOMATION_MAX_ITEMS_PER_RUN',
        this.configService.get<string>('AUTOMATION_MAX_ITEMS_PER_RUN'),
        DEFAULTS.maxItemsPerRun,
        LIMITS.maxItemsPerRun,
      ),
    };

    if (settings.lockHeartbeatMs >= settings.lockTtlMs) {
      throw new Error(
        'AUTOMATION_LOCK_HEARTBEAT_MS must be lower than AUTOMATION_LOCK_TTL_MS.',
      );
    }
    if (settings.lockTtlMs < settings.jobTimeoutMs + settings.lockHeartbeatMs) {
      throw new Error(
        'AUTOMATION_LOCK_TTL_MS must exceed AUTOMATION_JOB_TIMEOUT_MS plus AUTOMATION_LOCK_HEARTBEAT_MS.',
      );
    }

    return settings;
  }
}

export function defaultSchedulerSettings(): SchedulerRuntimeSettings {
  return { ...DEFAULTS };
}
