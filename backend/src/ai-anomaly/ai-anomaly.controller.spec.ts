import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { Role } from '../schemas/user.schema';
import { AiAnomalyController } from './ai-anomaly.controller';
import { AiAnomalyService } from './ai-anomaly.service';
import {
  AiAnomalyInputSource,
  AiAnomalyValidationStatus,
} from '../schemas/ai-anomaly-analysis.schema';

describe('AiAnomalyController', () => {
  const aiAnomalyService = {
    getModelMetadata: jest.fn(),
    createAnalysis: jest.fn(),
    createBatch: jest.fn(),
    listAnalyses: jest.fn(),
    getAnalysis: jest.fn(),
    getMachineHistory: jest.fn(),
    validateAnalysis: jest.fn(),
  };

  let controller: AiAnomalyController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AiAnomalyController],
      providers: [{ provide: AiAnomalyService, useValue: aiAnomalyService }],
    }).compile();

    controller = moduleRef.get(AiAnomalyController);
  });

  function controllerMethod(name: keyof AiAnomalyController): object {
    const value = Object.getOwnPropertyDescriptor(
      AiAnomalyController.prototype,
      name,
    )?.value;
    if (typeof value !== 'function') {
      throw new Error(`Missing controller method ${String(name)}`);
    }
    return value;
  }

  it('exposes model metadata only to admin and technician users', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, controllerMethod('getModels'));

    expect(roles).toEqual([Role.ADMIN, Role.TECHNICIAN]);
  });

  it('allows authenticated users to request analysis while deriving the actor from JWT', async () => {
    const dto = {
      machine_id: '64a111111111111111111111',
      input_source: AiAnomalyInputSource.DEMO,
      rows: [],
    };
    const req = {
      user: { userId: '64a222222222222222222222', role: Role.OPERATOR },
    };

    await controller.createAnalysis(dto, req as never);

    expect(aiAnomalyService.createAnalysis).toHaveBeenCalledWith(dto, {
      userId: req.user.userId,
      role: Role.OPERATOR,
    });
  });

  it('keeps history and validation restricted to admin and technician users', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethod('listAnalyses')),
    ).toEqual([Role.ADMIN, Role.TECHNICIAN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethod('getMachineHistory')),
    ).toEqual([Role.ADMIN, Role.TECHNICIAN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, controllerMethod('validateAnalysis')),
    ).toEqual([Role.ADMIN, Role.TECHNICIAN]);
  });

  it('forwards validation status without trusting body user identifiers', async () => {
    const req = {
      user: { userId: '64a333333333333333333333', role: Role.TECHNICIAN },
    };
    const dto = {
      validation_status: AiAnomalyValidationStatus.REJECTED,
      validated_by: '64a444444444444444444444',
    };

    await controller.validateAnalysis(
      'AI-ANOM-test',
      dto as never,
      req as never,
    );

    expect(aiAnomalyService.validateAnalysis).toHaveBeenCalledWith(
      'AI-ANOM-test',
      dto,
      { userId: req.user.userId, role: Role.TECHNICIAN },
    );
  });
});
