import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import {
  DocumentAccessService,
  type DocumentActor,
} from '../documents/document-access.service';
import { ResolveFaultDto } from './dto/resolve-fault.dto';

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
    private readonly documentAccessService: DocumentAccessService,
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
    actor: DocumentActor,
    dto: ResolveFaultDto = {},
  ): Promise<FaultEventDocument> {
    const startedAt = Date.now();
    const userId = actor.userId;

    try {
      if (!Types.ObjectId.isValid(faultId)) {
        throw new BadRequestException('Invalid fault_id');
      }

      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new BadRequestException('Invalid resolved_by');
      }

      const existing = await this.faultEventModel
        .findById(faultId)
        .select({ machine_id: 1 })
        .exec();
      if (!existing) {
        throw new NotFoundException('Fault event not found');
      }

      await this.documentAccessService.assertCanAccessMachine(
        actor,
        String(existing.machine_id),
      );

      const $set: Record<string, unknown> = {
        resolved_at: new Date(),
        resolved_by: new Types.ObjectId(userId),
      };
      if (dto.resolution_note) {
        $set.resolution_note = dto.resolution_note;
      }

      const updated = await this.faultEventModel
        .findOneAndUpdate(
          { _id: faultId, resolved_at: { $exists: false } },
          { $set },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new ConflictException(
          'This fault event has already been resolved',
        );
      }

      this.logResolveAttempt(faultId, userId, 'resolved', startedAt);
      return updated;
    } catch (error) {
      this.logResolveAttempt(
        faultId,
        userId,
        this.statusFromError(error),
        startedAt,
      );
      throw error;
    }
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

  private logResolveAttempt(
    faultId: string,
    actorId: string | undefined,
    result: string,
    startedAt: number,
  ): void {
    this.logger.log({
      event: 'fault_resolution_attempt',
      faultId,
      actorId,
      result,
      durationMs: Date.now() - startedAt,
    });
  }

  private statusFromError(error: unknown): string {
    if (error instanceof HttpException) {
      return String(error.getStatus());
    }
    return 'error';
  }
}
