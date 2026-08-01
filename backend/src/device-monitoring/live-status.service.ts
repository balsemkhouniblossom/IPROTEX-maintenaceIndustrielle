import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Device, DeviceDocument } from '../schemas/device.schema';
import { Telemetry, TelemetryDocument } from '../schemas/telemetry.schema';
import { FaultEvent, FaultEventDocument } from '../schemas/fault-event.schema';

/** A device is considered offline once it has missed this many heartbeat intervals. */
const OFFLINE_MULTIPLIER = 3;

export interface MachineLiveStatus {
  machineId: string;
  hasDevice: boolean;
  online: boolean;
  lastSeenAt: Date | null;
  device: { deviceId: string; deviceType: string; label?: string } | null;
  activeAlarmCount: number;
  latestTelemetry: { metrics: Record<string, number>; recordedAt: Date } | null;
}

@Injectable()
export class LiveStatusService {
  constructor(
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>,
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
    @InjectModel(FaultEvent.name)
    private readonly faultEventModel: Model<FaultEventDocument>,
  ) {}

  isOnline(
    device: Pick<
      Device,
      'is_active' | 'last_seen_at' | 'heartbeat_interval_seconds'
    >,
  ): boolean {
    if (!device.is_active || !device.last_seen_at) return false;
    const thresholdMs =
      device.heartbeat_interval_seconds * OFFLINE_MULTIPLIER * 1000;
    return Date.now() - device.last_seen_at.getTime() < thresholdMs;
  }

  async getMachineLiveStatus(machineId: string): Promise<MachineLiveStatus> {
    const device = await this.deviceModel
      .findOne({ machine_id: machineId })
      .exec();

    if (!device) {
      return {
        machineId,
        hasDevice: false,
        online: false,
        lastSeenAt: null,
        device: null,
        activeAlarmCount: 0,
        latestTelemetry: null,
      };
    }

    const [activeAlarmCount, latestTelemetry] = await Promise.all([
      this.faultEventModel
        .countDocuments({
          machine_id: machineId,
          resolved_at: { $exists: false },
        })
        .exec(),
      this.telemetryModel
        .findOne({ machine_id: machineId })
        .sort({ received_at: -1 })
        .exec(),
    ]);

    return {
      machineId,
      hasDevice: true,
      online: this.isOnline(device),
      lastSeenAt: device.last_seen_at ?? null,
      device: {
        deviceId: device.device_id,
        deviceType: device.device_type,
        label: device.label,
      },
      activeAlarmCount,
      latestTelemetry: latestTelemetry
        ? {
            metrics: latestTelemetry.metrics,
            recordedAt: latestTelemetry.recorded_at,
          }
        : null,
    };
  }

  /**
   * Bulk summary for a dashboard list. `machineIds === null` means
   * unrestricted (Admin); otherwise only devices on an accessible machine
   * are considered — machines with no device simply don't appear, so a
   * caller can tell "no live data" from "not permitted" without a 403 per
   * row.
   */
  async getMachinesLiveSummary(
    machineIds: Types.ObjectId[] | null,
  ): Promise<Array<Omit<MachineLiveStatus, 'latestTelemetry'>>> {
    const deviceQuery: Record<string, unknown> =
      machineIds === null ? {} : { machine_id: { $in: machineIds } };
    const devices = await this.deviceModel.find(deviceQuery).exec();
    if (devices.length === 0) return [];

    const deviceMachineIds = devices.map((d) => d.machine_id);
    const activeAlarmCounts = await this.faultEventModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      {
        $match: {
          machine_id: { $in: deviceMachineIds },
          resolved_at: { $exists: false },
        },
      },
      { $group: { _id: '$machine_id', count: { $sum: 1 } } },
    ]);
    const alarmCountByMachine = new Map(
      activeAlarmCounts.map((entry) => [entry._id.toString(), entry.count]),
    );

    return devices.map((device) => ({
      machineId: device.machine_id.toString(),
      hasDevice: true,
      online: this.isOnline(device),
      lastSeenAt: device.last_seen_at ?? null,
      device: {
        deviceId: device.device_id,
        deviceType: device.device_type,
        label: device.label,
      },
      activeAlarmCount:
        alarmCountByMachine.get(device.machine_id.toString()) ?? 0,
    }));
  }
}
