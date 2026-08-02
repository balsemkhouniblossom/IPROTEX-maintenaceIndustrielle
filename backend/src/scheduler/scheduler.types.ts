export type SchedulerJobStatus =
  | 'completed'
  | 'partial'
  | 'skipped'
  | 'failed'
  | 'timed_out';

export interface SchedulerJobResult {
  jobName: string;
  runId: string;
  instanceId: string;
  status: SchedulerJobStatus;
  triggerTime: string;
  startTime: string;
  finishTime: string;
  durationMs: number;
  lockAcquired: boolean;
  scanned: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  batches: number;
  retries: number;
  timedOut: boolean;
  details?: Record<string, unknown>;
}

export interface SchedulerJobCounters {
  scanned?: number;
  processed?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  batches?: number;
  retries?: number;
}

export interface SchedulerJobContext {
  jobName: string;
  runId: string;
  instanceId: string;
  startedAt: Date;
  deadlineAt: Date;
  shouldContinue(): boolean;
  remainingMs(): number;
  heartbeat(): Promise<boolean>;
}

export interface SchedulerLockHandle {
  jobName: string;
  ownerId: string;
  runId: string;
  expiresAt: Date;
}
