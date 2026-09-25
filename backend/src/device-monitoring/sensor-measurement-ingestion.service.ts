import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Capteur, CapteurDocument } from '../schemas/capteur.schema';
import { Mesure, MesureDocument } from '../schemas/mesure.schema';
import { Module, ModuleDocument } from '../schemas/module.schema';
import { DeviceDocument } from '../schemas/device.schema';

/**
 * Projects a combined device telemetry packet into the existing scalar
 * measurement collection. A sensor is bound with the existing mqtt_topic
 * field using `devices/{deviceId}/telemetry#metric_name`.
 */
@Injectable()
export class SensorMeasurementIngestionService {
  private readonly logger = new Logger(SensorMeasurementIngestionService.name);

  constructor(
    @InjectModel(Module.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(Capteur.name)
    private readonly sensorModel: Model<CapteurDocument>,
    @InjectModel(Mesure.name)
    private readonly measurementModel: Model<MesureDocument>,
  ) {}

  async project(
    device: DeviceDocument,
    metrics: Record<string, number>,
    recordedAt: Date,
  ): Promise<void> {
    const modules = await this.moduleModel
      .find({ machine_id: device.machine_id })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (modules.length === 0) return;

    const topicPrefix = `devices/${device.device_id}/telemetry#`;
    const sensors = await this.sensorModel
      .find({
        module_id: { $in: modules.map((module) => module._id) },
        is_active: true,
        mqtt_topic: {
          $in: Object.keys(metrics).map((name) => `${topicPrefix}${name}`),
        },
      })
      .exec();

    await Promise.all(
      sensors.map(async (sensor) => {
        const metricName = sensor.mqtt_topic?.slice(topicPrefix.length);
        if (!metricName) return;
        const value = metrics[metricName];
        if (!Number.isFinite(value)) return;

        const status = this.statusFor(sensor, value);
        const identity = `mqtt:${device.device_id}:${sensor.capteur_id}:${recordedAt.getTime()}`;
        await Promise.all([
          this.measurementModel
            .updateOne(
              { mesure_id: identity },
              {
                $setOnInsert: {
                  mesure_id: identity,
                  capteur_id: sensor._id,
                  valeur: value,
                  timestamp: recordedAt,
                  status,
                },
              },
              { upsert: true },
            )
            .exec(),
          this.sensorModel
            .updateOne(
              { _id: sensor._id },
              { $set: { last_seen_at: new Date() } },
            )
            .exec(),
        ]);
      }),
    ).catch((error) => {
      this.logger.warn(
        `Sensor measurement projection failed: ${String(error)}`,
      );
    });
  }

  private statusFor(sensor: CapteurDocument, value: number): string {
    if (sensor.seuil_critique !== undefined && value >= sensor.seuil_critique)
      return 'critical';
    if (
      sensor.seuil_avertissement !== undefined &&
      value >= sensor.seuil_avertissement
    )
      return 'warning';
    return 'normal';
  }
}
