import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AiAnomalyService } from './ai-anomaly.service';
import {
  AiAnomalyInputSource,
  AiAnomalyValidationStatus,
} from '../schemas/ai-anomaly-analysis.schema';
import { Role } from '../schemas/user.schema';
import { ImsAnomalyFeatureRow } from './ai-anomaly.types';

describe('AiAnomalyService', () => {
  const machineId = new Types.ObjectId().toHexString();
  const capteurId = new Types.ObjectId().toHexString();
  const moduleId = new Types.ObjectId();
  const userId = new Types.ObjectId().toHexString();
  const actor = { userId, role: Role.TECHNICIAN };

  const row = (
    timestamp = '2003-11-15T18:18:46',
    sensor_channel = 1,
  ): ImsAnomalyFeatureRow => ({
    timestamp,
    experiment: '1st_test',
    sensor_channel,
    bearing: 1,
    axis: 'x',
    rms: 0.1,
    standard_deviation: 0.2,
    peak_to_peak: 0.3,
    kurtosis: 0.4,
    skewness: 0.5,
    crest_factor: 0.6,
    spectral_energy: 0.7,
    dominant_frequency_hz: 0.8,
  });

  const result = {
    modelVersion: '0.1.0',
    experiment: '1st_test',
    timestamp: '2003-11-15T18:18:46',
    bearing: 1,
    anomalyScore: 0.43199267712606565,
    riskScore: 43,
    riskLevel: 'MONITOR',
    rawAnomaly: false,
    persistentAlert: false,
    componentScores: { zScore: 0.725, isolationForest: 0.139 },
    reasonCodes: ['ELEVATED_ROLLING_DEVIATION'],
    prototypeResult: true,
  };

  function exec(value: unknown) {
    return { exec: jest.fn().mockResolvedValue(value) };
  }

  function chainFind(items: unknown[]) {
    return {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue(exec(items)),
    };
  }

  function makeSavedDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(),
      analysis_id: 'AI-ANOM-test',
      machine_id: new Types.ObjectId(machineId),
      capteur_id: new Types.ObjectId(capteurId),
      requested_by: new Types.ObjectId(userId),
      model_version: result.modelVersion,
      input_source: AiAnomalyInputSource.DATASET_REPLAY,
      experiment: result.experiment,
      measurement_timestamp: new Date(result.timestamp),
      bearing: result.bearing,
      anomaly_score: result.anomalyScore,
      risk_score: result.riskScore,
      risk_level: result.riskLevel,
      raw_anomaly: result.rawAnomaly,
      persistent_alert: result.persistentAlert,
      component_scores: result.componentScores,
      reason_codes: result.reasonCodes,
      prototype_result: true,
      model_response: result,
      dataset_origin: 'IMS_PUBLIC_TEST_RIG',
      validation_scope: 'IMS_1ST_TEST_ONLY',
      generalization_status: 'NOT_ESTABLISHED_FOR_IPROTEX',
      validation_status: AiAnomalyValidationStatus.PENDING,
      created_at: new Date('2026-08-31T00:00:00.000Z'),
      updated_at: new Date('2026-08-31T00:00:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function makeService() {
    const savedDoc = makeSavedDoc();
    const analysisModel = {
      exists: jest.fn().mockReturnValue(exec(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(exec(savedDoc)),
      find: jest.fn().mockReturnValue(chainFind([savedDoc])),
      countDocuments: jest.fn().mockReturnValue(exec(1)),
      findOne: jest.fn().mockReturnValue(exec(savedDoc)),
    };
    const capteurModel = {
      findById: jest
        .fn()
        .mockReturnValue(exec({ _id: capteurId, module_id: moduleId })),
    };
    const moduleModel = {
      findById: jest
        .fn()
        .mockReturnValue(
          exec({ _id: moduleId, machine_id: new Types.ObjectId(machineId) }),
        ),
    };
    const documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
    };
    const fastApiClient = {
      getModels: jest.fn().mockResolvedValue({ modelVersion: '0.1.0' }),
      analyze: jest.fn().mockResolvedValue({ results: [result] }),
      analyzeBatch: jest.fn().mockResolvedValue({ results: [result] }),
    };
    const notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };
    const service = new AiAnomalyService(
      analysisModel as never,
      capteurModel as never,
      moduleModel as never,
      documentAccessService as never,
      fastApiClient as never,
      notificationCenterService as never,
    );
    return {
      service,
      savedDoc,
      analysisModel,
      capteurModel,
      moduleModel,
      documentAccessService,
      fastApiClient,
      notificationCenterService,
    };
  }

  const dto = {
    machine_id: machineId,
    capteur_id: capteurId,
    input_source: AiAnomalyInputSource.DATASET_REPLAY,
    rows: [row()],
  };

  it('stores a valid single inference after a successful FastAPI response', async () => {
    const { service, analysisModel, fastApiClient, notificationCenterService } =
      makeService();

    const response = await service.createAnalysis(dto, actor);

    expect(fastApiClient.analyze).toHaveBeenCalledWith({ rows: dto.rows });
    expect(analysisModel.exists).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: new Types.ObjectId(machineId),
        model_version: '0.1.0',
      }),
    );
    expect(analysisModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: new Types.ObjectId(machineId),
        model_version: '0.1.0',
        input_source: AiAnomalyInputSource.DATASET_REPLAY,
        experiment: '1st_test',
        bearing: 1,
      }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          requested_by: new Types.ObjectId(userId),
          model_response: result,
          raw_anomaly: false,
        }),
      }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
    expect(response[0]).toMatchObject({
      machine_id: machineId,
      capteur_id: capteurId,
      model_version: '0.1.0',
      dataset_origin: 'IMS_PUBLIC_TEST_RIG',
      validation_scope: 'IMS_1ST_TEST_ONLY',
      generalization_status: 'NOT_ESTABLISHED_FOR_IPROTEX',
    });
  });

  it('uses stateless batch analysis for deterministic replay', async () => {
    const { service, fastApiClient } = makeService();

    await service.createBatch(
      { ...dto, rows: [row(), row('2003-11-15T18:28:46')] },
      actor,
    );
    await service.createBatch(
      { ...dto, rows: [row(), row('2003-11-15T18:28:46')] },
      actor,
    );

    expect(fastApiClient.analyzeBatch).toHaveBeenCalledTimes(2);
    expect(fastApiClient.analyze).not.toHaveBeenCalled();
  });

  it('rejects duplicate IMS feature rows before calling FastAPI', async () => {
    const { service, fastApiClient } = makeService();

    await expect(
      service.createBatch({ ...dto, rows: [row(), row()] }, actor),
    ).rejects.toThrow(BadRequestException);
    expect(fastApiClient.analyzeBatch).not.toHaveBeenCalled();
  });

  it('rejects out-of-order timestamps before calling FastAPI', async () => {
    const { service, fastApiClient } = makeService();

    await expect(
      service.createBatch(
        {
          ...dto,
          rows: [row('2003-11-15T18:28:46'), row('2003-11-15T18:18:46')],
        },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(fastApiClient.analyzeBatch).not.toHaveBeenCalled();
  });

  it('keeps platform mapping explicit and rejects capteurs from another machine', async () => {
    const { service, moduleModel } = makeService();
    moduleModel.findById.mockReturnValue(
      exec({ _id: moduleId, machine_id: new Types.ObjectId() }),
    );

    await expect(service.createAnalysis(dto, actor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('passes unknown experiment and sensor mapping errors from FastAPI without saving', async () => {
    const { service, analysisModel, fastApiClient } = makeService();
    fastApiClient.analyze.mockRejectedValue(
      new BadRequestException('Unknown IMS experiment'),
    );

    await expect(
      service.createAnalysis(
        { ...dto, rows: [{ ...row(), experiment: 'unknown_test' }] },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(analysisModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('uses the authenticated user for request audit fields', async () => {
    const { service, analysisModel } = makeService();

    await service.createAnalysis(
      { ...dto, requested_by: new Types.ObjectId().toHexString() } as never,
      actor,
    );

    expect(analysisModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          requested_by: new Types.ObjectId(userId),
        }),
      }),
      expect.any(Object),
    );
  });

  it('separates persistence by machine and component through the upsert filter', async () => {
    const { service, analysisModel } = makeService();

    await Promise.all([
      service.createAnalysis(dto, actor),
      service.createAnalysis(dto, actor),
    ]);

    const filters = analysisModel.findOneAndUpdate.mock.calls.map(
      (call) => call[0],
    );
    expect(filters).toHaveLength(2);
    expect(filters[0]).toMatchObject({
      machine_id: new Types.ObjectId(machineId),
      bearing: 1,
      experiment: '1st_test',
    });
  });

  it('creates Admin and Technician notifications for a newly stored persistent alert only', async () => {
    const persistentResult = { ...result, persistentAlert: true };
    const savedDoc = makeSavedDoc({
      persistent_alert: true,
      model_response: persistentResult,
    });
    const { service, analysisModel, fastApiClient, notificationCenterService } =
      makeService();
    analysisModel.findOneAndUpdate.mockReturnValue(exec(savedDoc));
    fastApiClient.analyze.mockResolvedValue({ results: [persistentResult] });

    await service.createAnalysis(dto, actor);

    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledTimes(
      2,
    );
    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sensor_alert',
        recipientRole: Role.ADMIN,
        dedupeKey: `ai-anomaly:persistent-alert:${savedDoc.analysis_id}:${
          Role.ADMIN
        }`,
        message: expect.stringContaining('Experimental IMS dataset replay'),
      }),
    );
    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientRole: Role.TECHNICIAN,
        message: expect.stringContaining('not live IPROTEX telemetry'),
      }),
    );
  });

  it('does not notify when a persistent analysis already exists', async () => {
    const persistentResult = { ...result, persistentAlert: true };
    const savedDoc = makeSavedDoc({
      persistent_alert: true,
      model_response: persistentResult,
    });
    const { service, analysisModel, fastApiClient, notificationCenterService } =
      makeService();
    analysisModel.exists.mockReturnValue(exec({ _id: savedDoc._id }));
    analysisModel.findOneAndUpdate.mockReturnValue(exec(savedDoc));
    fastApiClient.analyze.mockResolvedValue({ results: [persistentResult] });

    await service.createAnalysis(dto, actor);

    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });

  it('applies server-side date filtering before pagination', async () => {
    const { service, analysisModel } = makeService();

    await service.listAnalyses(
      {
        dateFrom: '2003-11-15',
        dateTo: '2003-11-16T12:00:00Z',
        input_source: AiAnomalyInputSource.DATASET_REPLAY,
      },
      actor,
    );

    const filter = analysisModel.find.mock.calls[0][0];
    expect(filter).toMatchObject({
      input_source: AiAnomalyInputSource.DATASET_REPLAY,
      measurement_timestamp: {
        $gte: new Date('2003-11-15T00:00:00.000Z'),
        $lte: new Date('2003-11-16T12:00:00.000Z'),
      },
    });
    expect(analysisModel.countDocuments).toHaveBeenCalledWith(filter);
  });

  it('applies date filtering to machine-scoped history before pagination', async () => {
    const { service, analysisModel, documentAccessService } = makeService();

    await service.getMachineHistory(
      machineId,
      { dateFrom: '2003-11-15', dateTo: '2003-11-15' },
      actor,
    );

    const filter = analysisModel.find.mock.calls[0][0];
    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      actor,
      machineId,
    );
    expect(filter).toMatchObject({
      machine_id: new Types.ObjectId(machineId),
      measurement_timestamp: {
        $gte: new Date('2003-11-15T00:00:00.000Z'),
        $lte: new Date('2003-11-15T23:59:59.999Z'),
      },
    });
  });

  it('rejects invalid and reversed date ranges', async () => {
    const { service, analysisModel } = makeService();

    await expect(
      service.listAnalyses({ dateFrom: '2003-02-31' }, actor),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listAnalyses(
        { dateFrom: '2003-11-16', dateTo: '2003-11-15' },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(analysisModel.find).not.toHaveBeenCalled();
  });

  it('lists history only for admin and technician roles', async () => {
    const { service } = makeService();

    await expect(
      service.listAnalyses({}, { userId, role: Role.OPERATOR }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.listAnalyses({}, actor)).resolves.toMatchObject({
      totalItems: 1,
      items: [expect.objectContaining({ analysis_id: 'AI-ANOM-test' })],
    });
  });

  it('validates pending analyses with the authenticated technician', async () => {
    const savedDoc = makeSavedDoc();
    const { service, analysisModel } = makeService();
    analysisModel.findOne.mockReturnValue(exec(savedDoc));

    const response = await service.validateAnalysis(
      'AI-ANOM-test',
      {
        validation_status: AiAnomalyValidationStatus.CONFIRMED,
        validation_comment: 'Observed matching vibration issue',
      },
      actor,
    );

    expect(savedDoc.save).toHaveBeenCalled();
    expect(response.validation_status).toBe(
      AiAnomalyValidationStatus.CONFIRMED,
    );
    expect(response.validated_by).toBe(userId);
  });

  it('rejects repeated validation transitions', async () => {
    const savedDoc = makeSavedDoc({
      validation_status: AiAnomalyValidationStatus.CONFIRMED,
    });
    const { service, analysisModel } = makeService();
    analysisModel.findOne.mockReturnValue(exec(savedDoc));

    await expect(
      service.validateAnalysis(
        'AI-ANOM-test',
        { validation_status: AiAnomalyValidationStatus.REJECTED },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
