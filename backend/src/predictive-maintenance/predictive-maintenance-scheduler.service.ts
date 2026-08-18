import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { PredictiveMaintenanceTrainingService } from './predictive-maintenance-training.service';
import { PredictiveMaintenanceService } from './predictive-maintenance.service';
import {
  SchedulerConfigService,
  defaultSchedulerSettings,
} from '../scheduler/scheduler.config';
import { SchedulerLockService } from '../scheduler/scheduler-lock.service';
import { createRunId, mapWithConcurrency } from '../scheduler/scheduler-utils';

type JobResult = { processed: number; details?: Record<string, unknown> };

interface PredictionSweepCounters {
  scanned: number;
  processed: number;
  failed: number;
  batches: number;
}

/**
 * Keeps the feature usable with zero manual setup: on every tick it first
 * bootstraps a model version for any registered model type that has never
 * been trained (`trainAllMissing`), then re-runs predictions for every
 * machine so dashboards/plans/work-order views always have a reasonably
 * fresh reading. A standalone service with its own cadence rather than a
 * job folded into `AutomationSchedulerService`, following the same
 * separation `DeviceOfflineSweepService` already established in this
 * codebase for a feature with its own independent schedule.
 */
@Injectable()
export class PredictiveMaintenanceSchedulerService {
  private readonly logger = new Logger(
    PredictiveMaintenanceSchedulerService.name,
  );

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    private readonly trainingService: PredictiveMaintenanceTrainingService,
    private readonly predictiveMaintenanceService: PredictiveMaintenanceService,
    @Optional()
    private readonly schedulerConfigService?: SchedulerConfigService,
    @Optional()
    private readonly schedulerLockService?: SchedulerLockService,
  ) {}

  @Cron('30 1 * * *', { name: 'predictive-maintenance-sweep' })
  async sweep(): Promise<JobResult> {
    return this.runSweep();
  }

  async runSweep(): Promise<JobResult> {
    const settings =
      this.schedulerConfigService?.getSettings() ?? defaultSchedulerSettings();
    if (!settings.enabled) {
      this.logger.log(
        'Predictive maintenance sweep skipped scheduler disabled.',
      );
      return { processed: 0 };
    }

    if (!this.isEnabled()) {
      this.logger.log(
        'Predictive maintenance sweep skipped (PREDICTIVE_MAINTENANCE_ENABLED=false).',
      );
      return { processed: 0 };
    }

    const runId = createRunId();
    const lock = await this.schedulerLockService?.acquire(
      'predictive-maintenance-sweep',
      runId,
      settings.lockTtlMs,
    );
    if (this.schedulerLockService && !lock) {
      this.logger.warn(
        JSON.stringify({
          jobName: 'predictive-maintenance-sweep',
          runId,
          instanceId: this.schedulerLockService.getInstanceId(),
          status: 'skipped',
          lockAcquired: false,
        }),
      );
      return { processed: 0 };
    }

    const startedAt = Date.now();
    const deadline = startedAt + settings.jobTimeoutMs;
    let status = 'completed';
    const counters: PredictionSweepCounters = {
      scanned: 0,
      processed: 0,
      failed: 0,
      batches: 0,
    };

    try {
      const bootstrapped = await this.trainingService.trainAllMissing();
      if (bootstrapped.length > 0) {
        this.logger.log(
          `Bootstrapped model version(s) for: ${bootstrapped.join(', ')}`,
        );
      }

      let lastId: Types.ObjectId | undefined;
      while (this.shouldContinueSweep(deadline, counters.scanned, settings)) {
        const machines = await this.findPredictionCandidates(
          lastId,
          counters.scanned,
          settings,
        );

        if (!machines.length) break;
        await this.processPredictionBatch(
          machines,
          deadline,
          counters,
          settings,
        );
        lastId = machines.at(-1)!._id;
        if (machines.length < settings.batchSize) break;
        if (lock) {
          const ownsLock = await this.schedulerLockService?.heartbeat(
            lock,
            settings.lockTtlMs,
          );
          if (!ownsLock) break;
        }
      }

      if (Date.now() >= deadline) {
        status = 'timed_out';
      }

      this.logger.log(
        JSON.stringify({
          jobName: 'predictive-maintenance-sweep',
          runId,
          instanceId:
            this.schedulerLockService?.getInstanceId() ?? 'local-test',
          status,
          lockAcquired: Boolean(lock),
          scanned: counters.scanned,
          processed: counters.processed,
          succeeded: counters.processed,
          failed: counters.failed,
          skipped: Math.max(
            0,
            counters.scanned - counters.processed - counters.failed,
          ),
          batches: counters.batches,
          durationMs: Date.now() - startedAt,
        }),
      );
      return {
        processed: counters.processed,
        details: {
          scanned: counters.scanned,
          failed: counters.failed,
          batches: counters.batches,
          status,
        },
      };
    } finally {
      if (lock) {
        await this.schedulerLockService?.release(lock, status);
      }
    }
  }

  private isEnabled(): boolean {
    const value = this.configService.get<string>(
      'PREDICTIVE_MAINTENANCE_ENABLED',
    );
    if (value === undefined) return true;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  private shouldContinueSweep(
    deadline: number,
    scanned: number,
    settings: ReturnType<SchedulerConfigService['getSettings']>,
  ): boolean {
    return Date.now() < deadline && scanned < settings.maxItemsPerRun;
  }

  private findPredictionCandidates(
    lastId: Types.ObjectId | undefined,
    scanned: number,
    settings: ReturnType<SchedulerConfigService['getSettings']>,
  ): Promise<MachineDocument[]> {
    const remaining = settings.maxItemsPerRun - scanned;
    return this.machineModel
      .find(lastId ? { _id: { $gt: lastId } } : {})
      .select({ _id: 1 })
      .sort({ _id: 1 })
      .limit(Math.min(settings.batchSize, remaining))
      .exec();
  }

  private async processPredictionBatch(
    machines: MachineDocument[],
    deadline: number,
    counters: PredictionSweepCounters,
    settings: ReturnType<SchedulerConfigService['getSettings']>,
  ): Promise<void> {
    counters.batches += 1;
    counters.scanned += machines.length;

    await mapWithConcurrency(
      machines,
      settings.concurrency,
      async (machine) => {
        const succeeded = await this.runPredictionCandidate(machine, deadline);
        if (succeeded === true) counters.processed += 1;
        if (succeeded === false) counters.failed += 1;
      },
    );
  }

  private async runPredictionCandidate(
    machine: MachineDocument,
    deadline: number,
  ): Promise<boolean | null> {
    if (Date.now() >= deadline) return null;

    try {
      await this.predictiveMaintenanceService.runPredictionForMachine(
        machine._id.toString(),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to run predictions for machine ${machine._id.toString()}: ${String(
          error,
        )}`,
      );
      return false;
    }
  }
}
