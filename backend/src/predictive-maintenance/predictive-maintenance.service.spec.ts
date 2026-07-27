import { Types } from 'mongoose';
import { PredictiveMaintenanceService } from './predictive-maintenance.service';
import { PredictionRiskLevel } from '../schemas/machine-health-prediction.schema';
import { PredictionModelVersionStatus } from '../schemas/prediction-model-version.schema';
import { FEATURE_NAMES, PredictionModelType } from './prediction-model.interface';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

function zeroFeatures(overrides: Partial<Record<(typeof FEATURE_NAMES)[number], number>> = {}) {
  return FEATURE_NAMES.map((name) => overrides[name] ?? 0);
}

describe('PredictiveMaintenanceService', () => {
  const machineId = new Types.ObjectId().toString();
  const actor = { userId: new Types.ObjectId().toString(), role: 'technician' };

  let predictionModel: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let modelVersionModel: { find: jest.Mock };
  let machineModel: { find: jest.Mock };
  let moduleModel: { find: jest.Mock };
  let maintenancePlanModel: { find: jest.Mock };
  let featureExtractionService: { buildFeatureVector: jest.Mock };
  let documentAccessService: { assertCanAccessMachine: jest.Mock; listAccessibleMachineIds: jest.Mock };

  function buildService(models: Array<{ type: PredictionModelType; displayName: string; score: jest.Mock }>) {
    return new PredictiveMaintenanceService(
      predictionModel as never,
      modelVersionModel as never,
      machineModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
      models as never,
      featureExtractionService as never,
      documentAccessService as never,
    );
  }

  beforeEach(() => {
    predictionModel = {
      create: jest.fn().mockImplementation((doc) => Promise.resolve({ ...doc, _id: new Types.ObjectId() })),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue(execResolves(null)) }),
    };
    modelVersionModel = { find: jest.fn().mockReturnValue(execResolves([])) };
    machineModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves([])) }),
    };
    moduleModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves([])) }),
    };
    maintenancePlanModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves([])) }),
    };
    featureExtractionService = {
      buildFeatureVector: jest
        .fn()
        .mockResolvedValue({ features: zeroFeatures(), measuredFacts: ['fact one'], isEmpty: false }),
    };
    documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
    };
  });

  describe('runPredictionForMachine', () => {
    it('scores and persists one prediction per active model version', async () => {
      const zScore = {
        type: PredictionModelType.ZSCORE,
        displayName: 'Z-Score',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.1, confidence: 0.9, modelNotes: ['note'] }),
      };
      const isoForest = {
        type: PredictionModelType.ISOLATION_FOREST,
        displayName: 'Isolation Forest',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.2, confidence: 0.8, modelNotes: ['note2'] }),
      };
      modelVersionModel.find = jest.fn().mockReturnValue(
        execResolves([
          { _id: 'v1', model_type: PredictionModelType.ZSCORE, version: 1, training_sample_count: 10, artifact: {} },
          {
            _id: 'v2',
            model_type: PredictionModelType.ISOLATION_FOREST,
            version: 1,
            training_sample_count: 10,
            artifact: {},
          },
        ]),
      );
      const service = buildService([zScore, isoForest]);

      const results = await service.runPredictionForMachine(machineId, new Date('2026-07-01'));

      expect(results).toHaveLength(2);
      expect(predictionModel.create).toHaveBeenCalledTimes(2);
      expect(zScore.score).toHaveBeenCalled();
      expect(isoForest.score).toHaveBeenCalled();
    });

    it('derives health_score as 100 * (1 - anomalyScore)', async () => {
      const model = {
        type: PredictionModelType.ZSCORE,
        displayName: 'Z-Score',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.3, confidence: 1, modelNotes: [] }),
      };
      modelVersionModel.find = jest.fn().mockReturnValue(
        execResolves([{ _id: 'v1', model_type: PredictionModelType.ZSCORE, version: 1, training_sample_count: 10, artifact: {} }]),
      );
      const service = buildService([model]);

      await service.runPredictionForMachine(machineId);

      const [created] = predictionModel.create.mock.calls[0];
      expect(created.health_score).toBeCloseTo(70, 5);
      expect(created.anomaly_score).toBe(0.3);
    });

    it('separates measured facts, model output notes, and uncertainty notes in the explanation', async () => {
      const model = {
        type: PredictionModelType.ZSCORE,
        displayName: 'Z-Score',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.1, confidence: 0.2, modelNotes: ['model said X'] }),
      };
      modelVersionModel.find = jest.fn().mockReturnValue(
        execResolves([{ _id: 'v1', model_type: PredictionModelType.ZSCORE, version: 1, training_sample_count: 3, artifact: {} }]),
      );
      const service = buildService([model]);

      await service.runPredictionForMachine(machineId);

      const [created] = predictionModel.create.mock.calls[0];
      expect(created.explanation.measuredFacts).toEqual(['fact one']);
      expect(created.explanation.modelOutputNotes.some((n: string) => n.includes('model said X'))).toBe(true);
      expect(
        created.explanation.uncertaintyNotes.some((n: string) => n.toLowerCase().includes('advisory')),
      ).toBe(true);
      // Low confidence (0.2) with few training samples (3) must be called out explicitly.
      expect(created.explanation.uncertaintyNotes.some((n: string) => n.includes('low'))).toBe(true);
    });

    it('marks risk CRITICAL whenever a critical alarm is active, regardless of anomaly score', async () => {
      featureExtractionService.buildFeatureVector.mockResolvedValue({
        features: zeroFeatures({ critical_alarm_count: 1 }),
        measuredFacts: [],
      });
      const model = {
        type: PredictionModelType.ZSCORE,
        displayName: 'Z-Score',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.01, confidence: 1, modelNotes: [] }),
      };
      modelVersionModel.find = jest.fn().mockReturnValue(
        execResolves([{ _id: 'v1', model_type: PredictionModelType.ZSCORE, version: 1, training_sample_count: 10, artifact: {} }]),
      );
      const service = buildService([model]);

      await service.runPredictionForMachine(machineId);

      const [created] = predictionModel.create.mock.calls[0];
      expect(created.risk_level).toBe(PredictionRiskLevel.CRITICAL);
    });

    it('marks risk LOW when nothing stands out', async () => {
      const model = {
        type: PredictionModelType.ZSCORE,
        displayName: 'Z-Score',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.05, confidence: 1, modelNotes: [] }),
      };
      modelVersionModel.find = jest.fn().mockReturnValue(
        execResolves([{ _id: 'v1', model_type: PredictionModelType.ZSCORE, version: 1, training_sample_count: 10, artifact: {} }]),
      );
      const service = buildService([model]);

      await service.runPredictionForMachine(machineId);

      const [created] = predictionModel.create.mock.calls[0];
      expect(created.risk_level).toBe(PredictionRiskLevel.LOW);
    });

    it('marks risk INSUFFICIENT_DATA when the feature vector has no measurable data, even though the model itself would have scored it as healthy — while still persisting health_score/anomaly_score/confidence for audit purposes', async () => {
      featureExtractionService.buildFeatureVector.mockResolvedValue({
        features: zeroFeatures(),
        measuredFacts: ['0 telemetry readings in the last 7 days.'],
        isEmpty: true,
      });
      const model = {
        type: PredictionModelType.ZSCORE,
        displayName: 'Z-Score',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.05, confidence: 0.9, modelNotes: [] }),
      };
      modelVersionModel.find = jest.fn().mockReturnValue(
        execResolves([{ _id: 'v1', model_type: PredictionModelType.ZSCORE, version: 1, training_sample_count: 10, artifact: {} }]),
      );
      const service = buildService([model]);

      await service.runPredictionForMachine(machineId);

      const [created] = predictionModel.create.mock.calls[0];
      expect(created.risk_level).toBe(PredictionRiskLevel.INSUFFICIENT_DATA);
      expect(created.health_score).toBeCloseTo(95, 5);
      expect(created.anomaly_score).toBe(0.05);
      expect(created.confidence).toBe(0.9);
      expect(
        created.explanation.uncertaintyNotes.some((n: string) => n.toLowerCase().includes('no telemetry')),
      ).toBe(true);
    });

    it('marks risk normally (not INSUFFICIENT_DATA) when the feature vector has real data, even if every count happens to be low', async () => {
      featureExtractionService.buildFeatureVector.mockResolvedValue({
        features: zeroFeatures({ telemetry_sample_count: 1 }),
        measuredFacts: ['1 telemetry reading in the last 7 days.'],
        isEmpty: false,
      });
      const model = {
        type: PredictionModelType.ZSCORE,
        displayName: 'Z-Score',
        score: jest.fn().mockReturnValue({ anomalyScore: 0.05, confidence: 0.9, modelNotes: [] }),
      };
      modelVersionModel.find = jest.fn().mockReturnValue(
        execResolves([{ _id: 'v1', model_type: PredictionModelType.ZSCORE, version: 1, training_sample_count: 10, artifact: {} }]),
      );
      const service = buildService([model]);

      await service.runPredictionForMachine(machineId);

      const [created] = predictionModel.create.mock.calls[0];
      expect(created.risk_level).toBe(PredictionRiskLevel.LOW);
    });
  });

  describe('role scoping', () => {
    it('predictForMachine asserts machine access before running predictions', async () => {
      const service = buildService([]);
      await service.predictForMachine(machineId, actor);

      expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
        { userId: actor.userId, role: actor.role },
        machineId,
      );
    });

    it('getLatestPredictions and getHistory both assert machine access', async () => {
      const service = buildService([]);
      await service.getLatestPredictions(machineId, actor);
      await service.getHistory(machineId, actor);

      expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledTimes(2);
    });

    it('getFleetSummary scopes to the caller accessible machine ids (non-Admin)', async () => {
      const accessibleId = new Types.ObjectId();
      documentAccessService.listAccessibleMachineIds.mockResolvedValue([accessibleId]);
      const service = buildService([]);

      await service.getFleetSummary(actor);

      expect(machineModel.find).toHaveBeenCalledWith({ _id: { $in: [accessibleId] } });
    });

    it('getFleetSummary is unrestricted for Admin (listAccessibleMachineIds returns null)', async () => {
      documentAccessService.listAccessibleMachineIds.mockResolvedValue(null);
      const service = buildService([]);

      await service.getFleetSummary(actor);

      expect(machineModel.find).toHaveBeenCalledWith({});
    });
  });

  describe('getFleetSummary aggregation', () => {
    it('returns nothing for a machine with no stored predictions yet', async () => {
      machineModel.find = jest
        .fn()
        .mockReturnValue({ select: jest.fn().mockReturnValue(execResolves([{ _id: new Types.ObjectId(machineId) }])) });
      predictionModel.findOne = jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue(execResolves(null)) });
      const service = buildService([{ type: PredictionModelType.ZSCORE, displayName: 'Z', score: jest.fn() }]);

      const summaries = await service.getFleetSummary(actor);
      expect(summaries).toEqual([]);
    });

    it('averages health/confidence and takes the worst risk level across model types for one machine', async () => {
      machineModel.find = jest
        .fn()
        .mockReturnValue({ select: jest.fn().mockReturnValue(execResolves([{ _id: new Types.ObjectId(machineId) }])) });

      const latestByType: Record<string, unknown> = {
        [PredictionModelType.ZSCORE]: {
          health_score: 80,
          confidence: 0.5,
          risk_level: PredictionRiskLevel.LOW,
          generated_at: new Date('2026-07-01'),
        },
        [PredictionModelType.ISOLATION_FOREST]: {
          health_score: 40,
          confidence: 0.9,
          risk_level: PredictionRiskLevel.HIGH,
          generated_at: new Date('2026-07-02'),
        },
      };
      predictionModel.findOne = jest.fn().mockImplementation(({ model_type }) => ({
        sort: jest.fn().mockReturnValue(execResolves(latestByType[model_type] ?? null)),
      }));

      const service = buildService([
        { type: PredictionModelType.ZSCORE, displayName: 'Z', score: jest.fn() },
        { type: PredictionModelType.ISOLATION_FOREST, displayName: 'IF', score: jest.fn() },
      ]);

      const [summary] = await service.getFleetSummary(actor);

      expect(summary.healthScore).toBeCloseTo(60, 5);
      expect(summary.riskLevel).toBe(PredictionRiskLevel.HIGH);
      expect(summary.modelCount).toBe(2);
      expect(summary.generatedAt).toEqual(new Date('2026-07-02'));
    });

    it('treats INSUFFICIENT_DATA as the dominant risk level across model types, even over CRITICAL', async () => {
      machineModel.find = jest
        .fn()
        .mockReturnValue({ select: jest.fn().mockReturnValue(execResolves([{ _id: new Types.ObjectId(machineId) }])) });

      const latestByType: Record<string, unknown> = {
        [PredictionModelType.ZSCORE]: {
          health_score: 20,
          confidence: 0.5,
          risk_level: PredictionRiskLevel.CRITICAL,
          generated_at: new Date('2026-07-01'),
        },
        [PredictionModelType.ISOLATION_FOREST]: {
          health_score: 95,
          confidence: 0.9,
          risk_level: PredictionRiskLevel.INSUFFICIENT_DATA,
          generated_at: new Date('2026-07-02'),
        },
      };
      predictionModel.findOne = jest.fn().mockImplementation(({ model_type }) => ({
        sort: jest.fn().mockReturnValue(execResolves(latestByType[model_type] ?? null)),
      }));

      const service = buildService([
        { type: PredictionModelType.ZSCORE, displayName: 'Z', score: jest.fn() },
        { type: PredictionModelType.ISOLATION_FOREST, displayName: 'IF', score: jest.fn() },
      ]);

      const [summary] = await service.getFleetSummary(actor);

      expect(summary.riskLevel).toBe(PredictionRiskLevel.INSUFFICIENT_DATA);
    });
  });

  describe('getPlanHealthSummaries', () => {
    it('resolves each accessible plan to its machine via module_id and attaches a health summary', async () => {
      const resolvedMachineId = new Types.ObjectId();
      const moduleId = new Types.ObjectId();
      const planId = new Types.ObjectId();

      moduleModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(execResolves([{ _id: moduleId, machine_id: resolvedMachineId }])),
      });
      maintenancePlanModel.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(execResolves([{ _id: planId, module_id: moduleId }])),
      });
      machineModel.find = jest
        .fn()
        .mockReturnValue({ select: jest.fn().mockReturnValue(execResolves([{ _id: resolvedMachineId }])) });
      predictionModel.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue(
          execResolves({
            health_score: 90,
            confidence: 1,
            risk_level: PredictionRiskLevel.LOW,
            generated_at: new Date('2026-07-01'),
          }),
        ),
      });

      const service = buildService([{ type: PredictionModelType.ZSCORE, displayName: 'Z', score: jest.fn() }]);
      const summaries = await service.getPlanHealthSummaries(actor);

      expect(summaries[planId.toString()]).toBeDefined();
      expect(summaries[planId.toString()].machineId).toBe(resolvedMachineId.toString());
      expect(summaries[planId.toString()].healthScore).toBe(90);
    });

    it('returns an empty object when there are no accessible modules', async () => {
      const service = buildService([]);
      const summaries = await service.getPlanHealthSummaries(actor);
      expect(summaries).toEqual({});
    });
  });
});
