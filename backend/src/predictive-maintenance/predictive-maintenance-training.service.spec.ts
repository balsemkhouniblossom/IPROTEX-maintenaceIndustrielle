import { NotFoundException } from '@nestjs/common';
import { PredictiveMaintenanceTrainingService } from './predictive-maintenance-training.service';
import { PredictionModelVersionStatus } from '../schemas/prediction-model-version.schema';
import { PredictionModelType } from './prediction-model.interface';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

function fakeModel(
  type: PredictionModelType,
  artifactOverrides: Record<string, unknown> = {},
) {
  return {
    type,
    displayName: type,
    train: jest.fn().mockReturnValue({
      featureNames: ['a', 'b'],
      trainingSampleCount: 5,
      randomSeed: 1,
      trainedAt: new Date('2026-07-01T00:00:00.000Z').toISOString(),
      ...artifactOverrides,
    }),
    score: jest.fn(),
  };
}

describe('PredictiveMaintenanceTrainingService', () => {
  let modelVersionModel: {
    findOne: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
    exists: jest.Mock;
    find: jest.Mock;
  };
  let trainingSampleService: { buildTrainingSamples: jest.Mock };

  beforeEach(() => {
    modelVersionModel = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue(execResolves(null)),
      }),
      updateMany: jest.fn().mockReturnValue(execResolves(undefined)),
      create: jest
        .fn()
        .mockImplementation((doc) => Promise.resolve({ ...doc, _id: 'v1' })),
      exists: jest.fn().mockReturnValue(execResolves(false)),
      find: jest
        .fn()
        .mockReturnValue({ sort: jest.fn().mockReturnValue(execResolves([])) }),
    };
    trainingSampleService = {
      buildTrainingSamples: jest.fn().mockResolvedValue([]),
    };
  });

  it('trains version 1 when no prior version exists for that model type', async () => {
    const zScore = fakeModel(PredictionModelType.ZSCORE);
    const service = new PredictiveMaintenanceTrainingService(
      modelVersionModel as never,
      [zScore] as never,
      trainingSampleService as never,
    );

    const result = await service.trainModel(PredictionModelType.ZSCORE, {
      randomSeed: 42,
    });

    expect(zScore.train).toHaveBeenCalledWith([], 42);
    expect(result.version).toBe(1);
    expect(result.status).toBe(PredictionModelVersionStatus.ACTIVE);
    expect(modelVersionModel.updateMany).toHaveBeenCalledWith(
      {
        model_type: PredictionModelType.ZSCORE,
        status: PredictionModelVersionStatus.ACTIVE,
      },
      { $set: { status: PredictionModelVersionStatus.ARCHIVED } },
    );
  });

  it('increments the version number and archives the previous active version', async () => {
    modelVersionModel.findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue(execResolves({ version: 3 })),
    });
    const zScore = fakeModel(PredictionModelType.ZSCORE);
    const service = new PredictiveMaintenanceTrainingService(
      modelVersionModel as never,
      [zScore] as never,
      trainingSampleService as never,
    );

    const result = await service.trainModel(PredictionModelType.ZSCORE);
    expect(result.version).toBe(4);
  });

  it('throws NotFoundException for a model type with no registered implementation', async () => {
    const service = new PredictiveMaintenanceTrainingService(
      modelVersionModel as never,
      [] as never,
      trainingSampleService as never,
    );

    await expect(
      service.trainModel(PredictionModelType.DBSCAN),
    ).rejects.toThrow(NotFoundException);
  });

  it('trainAllMissing only trains model types without an active version', async () => {
    const zScore = fakeModel(PredictionModelType.ZSCORE);
    const dbscan = fakeModel(PredictionModelType.DBSCAN);
    modelVersionModel.exists = jest
      .fn()
      .mockImplementation(({ model_type }) =>
        execResolves(model_type === PredictionModelType.ZSCORE),
      );

    const service = new PredictiveMaintenanceTrainingService(
      modelVersionModel as never,
      [zScore, dbscan] as never,
      trainingSampleService as never,
    );

    const trained = await service.trainAllMissing();

    expect(trained).toEqual([PredictionModelType.DBSCAN]);
    expect(zScore.train).not.toHaveBeenCalled();
    expect(dbscan.train).toHaveBeenCalled();
  });

  it('listVersions filters by model type when given', async () => {
    const service = new PredictiveMaintenanceTrainingService(
      modelVersionModel as never,
      [] as never,
      trainingSampleService as never,
    );

    await service.listVersions(PredictionModelType.AUTOENCODER);
    expect(modelVersionModel.find).toHaveBeenCalledWith({
      model_type: PredictionModelType.AUTOENCODER,
    });

    await service.listVersions();
    expect(modelVersionModel.find).toHaveBeenCalledWith({});
  });
});
