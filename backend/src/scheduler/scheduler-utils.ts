import { randomUUID } from 'crypto';
import {
  SchedulerJobContext,
  SchedulerJobCounters,
  SchedulerJobResult,
  SchedulerJobStatus,
} from './scheduler.types';

export function createRunId(): string {
  return randomUUID();
}

export function createInstanceId(prefix = 'scheduler'): string {
  return `${prefix}-${process.pid}-${randomUUID()}`;
}

export function createSchedulerContext(
  jobName: string,
  runId: string,
  instanceId: string,
  timeoutMs: number,
  heartbeat: () => Promise<boolean>,
): SchedulerJobContext {
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + timeoutMs);
  return {
    jobName,
    runId,
    instanceId,
    startedAt,
    deadlineAt,
    shouldContinue: () => Date.now() < deadlineAt.getTime(),
    remainingMs: () => Math.max(0, deadlineAt.getTime() - Date.now()),
    heartbeat,
  };
}

export function buildSchedulerJobResult(input: {
  jobName: string;
  runId: string;
  instanceId: string;
  triggerTime: Date;
  startTime: Date;
  finishTime?: Date;
  status: SchedulerJobStatus;
  lockAcquired: boolean;
  counters?: SchedulerJobCounters;
  details?: Record<string, unknown>;
}): SchedulerJobResult {
  const finishTime = input.finishTime ?? new Date();
  const counters = input.counters ?? {};
  return {
    jobName: input.jobName,
    runId: input.runId,
    instanceId: input.instanceId,
    status: input.status,
    triggerTime: input.triggerTime.toISOString(),
    startTime: input.startTime.toISOString(),
    finishTime: finishTime.toISOString(),
    durationMs: finishTime.getTime() - input.startTime.getTime(),
    lockAcquired: input.lockAcquired,
    scanned: counters.scanned ?? 0,
    processed: counters.processed ?? 0,
    succeeded: counters.succeeded ?? 0,
    failed: counters.failed ?? 0,
    skipped: counters.skipped ?? 0,
    batches: counters.batches ?? 0,
    retries: counters.retries ?? 0,
    timedOut: input.status === 'timed_out',
    details: input.details,
  };
}

export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}
