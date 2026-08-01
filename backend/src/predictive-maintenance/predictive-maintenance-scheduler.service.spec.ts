import { Types } from 'mongoose';
import { PredictiveMaintenanceSchedulerService } from './predictive-maintenance-scheduler.service';
import { PredictionModelType } from './prediction-model.interface';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('PredictiveMaintenanceSchedulerService', () => {
  let configService: { get: jest.Mock };
  let machineModel: { find: jest.Mock };
  let trainingService: { trainAllMissing: jest.Mock };
  let predictiveMaintenanceService: { runPredictionForMachine: jest.Mock };

  function buildService() {
    return new PredictiveMaintenanceSchedulerService(
      configService as never,
      machineModel as never,
      trainingService as never,
      predictiveMaintenanceService as never,
    );
  }

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(undefined) };
    machineModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(execResolves([])),
      }),
    };
    trainingService = { trainAllMissing: jest.fn().mockResolvedValue([]) };
    predictiveMaintenanceService = {
      runPredictionForMachine: jest.fn().mockResolvedValue([]),
    };
  });

  it('bootstraps missing model versions before sweeping machines', async () => {
    trainingService.trainAllMissing.mockResolvedValue([
      PredictionModelType.ZSCORE,
    ]);
    const service = buildService();

    await service.runSweep();

    expect(trainingService.trainAllMissing).toHaveBeenCalled();
  });

  it('runs a prediction for every machine and reports how many were processed', async () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    machineModel.find = jest.fn().mockReturnValue({
      select: jest
        .fn()
        .mockReturnValue(execResolves(ids.map((_id) => ({ _id })))),
    });
    const service = buildService();

    const result = await service.runSweep();

    expect(result.processed).toBe(2);
    expect(
      predictiveMaintenanceService.runPredictionForMachine,
    ).toHaveBeenCalledTimes(2);
  });

  it('continues sweeping remaining machines when one machine fails', async () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    machineModel.find = jest.fn().mockReturnValue({
      select: jest
        .fn()
        .mockReturnValue(execResolves(ids.map((_id) => ({ _id })))),
    });
    predictiveMaintenanceService.runPredictionForMachine = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([]);
    const service = buildService();

    const result = await service.runSweep();

    expect(result.processed).toBe(1);
    expect(
      predictiveMaintenanceService.runPredictionForMachine,
    ).toHaveBeenCalledTimes(2);
  });

  it('skips the sweep entirely when disabled via configuration', async () => {
    configService.get = jest.fn().mockReturnValue('false');
    const service = buildService();

    const result = await service.runSweep();

    expect(result.processed).toBe(0);
    expect(trainingService.trainAllMissing).not.toHaveBeenCalled();
    expect(machineModel.find).not.toHaveBeenCalled();
  });
});
