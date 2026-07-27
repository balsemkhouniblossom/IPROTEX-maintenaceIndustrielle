import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PreventiveTasksService } from './preventive-tasks.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockReturnValue(execResult(value)) };
}

describe('PreventiveTasksService.syncPlans', () => {
  let model: { updateOne: jest.Mock };
  let planModel: { find: jest.Mock };
  let service: PreventiveTasksService;

  beforeEach(() => {
    model = {
      updateOne: jest.fn().mockReturnValue(execResult({ upsertedCount: 1 })),
    };
    planModel = { find: jest.fn().mockReturnValue(leanChain([])) };
    service = new PreventiveTasksService(model as never, planModel as never);
  });

  it('queries plans by any non-corrective type (preventive, lubrication, inspection), not just preventive', async () => {
    await service.syncPlans();

    const [filter] = planModel.find.mock.calls[0] as [
      { type_maintenance: unknown; instruction: unknown },
    ];
    expect(filter.type_maintenance).toEqual({ $not: /correct/i });
    expect(filter.instruction).toEqual({ $exists: true, $ne: '' });
  });

  it('generates checklist tasks from a lubrication plan instruction, same as it would for preventive', async () => {
    const planId = new Types.ObjectId();
    const moduleId = new Types.ObjectId();
    planModel.find.mockReturnValue(
      leanChain([
        {
          _id: planId,
          plan_id: 'PLAN-LUB-1',
          module_id: moduleId,
          type_maintenance: 'lubrication',
          instruction: 'Check oil level\nGrease bearings',
          responsable: 'Operator',
        },
      ]),
    );

    const result = await service.syncPlans();

    expect(result).toEqual({ plans: 1, created: 2 });
    expect(model.updateOne).toHaveBeenCalledWith(
      { source_key: `${String(planId)}:0` },
      expect.objectContaining({
        $set: expect.objectContaining({ instruction: 'Check oil level' }),
      }),
      { upsert: true },
    );
    expect(model.updateOne).toHaveBeenCalledWith(
      { source_key: `${String(planId)}:1` },
      expect.objectContaining({
        $set: expect.objectContaining({ instruction: 'Grease bearings' }),
      }),
      { upsert: true },
    );
  });

  it('generates checklist tasks from an inspection plan instruction', async () => {
    const planId = new Types.ObjectId();
    planModel.find.mockReturnValue(
      leanChain([
        {
          _id: planId,
          plan_id: 'PLAN-INS-1',
          type_maintenance: 'inspection',
          instruction: 'Inspect alignment',
        },
      ]),
    );

    const result = await service.syncPlans();

    expect(result).toEqual({ plans: 1, created: 1 });
  });
});

describe('PreventiveTasksService CRUD', () => {
  let model: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let planModel: Record<string, unknown>;
  let service: PreventiveTasksService;

  beforeEach(() => {
    model = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    planModel = {};
    service = new PreventiveTasksService(model as never, planModel as never);
  });

  it('throws when finding a preventive task that does not exist', async () => {
    model.findOne.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.findOne(new Types.ObjectId().toHexString()),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws when updating a preventive task that does not exist', async () => {
    model.findOneAndUpdate.mockReturnValue(execResult(null));

    await expect(
      service.update(new Types.ObjectId().toHexString(), {
        status: 'completed',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
