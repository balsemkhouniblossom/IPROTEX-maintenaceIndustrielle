import { Types } from 'mongoose';
import { SensorMeasurementIngestionService } from './sensor-measurement-ingestion.service';

function query(value: unknown) {
  const exec = jest.fn().mockResolvedValue(value);
  const lean = jest.fn().mockReturnValue({ exec });
  const select = jest.fn().mockReturnValue({ lean, exec });
  return { select, lean, exec };
}

describe('SensorMeasurementIngestionService', () => {
  it('persists a bound finite metric with a deterministic identity', async () => {
    const moduleId = new Types.ObjectId();
    const sensorId = new Types.ObjectId();
    const machineId = new Types.ObjectId();
    const moduleQuery = query([{ _id: moduleId }]);
    const sensorQuery = query([
      {
        _id: sensorId,
        capteur_id: 'CURRENT-1',
        mqtt_topic: 'devices/ESP-1/telemetry#current_a',
        seuil_avertissement: 4,
        seuil_critique: 8,
      },
    ]);
    const measurementExec = jest.fn().mockResolvedValue(undefined);
    const sensorUpdateExec = jest.fn().mockResolvedValue(undefined);
    const moduleModel = { find: jest.fn().mockReturnValue(moduleQuery) };
    const sensorModel = {
      find: jest.fn().mockReturnValue(sensorQuery),
      updateOne: jest.fn().mockReturnValue({ exec: sensorUpdateExec }),
    };
    const measurementModel = {
      updateOne: jest.fn().mockReturnValue({ exec: measurementExec }),
    };
    const service = new SensorMeasurementIngestionService(
      moduleModel as never,
      sensorModel as never,
      measurementModel as never,
    );
    const recordedAt = new Date('2026-09-24T10:00:00.000Z');

    await service.project(
      { device_id: 'ESP-1', machine_id: machineId } as never,
      { current_a: 5.25 },
      recordedAt,
    );

    expect(measurementModel.updateOne).toHaveBeenCalledWith(
      { mesure_id: `mqtt:ESP-1:CURRENT-1:${recordedAt.getTime()}` },
      {
        $setOnInsert: {
          mesure_id: `mqtt:ESP-1:CURRENT-1:${recordedAt.getTime()}`,
          capteur_id: sensorId,
          valeur: 5.25,
          timestamp: recordedAt,
          status: 'warning',
        },
      },
      { upsert: true },
    );
  });
});
