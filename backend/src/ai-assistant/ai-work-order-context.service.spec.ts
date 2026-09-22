import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../schemas/user.schema';
import { AiWorkOrderContextService } from './ai-work-order-context.service';
import { SensitiveDataFilterService } from './sensitive-data-filter.service';

function selectExec<T>(value: T) {
  return {
    select: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
  };
}

function selectSortExec<T>(value: T) {
  const exec = jest.fn().mockResolvedValue(value);
  const sort = jest.fn().mockReturnValue({ exec });
  return { select: jest.fn().mockReturnValue({ sort }) };
}

describe('AiWorkOrderContextService', () => {
  const admin = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };
  const technician = {
    userId: new Types.ObjectId().toString(),
    role: Role.TECHNICIAN,
  };
  const operator = {
    userId: new Types.ObjectId().toString(),
    role: Role.OPERATOR,
  };
  let machineId: string;
  let workOrderId: string;
  let workOrderModel: { findById: jest.Mock };
  let reportModel: { find: jest.Mock };
  let partsModel: { find: jest.Mock };
  let catalogueModel: { find: jest.Mock };
  let taskModel: { find: jest.Mock };
  let userModel: { findById: jest.Mock; find: jest.Mock };
  let access: { assertCanAccessMachine: jest.Mock };
  let service: AiWorkOrderContextService;

  function workOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(workOrderId),
      ot_id: 'OT-100',
      machine_id: new Types.ObjectId(machineId),
      technician_id: new Types.ObjectId(technician.userId),
      description: 'Bearing temperature is high',
      type_maintenance: 'corrective',
      status: 'in_progress',
      priorite: 'high',
      code_panne: 'BRG-01',
      date_created: new Date('2026-09-20T08:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    machineId = new Types.ObjectId().toString();
    workOrderId = new Types.ObjectId().toString();
    workOrderModel = { findById: jest.fn() };
    reportModel = { find: jest.fn().mockReturnValue(selectSortExec([])) };
    partsModel = {
      find: jest.fn().mockReturnValue(selectExec([])),
    };
    catalogueModel = { find: jest.fn().mockReturnValue(selectExec([])) };
    taskModel = { find: jest.fn().mockReturnValue(selectSortExec([])) };
    userModel = {
      findById: jest.fn().mockReturnValue(selectExec(null)),
      find: jest.fn().mockReturnValue(selectExec([])),
    };
    access = { assertCanAccessMachine: jest.fn().mockResolvedValue(undefined) };
    service = new AiWorkOrderContextService(
      workOrderModel as never,
      reportModel as never,
      partsModel as never,
      catalogueModel as never,
      taskModel as never,
      userModel as never,
      access as never,
      new SensitiveDataFilterService(),
    );
  });

  it('allows ADMIN and returns a sanitized business-readable context', async () => {
    workOrderModel.findById.mockReturnValue(selectExec(workOrder()));

    const result = await service.resolve(admin, workOrderId, machineId);

    expect(result).toMatchObject({
      workOrderId,
      machineId,
      context: {
        reference: 'OT-100',
        status: 'in_progress',
        description: 'Bearing temperature is high',
        checklist: [],
        interventions: [],
        partsUsed: [],
      },
    });
    expect(JSON.stringify(result.context)).not.toContain(workOrderId);
    expect(JSON.stringify(result.context)).not.toContain(machineId);
  });

  it('allows the assigned TECHNICIAN', async () => {
    workOrderModel.findById.mockReturnValue(selectExec(workOrder()));

    await expect(
      service.resolve(technician, workOrderId, machineId),
    ).resolves.toMatchObject({ workOrderId, machineId });
  });

  it('allows an OPERATOR only when the work order is assigned to that operator', async () => {
    workOrderModel.findById.mockReturnValue(
      selectExec(
        workOrder({ technician_id: new Types.ObjectId(operator.userId) }),
      ),
    );
    await expect(
      service.resolve(operator, workOrderId, machineId),
    ).resolves.toMatchObject({ workOrderId });

    workOrderModel.findById.mockReturnValue(selectExec(workOrder()));
    await expect(
      service.resolve(operator, workOrderId, machineId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a work order belonging to another selected machine before related context loads', async () => {
    workOrderModel.findById.mockReturnValue(selectExec(workOrder()));
    const otherMachineId = new Types.ObjectId().toString();

    await expect(
      service.resolve(admin, workOrderId, otherMachineId),
    ).rejects.toThrow(BadRequestException);
    expect(reportModel.find).not.toHaveBeenCalled();
    expect(access.assertCanAccessMachine).not.toHaveBeenCalled();
  });

  it('rejects unauthorized machine access before related work-order information loads', async () => {
    workOrderModel.findById.mockReturnValue(selectExec(workOrder()));
    access.assertCanAccessMachine.mockRejectedValue(
      new ForbiddenException('Technician is not authorized for this machine'),
    );

    await expect(
      service.resolve(technician, workOrderId, machineId),
    ).rejects.toThrow(ForbiddenException);
    expect(reportModel.find).not.toHaveBeenCalled();
    expect(partsModel.find).not.toHaveBeenCalled();
  });

  it('returns safe errors for nonexistent, malformed, and missing-machine work orders', async () => {
    await expect(service.resolve(admin, 'not-an-id')).rejects.toThrow(
      BadRequestException,
    );

    workOrderModel.findById.mockReturnValue(selectExec(null));
    await expect(service.resolve(admin, workOrderId)).rejects.toThrow(
      NotFoundException,
    );

    workOrderModel.findById.mockReturnValue(
      selectExec(workOrder({ machine_id: undefined })),
    );
    await expect(service.resolve(admin, workOrderId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('security regression: a user cannot reference a work order on an inaccessible machine', async () => {
    workOrderModel.findById.mockReturnValue(
      selectExec(
        workOrder({ technician_id: new Types.ObjectId(operator.userId) }),
      ),
    );
    access.assertCanAccessMachine.mockRejectedValue(
      new ForbiddenException('Operator is not assigned to this machine'),
    );

    await expect(service.resolve(operator, workOrderId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(reportModel.find).not.toHaveBeenCalled();
    expect(taskModel.find).not.toHaveBeenCalled();
    expect(catalogueModel.find).not.toHaveBeenCalled();
  });

  it('excludes unrelated work-order reports and parts by querying only the validated work order', async () => {
    const target = workOrder();
    workOrderModel.findById.mockReturnValue(selectExec(target));

    await service.resolve(admin, workOrderId);

    expect(reportModel.find).toHaveBeenCalledWith({ ot_id: target._id });
    expect(partsModel.find).toHaveBeenCalledWith({ ot_id: target._id });
  });
});
