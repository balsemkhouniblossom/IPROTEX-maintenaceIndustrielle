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
    let scanned = 0;
    let processed = 0;
    let failed = 0;
    let batches = 0;

    try {
      const bootstrapped = await this.trainingService.trainAllMissing();
      if (bootstrapped.length > 0) {
        this.logger.log(
          `Bootstrapped model version(s) for: ${bootstrapped.join(', ')}`,
        );
      }

      let lastId: Types.ObjectId | undefined;
      while (Date.now() < deadline && scanned < settings.maxItemsPerRun) {
        const remaining = settings.maxItemsPerRun - scanned;
        const filter = lastId ? { _id: { $gt: lastId } } : {};
        const machines = await this.machineModel
          .find(filter)
          .select({ _id: 1 })
          .sort({ _id: 1 })
          .limit(Math.min(settings.batchSize, remaining))
          .exec();

        if (!machines.length) break;
        batches += 1;
        scanned += machines.length;
        await mapWithConcurrency(
          machines,
          settings.concurrency,
          async (machine) => {
            const succeeded = await this.runPredictionCandidate(
              machine,
              deadline,
            );
            if (succeeded === true) processed += 1;
            if (succeeded === false) {
              failed += 1;
            }
          },
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
          scanned,
          processed,
          succeeded: processed,
          failed,
          skipped: Math.max(0, scanned - processed - failed),
          batches,
          durationMs: Date.now() - startedAt,
        }),
      );
      return { processed, details: { scanned, failed, batches, status } };
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
