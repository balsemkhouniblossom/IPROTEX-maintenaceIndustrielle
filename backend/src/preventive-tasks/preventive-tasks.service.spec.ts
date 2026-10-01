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
  let model: { updateOne: jest.Mock; updateMany: jest.Mock };
  let planModel: { find: jest.Mock; findById: jest.Mock };
  let moduleModel: { find: jest.Mock; findById: jest.Mock };
  let machineModel: { find: jest.Mock; findById: jest.Mock };
  let service: PreventiveTasksService;

  beforeEach(() => {
    model = {
      updateOne: jest.fn().mockReturnValue(execResult({ upsertedCount: 1 })),
      updateMany: jest.fn().mockReturnValue(execResult({ modifiedCount: 0 })),
    };
    planModel = {
      find: jest.fn().mockReturnValue(leanChain([])),
      findById: jest.fn().mockReturnValue(leanChain(null)),
    };
    moduleModel = {
      find: jest.fn().mockReturnValue({
        distinct: jest.fn().mockReturnValue(execResult([])),
      }),
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(leanChain(null)),
      }),
    };
    machineModel = {
      find: jest.fn().mockReturnValue({
        distinct: jest.fn().mockReturnValue(execResult([])),
      }),
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(leanChain(null)),
      }),
    };
    service = new PreventiveTasksService(
      model as never,
      planModel as never,
      moduleModel as never,
      machineModel as never,
    );
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
        $unset: { deleted_at: '' },
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

  it('keeps Winding checklist lines intact and ignores section labels', async () => {
    const planId = new Types.ObjectId();
    planModel.find.mockReturnValue(
      leanChain([
        {
          _id: planId,
          plan_id: 'PLAN-WINDING-W1',
          type_maintenance: 'preventive',
          instruction: [
            'Checklist for W1:',
            '- Check the movable guard on the winding spindles.',
            '',
            'Verification details:',
            '- Function test of machine safety door: if door is open; the machine must not start.',
          ].join('\n'),
        },
      ]),
    );

    const result = await service.syncPlans();

    expect(result).toEqual({ plans: 1, created: 2 });
    expect(model.updateOne).toHaveBeenCalledWith(
      { source_key: `${String(planId)}:0` },
      expect.objectContaining({
        $set: expect.objectContaining({
          instruction: 'Check the movable guard on the winding spindles.',
        }),
      }),
      { upsert: true },
    );
    expect(model.updateOne).toHaveBeenCalledWith(
      { source_key: `${String(planId)}:1` },
      expect.objectContaining({
        $set: expect.objectContaining({
          instruction:
            'Function test of machine safety door: if door is open; the machine must not start.',
        }),
      }),
      { upsert: true },
    );
  });

  it('resolves every W code to existing template details for a legacy code-only pack', async () => {
    const planId = new Types.ObjectId();
    const moduleId = new Types.ObjectId();
    const machineId = new Types.ObjectId();
    const machineTypeId = new Types.ObjectId();
    const templateModuleId = new Types.ObjectId();
    planModel.findById.mockReturnValueOnce(
      leanChain({
        _id: planId,
        module_id: moduleId,
        plan_id: 'PACK-W1-W2',
        maintenance_code: 'W1, W2',
        type_maintenance: 'preventive',
        instruction: 'W1\nW2',
      }),
    );
    planModel.find.mockReturnValueOnce(
      leanChain([
        {
          _id: new Types.ObjectId(),
          maintenance_code: 'W1',
          instruction: 'Inspect the guard',
        },
        {
          _id: new Types.ObjectId(),
          maintenance_code: 'W2',
          instruction: 'Lubricate the bearing',
        },
      ]),
    );
    moduleModel.findById.mockReturnValueOnce({
      select: jest.fn().mockReturnValue(
        leanChain({ _id: moduleId, machine_id: machineId }),
      ),
    });
    machineModel.findById.mockReturnValueOnce({
      select: jest.fn().mockReturnValue(
        leanChain({ _id: machineId, type_id: machineTypeId }),
      ),
    });
    machineModel.find.mockReturnValueOnce({
      distinct: jest.fn().mockReturnValue(execResult([machineId])),
    });
    moduleModel.find.mockReturnValueOnce({
      distinct: jest.fn().mockReturnValue(execResult([templateModuleId])),
    });

    await service.syncPlanWithTemplateDetails(planId);

    expect(planModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ module_id: { $in: [templateModuleId] } }),
    );

    expect(model.updateOne).toHaveBeenNthCalledWith(
      1,
      { source_key: `${String(planId)}:0` },
      expect.objectContaining({
        $set: expect.objectContaining({
          instruction: 'W1: Inspect the guard',
        }),
      }),
      { upsert: true },
    );
    expect(model.updateOne).toHaveBeenNthCalledWith(
      2,
      { source_key: `${String(planId)}:1` },
      expect.objectContaining({
        $set: expect.objectContaining({
          instruction: 'W2: Lubricate the bearing',
        }),
      }),
      { upsert: true },
    );
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
    service = new PreventiveTasksService(
      model as never,
      planModel as never,
      {} as never,
      {} as never,
    );
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
