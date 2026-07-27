import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MaintenancePlansService } from './maintenance-plans.service';
import { MaintenancePlanStatus } from '../schemas/maintenance-plan.schema';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('MaintenancePlansService', () => {
  const planId = new Types.ObjectId().toHexString();
  const actorId = new Types.ObjectId().toHexString();

  function planDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: planId,
      plan_id: 'MP-001',
      module_id: new Types.ObjectId(),
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'month',
      status: MaintenancePlanStatus.DRAFT,
      version: 1,
      lifecycle_history: [],
      ...overrides,
    };
  }

  let maintenancePlanModel: {
    create: jest.Mock;
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOneAndDelete: jest.Mock;
  };
  let workOrderModel: { exists: jest.Mock };
  let workOrdersService: { createInitialOccurrenceForPlan: jest.Mock };
  let service: MaintenancePlansService;

  beforeEach(() => {
    maintenancePlanModel = {
      create: jest.fn().mockResolvedValue(planDoc()),
      findById: jest.fn().mockReturnValue(execResult(planDoc())),
      findOneAndUpdate: jest.fn().mockReturnValue(
        execResult(planDoc({ version: 2 })),
      ),
      findOneAndDelete: jest.fn().mockReturnValue(execResult(planDoc())),
    };
    workOrderModel = {
      exists: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };
    workOrdersService = {
      createInitialOccurrenceForPlan: jest.fn().mockResolvedValue(null),
    };

    service = new MaintenancePlansService(
      maintenancePlanModel as never,
      workOrderModel as never,
      workOrdersService as never,
    );
  });

  describe('create', () => {
    it('always starts a new plan as Draft at version 1 with a created history entry, regardless of client input', async () => {
      await service.create(
        {
          plan_id: 'MP-002',
          module_id: new Types.ObjectId().toHexString(),
          type_maintenance: 'preventive',
          frequence: 1,
          unite_frequence: 'month',
        } as never,
        actorId,
      );

      expect(maintenancePlanModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MaintenancePlanStatus.DRAFT,
          version: 1,
          lifecycle_history: [
            expect.objectContaining({
              action: 'created',
              to_status: MaintenancePlanStatus.DRAFT,
              actor_user_id: new Types.ObjectId(actorId),
            }),
          ],
        }),
      );
    });
  });

  describe('update', () => {
    it('rejects editing an Archived plan', async () => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.ARCHIVED })),
      );

      await expect(
        service.update(planId, { instruction: 'New steps' } as never, actorId),
      ).rejects.toThrow(ConflictException);
      expect(maintenancePlanModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects an edit with no expected_version once the plan has a validated occurrence', async () => {
      workOrderModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await expect(
        service.update(planId, { instruction: 'New steps' } as never, actorId),
      ).rejects.toThrow(ConflictException);
      expect(maintenancePlanModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects an edit whose expected_version does not match once the plan has a validated occurrence', async () => {
      workOrderModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await expect(
        service.update(
          planId,
          { instruction: 'New steps', expected_version: 99 } as never,
          actorId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(maintenancePlanModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('applies a version-safe edit once the plan has a validated occurrence and expected_version matches', async () => {
      workOrderModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'x' }) });

      const result = await service.update(
        planId,
        { instruction: 'New steps', expected_version: 1 } as never,
        actorId,
      );

      expect(maintenancePlanModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: planId, version: 1 },
        expect.objectContaining({
          $set: expect.objectContaining({ instruction: 'New steps' }),
          $inc: { version: 1 },
        }),
        { new: true },
      );
      expect(result.version).toBe(2);
    });

    it('allows an edit without expected_version when there is no validated occurrence yet', async () => {
      await service.update(planId, { instruction: 'New steps' } as never, actorId);

      expect(maintenancePlanModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('fails safe when a concurrent edit changes the version between read and write', async () => {
      maintenancePlanModel.findOneAndUpdate.mockReturnValue(execResult(null));

      await expect(
        service.update(planId, { instruction: 'New steps' } as never, actorId),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the plan does not exist', async () => {
      maintenancePlanModel.findById.mockReturnValue(execResult(null));

      await expect(
        service.update(planId, { instruction: 'x' } as never, actorId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('rejects deleting an Archived plan', async () => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.ARCHIVED })),
      );

      await expect(service.remove(planId)).rejects.toThrow(ConflictException);
      expect(maintenancePlanModel.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('rejects deleting a plan with a validated occurrence unless expected_version matches', async () => {
      workOrderModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await expect(service.remove(planId)).rejects.toThrow(ConflictException);
      await expect(service.remove(planId, 99)).rejects.toThrow(ConflictException);
      expect(maintenancePlanModel.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('deletes a plan with a validated occurrence when expected_version matches', async () => {
      workOrderModel.exists.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await service.remove(planId, 1);

      expect(maintenancePlanModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: planId,
        version: 1,
      });
    });

    it('deletes a plan with no validated occurrence without requiring expected_version', async () => {
      await service.remove(planId);

      expect(maintenancePlanModel.findOneAndDelete).toHaveBeenCalled();
    });
  });

  describe('transition', () => {
    it('rejects an unknown action', async () => {
      await expect(
        service.transition(planId, { action: 'bogus' } as never, actorId),
      ).rejects.toThrow();
    });

    it('rejects a transition not valid for the current status', async () => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.ARCHIVED })),
      );

      await expect(
        service.transition(planId, { action: 'activate' } as never, actorId),
      ).rejects.toThrow(ConflictException);
      expect(maintenancePlanModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('activates a Draft plan, records history, and creates the first occurrence', async () => {
      maintenancePlanModel.findOneAndUpdate.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.ACTIVE, version: 2 })),
      );
      const createdOccurrence = { _id: new Types.ObjectId() };
      workOrdersService.createInitialOccurrenceForPlan.mockResolvedValue(
        createdOccurrence,
      );

      const result = await service.transition(
        planId,
        { action: 'activate' } as never,
        actorId,
      );

      expect(maintenancePlanModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: planId, status: { $in: [MaintenancePlanStatus.DRAFT] } },
        expect.objectContaining({
          $set: { status: MaintenancePlanStatus.ACTIVE },
          $inc: { version: 1 },
          $push: {
            lifecycle_history: expect.objectContaining({
              action: 'activated',
              from_status: MaintenancePlanStatus.DRAFT,
              to_status: MaintenancePlanStatus.ACTIVE,
            }),
          },
        }),
        { new: true },
      );
      expect(workOrdersService.createInitialOccurrenceForPlan).toHaveBeenCalledWith(
        planId,
      );
      expect(result.createdOccurrence).toBe(createdOccurrence);
    });

    it('pausing an Active plan does not attempt to create any occurrence', async () => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.ACTIVE })),
      );
      maintenancePlanModel.findOneAndUpdate.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.PAUSED, version: 2 })),
      );

      const result = await service.transition(
        planId,
        { action: 'pause' } as never,
        actorId,
      );

      expect(workOrdersService.createInitialOccurrenceForPlan).not.toHaveBeenCalled();
      expect(result.createdOccurrence).toBeNull();
    });

    it('fails safe (conflict) when a concurrent transition wins the atomic status-guarded race', async () => {
      maintenancePlanModel.findOneAndUpdate.mockReturnValue(execResult(null));

      await expect(
        service.transition(planId, { action: 'activate' } as never, actorId),
      ).rejects.toThrow(ConflictException);
      expect(workOrdersService.createInitialOccurrenceForPlan).not.toHaveBeenCalled();
    });

    it('allows resuming a Paused plan back to Active', async () => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.PAUSED })),
      );
      maintenancePlanModel.findOneAndUpdate.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.ACTIVE, version: 2 })),
      );

      await service.transition(planId, { action: 'resume' } as never, actorId);

      expect(maintenancePlanModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: planId, status: { $in: [MaintenancePlanStatus.PAUSED] } },
        expect.anything(),
        { new: true },
      );
      // resume never re-creates the first occurrence — that only happens on activate
      expect(workOrdersService.createInitialOccurrenceForPlan).not.toHaveBeenCalled();
    });

    it('rejects archiving something already Archived', async () => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult(planDoc({ status: MaintenancePlanStatus.ARCHIVED })),
      );

      await expect(
        service.transition(planId, { action: 'archive' } as never, actorId),
      ).rejects.toThrow(ConflictException);
    });
  });
});

describe('MaintenancePlansService.findAll — server-side filtering, search, and sort', () => {
  function findAllChain<T>(value: T) {
    const result: {
      sort: jest.Mock;
      skip: jest.Mock;
      limit: jest.Mock;
      populate: jest.Mock;
      exec: jest.Mock;
    } = {
      sort: jest.fn(),
      skip: jest.fn(),
      limit: jest.fn(),
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue(value),
    };
    result.sort.mockReturnValue(result);
    result.skip.mockReturnValue(result);
    result.limit.mockReturnValue(result);
    result.populate.mockReturnValue(result);
    return result;
  }

  let maintenancePlanModel: { find: jest.Mock; countDocuments: jest.Mock };
  let service: MaintenancePlansService;

  beforeEach(() => {
    maintenancePlanModel = {
      find: jest.fn().mockReturnValue(findAllChain([])),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    };

    service = new MaintenancePlansService(
      maintenancePlanModel as never,
      {} as never,
      {} as never,
    );
  });

  it('applies status and type_maintenance as $in filters from comma-separated query params', async () => {
    await service.findAll(1, 10, 0, { status: 'active,paused', typeMaintenance: 'preventive' });

    expect(maintenancePlanModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: ['active', 'paused'] },
        type_maintenance: { $in: ['preventive'] },
      }),
    );
  });

  it('escapes search input and searches plan_id/maintenance_code/instruction/responsable', async () => {
    await service.findAll(1, 10, 0, { search: 'a.b+c' });

    const [filter] = maintenancePlanModel.find.mock.calls[0] as [
      { $or: Array<Record<string, RegExp>> },
    ];
    expect(filter.$or).toHaveLength(4);
    expect(filter.$or[0].plan_id.source).toBe('a\\.b\\+c');
  });

  it('sorts by an allow-listed field and direction', async () => {
    const chain = findAllChain([]);
    maintenancePlanModel.find.mockReturnValue(chain);

    await service.findAll(1, 10, 0, { sort: 'status' });

    expect(chain.sort).toHaveBeenCalledWith({ status: 1 });
  });

  it('defaults to newest-first when sort is absent or not allow-listed', async () => {
    const chain = findAllChain([]);
    maintenancePlanModel.find.mockReturnValue(chain);

    await service.findAll(1, 10, 0, { sort: 'frequence' });

    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });
});
