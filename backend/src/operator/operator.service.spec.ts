import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OperatorService } from './operator.service';

function queryResult<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('OperatorService machine scoping', () => {
  const operatorId = new Types.ObjectId();
  const assignedMachineId = new Types.ObjectId();
  const unassignedMachineId = new Types.ObjectId();
  const assignedWorkOrderId = new Types.ObjectId();

  let workOrderModel: {
    find: jest.Mock;
    countDocuments: jest.Mock;
    distinct: jest.Mock;
    findById: jest.Mock;
  };
  let reportModel: { find: jest.Mock; countDocuments: jest.Mock };
  let machineModel: { find: jest.Mock; countDocuments: jest.Mock };
  let referenceModel: { find: jest.Mock; countDocuments: jest.Mock };
  let moduleModel: { find: jest.Mock; countDocuments: jest.Mock };
  let userModel: { findById: jest.Mock };
  let documentModel: { find: jest.Mock; countDocuments: jest.Mock };
  let panneModel: { find: jest.Mock; countDocuments: jest.Mock };
  let panneSolutionModel: { find: jest.Mock; countDocuments: jest.Mock };
  let preventiveTaskModel: {
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let preventiveTasksService: { syncPlansForModuleIds: jest.Mock };
  let workOrdersService: {
    getMachinePreventiveStates: jest.Mock;
    scheduleFirstPreventiveOccurrence: jest.Mock;
    getCalendarEvents: jest.Mock;
    createCorrectiveReportForOperator: jest.Mock;
    submitPreventiveMaintenanceForOperator: jest.Mock;
    requestPartsForOperator: jest.Mock;
    getCalendarWidgetForOperator: jest.Mock;
    getNotificationCardsForOperator: jest.Mock;
    getTimelineForOperator: jest.Mock;
    getCalendarEventDetailsForOperator: jest.Mock;
    startWorkOrderForOperator: jest.Mock;
    completeWorkOrderForOperator: jest.Mock;
    rescheduleWorkOrderForOperator: jest.Mock;
  };
  let service: OperatorService;

  beforeEach(() => {
    workOrderModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
      distinct: jest.fn().mockReturnValue(queryResult([])),
      findById: jest.fn().mockReturnValue(
        queryResult({ _id: assignedWorkOrderId, machine_id: assignedMachineId }),
      ),
    };
    reportModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
    };
    machineModel = {
      find: jest.fn().mockReturnValue(queryResult([{ _id: assignedMachineId }])),
      countDocuments: jest.fn().mockReturnValue(queryResult(1)),
      distinct: jest.fn().mockReturnValue(queryResult([])),
    } as never;
    referenceModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
    };
    moduleModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
    };
    userModel = {
      findById: jest.fn().mockReturnValue(
        queryResult({
          assigned_machine_ids: [assignedMachineId],
        }),
      ),
    };
    documentModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
    };
    panneModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
    };
    panneSolutionModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
    };
    preventiveTaskModel = {
      find: jest.fn().mockReturnValue(queryResult([])),
      countDocuments: jest.fn().mockReturnValue(queryResult(0)),
      findOne: jest.fn().mockReturnValue(queryResult(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(queryResult(null)),
    };
    preventiveTasksService = {
      syncPlansForModuleIds: jest.fn().mockResolvedValue({ plans: 0, created: 0 }),
    };
    workOrdersService = {
      getMachinePreventiveStates: jest.fn().mockResolvedValue({ sections: {} }),
      scheduleFirstPreventiveOccurrence: jest.fn().mockResolvedValue({}),
      getCalendarEvents: jest.fn().mockResolvedValue({ items: [] }),
      createCorrectiveReportForOperator: jest.fn().mockResolvedValue({
        workOrder: { _id: new Types.ObjectId() },
        report: { _id: new Types.ObjectId() },
        duplicate: false,
      }),
      submitPreventiveMaintenanceForOperator: jest.fn().mockResolvedValue({
        workOrder: { _id: assignedWorkOrderId },
        report: { _id: new Types.ObjectId() },
        lubricationLog: null,
      }),
      requestPartsForOperator: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        status: 'pending',
      }),
      getCalendarWidgetForOperator: jest.fn().mockResolvedValue({ today: [] }),
      getNotificationCardsForOperator: jest.fn().mockResolvedValue([]),
      getTimelineForOperator: jest.fn().mockResolvedValue({ today: [] }),
      getCalendarEventDetailsForOperator: jest
        .fn()
        .mockResolvedValue({ id: assignedWorkOrderId.toString() }),
      startWorkOrderForOperator: jest
        .fn()
        .mockResolvedValue({ _id: assignedWorkOrderId, status: 'in_progress' }),
      completeWorkOrderForOperator: jest
        .fn()
        .mockResolvedValue({ _id: assignedWorkOrderId, status: 'waiting_validation' }),
      rescheduleWorkOrderForOperator: jest
        .fn()
        .mockResolvedValue({ occurrence: { _id: assignedWorkOrderId } }),
    };

    service = new OperatorService(
      workOrderModel as never,
      reportModel as never,
      machineModel as never,
      referenceModel as never,
      moduleModel as never,
      referenceModel as never,
      referenceModel as never,
      referenceModel as never,
      referenceModel as never,
      referenceModel as never,
      userModel as never,
      documentModel as never,
      panneModel as never,
      panneSolutionModel as never,
      preventiveTaskModel as never,
      workOrdersService as never,
      {} as never,
      preventiveTasksService as never,
    );
  });

  it('returns only machines assigned to the authenticated Operator', async () => {
    await service.getMyMachines(operatorId.toString(), 1, 10, 0);

    expect(userModel.findById).toHaveBeenCalledWith(operatorId.toString());
    expect(machineModel.find).toHaveBeenCalledWith({
      _id: { $in: [assignedMachineId] },
    });
  });

  it('denies preventive state access for unassigned machines before workflow service calls', async () => {
    await expect(
      service.getPreventiveStates(
        operatorId.toString(),
        unassignedMachineId.toString(),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrdersService.getMachinePreventiveStates).not.toHaveBeenCalled();
  });

  it('allows preventive scheduling only for assigned machines and derives the operator id', async () => {
    await service.schedulePreventive(operatorId.toString(), {
      machineId: assignedMachineId.toString(),
      planId: new Types.ObjectId().toString(),
      scheduledDate: '2026-10-10T08:00:00.000Z',
    });

    expect(workOrdersService.scheduleFirstPreventiveOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: assignedMachineId.toString(),
        operatorId: operatorId.toString(),
      }),
    );
  });

  it('denies calendar filters that target an unassigned machine', async () => {
    await expect(
      service.getMyCalendar(operatorId.toString(), {
        view: 'month',
        date: new Date('2026-10-01T00:00:00.000Z'),
        machineId: unassignedMachineId.toString(),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrdersService.getCalendarEvents).not.toHaveBeenCalled();
  });

  it('denies corrective report creation for a machine not assigned to the Operator', async () => {
    await expect(
      service.createCorrectiveReport(operatorId.toString(), {
        machineId: unassignedMachineId.toString(),
        codePanne: 'FAULT-1',
        actions: ['Reset breaker'],
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(
      workOrdersService.createCorrectiveReportForOperator,
    ).not.toHaveBeenCalled();
  });

  it('derives the operator identity from the authenticated user id and ignores any other caller-supplied identity', async () => {
    await service.createCorrectiveReport(operatorId.toString(), {
      machineId: assignedMachineId.toString(),
      codePanne: 'FAULT-1',
      faultDescription: 'Motor overheating',
      actions: ['Reset breaker', 'Inspect wiring'],
      priority: 'high',
    });

    expect(
      workOrdersService.createCorrectiveReportForOperator,
    ).toHaveBeenCalledWith({
      machineId: assignedMachineId.toString(),
      codePanne: 'FAULT-1',
      faultDescription: 'Motor overheating',
      actions: ['Reset breaker', 'Inspect wiring'],
      priority: 'high',
      operatorId: operatorId.toString(),
    });
  });

  it('rejects preventive-maintenance submission when the target work order does not exist', async () => {
    workOrderModel.findById.mockReturnValue(queryResult(null));

    await expect(
      service.submitPreventiveMaintenance(operatorId.toString(), {
        workOrderId: new Types.ObjectId().toString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(
      workOrdersService.submitPreventiveMaintenanceForOperator,
    ).not.toHaveBeenCalled();
  });

  it('denies preventive-maintenance submission when the work order belongs to a machine not assigned to the Operator', async () => {
    workOrderModel.findById.mockReturnValue(
      queryResult({ _id: assignedWorkOrderId, machine_id: unassignedMachineId }),
    );

    await expect(
      service.submitPreventiveMaintenance(operatorId.toString(), {
        workOrderId: assignedWorkOrderId.toString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(
      workOrdersService.submitPreventiveMaintenanceForOperator,
    ).not.toHaveBeenCalled();
  });

  it('verifies machine assignment via the target work order, then derives the operator identity and forwards no other identity', async () => {
    await service.submitPreventiveMaintenance(operatorId.toString(), {
      workOrderId: assignedWorkOrderId.toString(),
      tasksCompleted: ['Check belt tension', 'Grease bearings'],
      condition: 'good',
      comments: 'All nominal',
      lubrication: { lubrifiantId: new Types.ObjectId().toString(), quantity: 2 },
    });

    expect(workOrderModel.findById).toHaveBeenCalledWith(
      assignedWorkOrderId.toString(),
    );
    expect(
      workOrdersService.submitPreventiveMaintenanceForOperator,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: assignedWorkOrderId.toString(),
        tasksCompleted: ['Check belt tension', 'Grease bearings'],
        condition: 'good',
        comments: 'All nominal',
        operatorId: operatorId.toString(),
      }),
    );
  });

  it('rejects a parts request when the target work order does not exist', async () => {
    workOrderModel.findById.mockReturnValue(queryResult(null));

    await expect(
      service.requestParts(operatorId.toString(), {
        workOrderId: new Types.ObjectId().toString(),
        partId: new Types.ObjectId().toString(),
        quantity: 2,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(workOrdersService.requestPartsForOperator).not.toHaveBeenCalled();
  });

  it('denies a parts request when the work order belongs to a machine not assigned to the Operator', async () => {
    workOrderModel.findById.mockReturnValue(
      queryResult({ _id: assignedWorkOrderId, machine_id: unassignedMachineId }),
    );

    await expect(
      service.requestParts(operatorId.toString(), {
        workOrderId: assignedWorkOrderId.toString(),
        partId: new Types.ObjectId().toString(),
        quantity: 2,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrdersService.requestPartsForOperator).not.toHaveBeenCalled();
  });

  it('verifies machine assignment via the target work order, then derives the operator identity and forwards no other identity for a parts request', async () => {
    const partId = new Types.ObjectId().toString();

    await service.requestParts(operatorId.toString(), {
      workOrderId: assignedWorkOrderId.toString(),
      partId,
      quantity: 3,
    });

    expect(workOrderModel.findById).toHaveBeenCalledWith(
      assignedWorkOrderId.toString(),
    );
    expect(workOrdersService.requestPartsForOperator).toHaveBeenCalledWith({
      workOrderId: assignedWorkOrderId.toString(),
      partId,
      quantity: 3,
      operatorId: operatorId.toString(),
    });
  });

  it('scopes the personal calendar widget to the authenticated Operator', async () => {
    const result = await service.getCalendarWidget(operatorId.toString());

    expect(workOrdersService.getCalendarWidgetForOperator).toHaveBeenCalledWith(
      operatorId.toString(),
    );
    expect(result).toEqual({ today: [] });
  });

  it('scopes the personal notification cards to the authenticated Operator', async () => {
    await service.getCalendarNotifications(operatorId.toString());

    expect(
      workOrdersService.getNotificationCardsForOperator,
    ).toHaveBeenCalledWith(operatorId.toString());
  });

  it('denies a personal timeline filtered by a machine not assigned to the Operator', async () => {
    await expect(
      service.getCalendarTimeline(operatorId.toString(), {
        date: new Date('2026-07-16T00:00:00.000Z'),
        machineId: unassignedMachineId.toString(),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrdersService.getTimelineForOperator).not.toHaveBeenCalled();
  });

  it('scopes the personal timeline to the authenticated Operator', async () => {
    const date = new Date('2026-07-16T00:00:00.000Z');

    await service.getCalendarTimeline(operatorId.toString(), {
      date,
      machineId: assignedMachineId.toString(),
    });

    expect(workOrdersService.getTimelineForOperator).toHaveBeenCalledWith(
      date,
      operatorId.toString(),
      assignedMachineId.toString(),
    );
  });

  it('rejects calendar event details when the work order does not exist', async () => {
    workOrderModel.findById.mockReturnValue(queryResult(null));

    await expect(
      service.getCalendarEventDetails(
        operatorId.toString(),
        assignedWorkOrderId.toString(),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(
      workOrdersService.getCalendarEventDetailsForOperator,
    ).not.toHaveBeenCalled();
  });

  it('denies calendar event details for a machine not assigned to the Operator', async () => {
    workOrderModel.findById.mockReturnValue(
      queryResult({ _id: assignedWorkOrderId, machine_id: unassignedMachineId }),
    );

    await expect(
      service.getCalendarEventDetails(
        operatorId.toString(),
        assignedWorkOrderId.toString(),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(
      workOrdersService.getCalendarEventDetailsForOperator,
    ).not.toHaveBeenCalled();
  });

  it('delegates calendar event details once machine assignment is verified', async () => {
    await service.getCalendarEventDetails(
      operatorId.toString(),
      assignedWorkOrderId.toString(),
    );

    expect(
      workOrdersService.getCalendarEventDetailsForOperator,
    ).toHaveBeenCalledWith(assignedWorkOrderId.toString(), operatorId.toString());
  });

  it('denies starting a calendar event for a machine not assigned to the Operator', async () => {
    workOrderModel.findById.mockReturnValue(
      queryResult({ _id: assignedWorkOrderId, machine_id: unassignedMachineId }),
    );

    await expect(
      service.startCalendarEvent(operatorId.toString(), assignedWorkOrderId.toString()),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrdersService.startWorkOrderForOperator).not.toHaveBeenCalled();
  });

  it('delegates starting a calendar event once machine assignment is verified', async () => {
    await service.startCalendarEvent(operatorId.toString(), assignedWorkOrderId.toString());

    expect(workOrdersService.startWorkOrderForOperator).toHaveBeenCalledWith({
      operatorId: operatorId.toString(),
      workOrderId: assignedWorkOrderId.toString(),
    });
  });

  it('denies completing a calendar event for a machine not assigned to the Operator', async () => {
    workOrderModel.findById.mockReturnValue(
      queryResult({ _id: assignedWorkOrderId, machine_id: unassignedMachineId }),
    );

    await expect(
      service.completeCalendarEvent(operatorId.toString(), assignedWorkOrderId.toString()),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrdersService.completeWorkOrderForOperator).not.toHaveBeenCalled();
  });

  it('delegates completing a calendar event once machine assignment is verified', async () => {
    await service.completeCalendarEvent(operatorId.toString(), assignedWorkOrderId.toString());

    expect(workOrdersService.completeWorkOrderForOperator).toHaveBeenCalledWith({
      operatorId: operatorId.toString(),
      workOrderId: assignedWorkOrderId.toString(),
    });
  });

  it('denies rescheduling a calendar event for a machine not assigned to the Operator', async () => {
    workOrderModel.findById.mockReturnValue(
      queryResult({ _id: assignedWorkOrderId, machine_id: unassignedMachineId }),
    );

    await expect(
      service.rescheduleCalendarEvent(operatorId.toString(), assignedWorkOrderId.toString(), {
        newDueDate: '2026-08-01T08:00:00.000Z',
        reason: 'Machine unavailable',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrdersService.rescheduleWorkOrderForOperator).not.toHaveBeenCalled();
  });

  it('delegates rescheduling a calendar event once machine assignment is verified', async () => {
    await service.rescheduleCalendarEvent(
      operatorId.toString(),
      assignedWorkOrderId.toString(),
      { newDueDate: '2026-08-01T08:00:00.000Z', reason: 'Machine unavailable' },
    );

    expect(workOrdersService.rescheduleWorkOrderForOperator).toHaveBeenCalledWith({
      operatorId: operatorId.toString(),
      workOrderId: assignedWorkOrderId.toString(),
      newDueDate: '2026-08-01T08:00:00.000Z',
      reason: 'Machine unavailable',
    });
  });
});
