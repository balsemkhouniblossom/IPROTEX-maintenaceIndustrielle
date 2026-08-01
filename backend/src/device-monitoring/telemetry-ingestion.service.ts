import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Device,
  DeviceConnectionStatus,
  DeviceDocument,
} from '../schemas/device.schema';
import { Telemetry, TelemetryDocument } from '../schemas/telemetry.schema';
import {
  FaultEvent,
  FaultEventDocument,
  FaultEventSeverity,
} from '../schemas/fault-event.schema';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import { Role } from '../schemas/user.schema';

export interface TelemetryPayload {
  metrics: Record<string, number>;
  recordedAt?: Date;
}

export interface FaultPayload {
  codePanne: string;
  severity?: FaultEventSeverity;
  message?: string;
  raisedAt?: Date;
}

export interface IngestResult<T> {
  record: T;
  /** True the instant this event brought the device from offline/unknown back online. */
  cameOnline: boolean;
}

/**
 * The single ingestion pipeline shared by every device-facing transport
 * (REST `/device-gateway/*`, the MQTT bridge, the device side of the
 * WebSocket gateway) — whichever transport a device uses, a heartbeat,
 * telemetry sample, or fault event is recorded identically and updates the
 * same liveness state.
 *
 * Deliberately has no dependency on `LiveMonitoringGateway`: the gateway
 * would need to depend on this service too (to persist what arrives over
 * `device:*` WebSocket events), and a two-way dependency between them would
 * be a circular one. Instead this service only persists and reports what
 * changed; each transport's own entry point (the REST controller, the MQTT
 * service, the gateway's own WS handler) decides how/whether to push a
 * live update, using its own reference to the gateway.
 */
@Injectable()
export class TelemetryIngestionService {
  private readonly logger = new Logger(TelemetryIngestionService.name);

  constructor(
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>,
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
    @InjectModel(FaultEvent.name)
    private readonly faultEventModel: Model<FaultEventDocument>,
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  async recordHeartbeat(
    device: DeviceDocument,
  ): Promise<{ cameOnline: boolean }> {
    const cameOnline =
      device.last_known_status !== DeviceConnectionStatus.ONLINE;
    await this.markSeenAndOnline(device);
    return { cameOnline };
  }

  async recordTelemetry(
    device: DeviceDocument,
    payload: TelemetryPayload,
  ): Promise<IngestResult<TelemetryDocument>> {
    if (!payload.metrics || typeof payload.metrics !== 'object') {
      throw new BadRequestException('metrics is required');
    }

    const cameOnline =
      device.last_known_status !== DeviceConnectionStatus.ONLINE;
    const recordedAt = payload.recordedAt ?? new Date();

    const [record] = await Promise.all([
      this.telemetryModel.create({
        device_id: device._id,
        machine_id: device.machine_id,
        metrics: payload.metrics,
        recorded_at: recordedAt,
      }),
      this.markSeenAndOnline(device),
    ]);

    return { record, cameOnline };
  }

  async recordFault(
    device: DeviceDocument,
    payload: FaultPayload,
  ): Promise<IngestResult<FaultEventDocument>> {
    if (!payload.codePanne || typeof payload.codePanne !== 'string') {
      throw new BadRequestException('code_panne is required');
    }

    const cameOnline =
      device.last_known_status !== DeviceConnectionStatus.ONLINE;
    const raisedAt = payload.raisedAt ?? new Date();
    const severity = payload.severity ?? FaultEventSeverity.WARNING;

    const [record] = await Promise.all([
      this.faultEventModel.create({
        device_id: device._id,
        machine_id: device.machine_id,
        code_panne: payload.codePanne,
        severity,
        message: payload.message,
        raised_at: raisedAt,
      }),
      this.markSeenAndOnline(device),
    ]);

    if (severity === FaultEventSeverity.CRITICAL) {
      await this.notificationCenterService
        .createIfNotExists({
          dedupeKey: `device_fault:${device._id.toString()}:${payload.codePanne}:${raisedAt.getTime()}`,
          type: NotificationType.DEVICE_FAULT,
          title: `Critical fault ${payload.codePanne} reported by device ${device.device_id}`,
          message: payload.message,
          machineId: String(device.machine_id),
          referenceId: String(record._id),
          recipientRole: Role.ADMIN,
        })
        .catch((error) => {
          this.logger.warn(
            `Failed to create device-fault notification: ${String(error)}`,
          );
        });
    }

    return { record, cameOnline };
  }

  async resolveFault(
    faultId: string,
    resolvedByUserId: string,
  ): Promise<FaultEventDocument> {
    const existing = await this.faultEventModel.findById(faultId).exec();
    if (!existing) {
      throw new NotFoundException('Fault event not found');
    }
    if (existing.resolved_at) {
      throw new ConflictException('This fault event has already been resolved');
    }

    const updated = await this.faultEventModel
      .findOneAndUpdate(
        { _id: faultId, resolved_at: { $exists: false } },
        { $set: { resolved_at: new Date(), resolved_by: resolvedByUserId } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException('This fault event has already been resolved');
    }
    return updated;
  }

  private async markSeenAndOnline(device: DeviceDocument): Promise<void> {
    const now = new Date();
    await this.deviceModel
      .updateOne(
        { _id: device._id },
        {
          $set: {
            last_seen_at: now,
            last_known_status: DeviceConnectionStatus.ONLINE,
          },
        },
      )
      .exec();
  }
}
