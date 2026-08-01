import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

interface JobResult {
  processed: number;
  details?: Record<string, unknown>;
}

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
  ) {}

  @Cron('*/1 * * * *', { name: 'device-offline-sweep' })
  async sweep(): Promise<JobResult> {
    return this.runSweep();
  }

  async runSweep(): Promise<JobResult> {
    const candidates = await this.deviceModel
      .find({
        is_active: true,
        last_known_status: { $ne: DeviceConnectionStatus.OFFLINE },
      })
      .exec();

    let transitioned = 0;
    for (const device of candidates) {
      if (this.liveStatusService.isOnline(device)) continue;

      const flipped = await this.deviceModel
        .findOneAndUpdate(
          {
            _id: device._id,
            last_known_status: { $ne: DeviceConnectionStatus.OFFLINE },
          },
          { $set: { last_known_status: DeviceConnectionStatus.OFFLINE } },
          { new: true },
        )
        .exec();
      if (!flipped) continue;

      transitioned += 1;
      const machineId = String(flipped.machine_id);

      this.liveMonitoringGateway.emitStatusChange(machineId, {
        deviceId: flipped.device_id,
        status: DeviceConnectionStatus.OFFLINE,
        lastSeenAt: flipped.last_seen_at?.toISOString() ?? null,
      });

      await this.notificationCenterService
        .createIfNotExists({
          dedupeKey: `device_offline:${flipped._id.toString()}:${flipped.last_seen_at?.getTime() ?? 0}`,
          type: NotificationType.DEVICE_OFFLINE,
          title: `Device ${flipped.device_id} went offline`,
          machineId,
          referenceId: String(flipped._id),
          recipientRole: Role.ADMIN,
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to create device-offline notification: ${String(error)}`,
          );
        });
    }

    return { processed: transitioned, details: { scanned: candidates.length } };
  }
}
