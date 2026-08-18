import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Device,
  DeviceConnectionStatus,
  DeviceDocument,
} from '../schemas/device.schema';
import { LiveStatusService } from './live-status.service';
import { LiveMonitoringGateway } from './live-monitoring.gateway';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import { Role } from '../schemas/user.schema';
import {
  SchedulerConfigService,
  defaultSchedulerSettings,
} from '../scheduler/scheduler.config';
import { SchedulerLockService } from '../scheduler/scheduler-lock.service';
import { createRunId, mapWithConcurrency } from '../scheduler/scheduler-utils';

interface JobResult {
  processed: number;
  details?: Record<string, unknown>;
}

type OfflineCandidateResult = 'transitioned' | 'skipped' | 'failed';

/**
 * Kept as its own small service rather than folded into
 * `AutomationSchedulerService` — that class already carries a large,
 * well-tested set of unrelated maintenance/stock/sensor jobs, and device
 * liveness has a fundamentally different cadence (heartbeats are
 * seconds-to-minutes scale, so the sweep runs every minute, not every 10).
 * Adding a new constructor dependency and job to that class would widen its
 * blast radius for no shared benefit.
 *
 * `GET`-time status (`LiveStatusService.isOnline`) is always computed fresh
 * from `last_seen_at` and is the source of truth. This sweep exists only to
 * detect the *transition* to offline (an online-looking device receiving no
 * further heartbeats) and turn it into exactly one WebSocket push and one
 * notification per transition — not to compute status itself.
 */
@Injectable()
export class DeviceOfflineSweepService {
  private readonly logger = new Logger(DeviceOfflineSweepService.name);

  constructor(
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>,
    private readonly liveStatusService: LiveStatusService,
    private readonly liveMonitoringGateway: LiveMonitoringGateway,
    private readonly notificationCenterService: NotificationCenterService,
    @Optional()
    private readonly schedulerConfigService?: SchedulerConfigService,
    @Optional()
    private readonly schedulerLockService?: SchedulerLockService,
  ) {}

  @Cron('*/1 * * * *', { name: 'device-offline-sweep' })
  async sweep(): Promise<JobResult> {
    return this.runSweep();
  }

  async runSweep(): Promise<JobResult> {
    const settings =
      this.schedulerConfigService?.getSettings() ?? defaultSchedulerSettings();
    if (!settings.enabled) {
      this.logger.log('Device offline sweep skipped scheduler disabled.');
      return { processed: 0 };
    }

    const runId = createRunId();
    const lock = await this.schedulerLockService?.acquire(
      'device-offline-sweep',
      runId,
      settings.lockTtlMs,
    );
    if (this.schedulerLockService && !lock) {
      this.logger.warn(
        JSON.stringify({
          jobName: 'device-offline-sweep',
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

    let transitioned = 0;
    let scanned = 0;
    let failed = 0;
    let batches = 0;
    let lastId: Types.ObjectId | undefined;
    let status = 'completed';

    try {
      while (Date.now() < deadline && scanned < settings.maxItemsPerRun) {
        const remaining = settings.maxItemsPerRun - scanned;
        const filter = {
          is_active: true,
          last_known_status: { $ne: DeviceConnectionStatus.OFFLINE },
          ...(lastId ? { _id: { $gt: lastId } } : {}),
        };
        const candidates = await this.deviceModel
          .find(filter)
          .sort({ _id: 1 })
          .limit(Math.min(settings.batchSize, remaining))
          .exec();

        if (!candidates.length) break;
        batches += 1;
        scanned += candidates.length;

        await mapWithConcurrency(
          candidates,
          settings.externalConcurrency,
          async (device) => {
            const result = await this.processOfflineCandidate(device, deadline);
            if (result === 'transitioned') transitioned += 1;
            if (result === 'failed') {
              failed += 1;
            }
          },
        );

        lastId = candidates.at(-1)!._id;
        if (candidates.length < settings.batchSize) break;
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
          jobName: 'device-offline-sweep',
          runId,
          instanceId:
            this.schedulerLockService?.getInstanceId() ?? 'local-test',
          status,
          lockAcquired: Boolean(lock),
          scanned,
          processed: transitioned,
          succeeded: transitioned,
          failed,
          skipped: Math.max(0, scanned - transitioned - failed),
          batches,
          durationMs: Date.now() - startedAt,
        }),
      );

      return { processed: transitioned, details: { scanned, failed, batches } };
    } finally {
      if (lock) {
        await this.schedulerLockService?.release(lock, status);
      }
    }
  }

  private async processOfflineCandidate(
    device: DeviceDocument,
    deadline: number,
  ): Promise<OfflineCandidateResult> {
    if (Date.now() >= deadline) return 'skipped';

    try {
      if (this.liveStatusService.isOnline(device)) return 'skipped';

      const flipped = await this.markDeviceOffline(device);
      if (!flipped) return 'skipped';

      this.emitOfflineTransition(flipped);
      await this.createOfflineNotification(flipped);
      return 'transitioned';
    } catch (error) {
      this.logger.warn(
        `Failed to process device offline candidate ${String(
          device._id,
        )}: ${String(error)}`,
      );
      return 'failed';
    }
  }

  private markDeviceOffline(device: DeviceDocument) {
    return this.deviceModel
      .findOneAndUpdate(
        {
          _id: device._id,
          last_known_status: { $ne: DeviceConnectionStatus.OFFLINE },
        },
        {
          $set: { last_known_status: DeviceConnectionStatus.OFFLINE },
        },
        { new: true },
      )
      .exec();
  }

  private emitOfflineTransition(device: DeviceDocument): void {
    this.liveMonitoringGateway.emitStatusChange(String(device.machine_id), {
      deviceId: device.device_id,
      status: DeviceConnectionStatus.OFFLINE,
      lastSeenAt: device.last_seen_at?.toISOString() ?? null,
    });
  }

  private async createOfflineNotification(
    device: DeviceDocument,
  ): Promise<void> {
    const machineId = String(device.machine_id);
    await this.notificationCenterService
      .createIfNotExists({
        dedupeKey: `device_offline:${device._id.toString()}:${
          device.last_seen_at?.getTime() ?? 0
        }`,
        type: NotificationType.DEVICE_OFFLINE,
        title: `Device ${device.device_id} went offline`,
        machineId,
        referenceId: String(device._id),
        recipientRole: Role.ADMIN,
      })
      .catch((error) => {
        this.logger.warn(
          `Failed to create device-offline notification: ${String(error)}`,
        );
      });
  }
}
