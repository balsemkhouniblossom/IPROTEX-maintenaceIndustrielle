import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { PredictiveMaintenanceTrainingService } from './predictive-maintenance-training.service';
import { PredictiveMaintenanceService } from './predictive-maintenance.service';

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
  ) {}

  @Cron('30 1 * * *', { name: 'predictive-maintenance-sweep' })
  async sweep(): Promise<JobResult> {
    return this.runSweep();
  }

  async runSweep(): Promise<JobResult> {
    if (!this.isEnabled()) {
      this.logger.log(
        'Predictive maintenance sweep skipped (PREDICTIVE_MAINTENANCE_ENABLED=false).',
      );
      return { processed: 0 };
    }

    const bootstrapped = await this.trainingService.trainAllMissing();
    if (bootstrapped.length > 0) {
      this.logger.log(
        `Bootstrapped model version(s) for: ${bootstrapped.join(', ')}`,
      );
    }

    const machines = await this.machineModel.find({}).select({ _id: 1 }).exec();
    let processed = 0;

    for (const machine of machines) {
      try {
        await this.predictiveMaintenanceService.runPredictionForMachine(
          machine._id.toString(),
        );
        processed += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to run predictions for machine ${machine._id.toString()}: ${String(error)}`,
        );
      }
    }

    return { processed, details: { scanned: machines.length } };
  }

  private isEnabled(): boolean {
    const value = this.configService.get<string>(
      'PREDICTIVE_MAINTENANCE_ENABLED',
    );
    if (value === undefined) return true;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
}
