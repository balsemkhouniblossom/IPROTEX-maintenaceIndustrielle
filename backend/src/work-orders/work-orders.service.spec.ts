import { Types } from 'mongoose';
import { WorkOrdersService } from './work-orders.service';

/**
 * `WorkOrdersService` is a pure compatibility facade: every method here
 * delegates unchanged to its canonical owning service (see the extracted
 * `services/*.service.ts` files, each covered by its own dedicated spec).
 * These tests exist only to prove the delegation wiring itself — argument
 * pass-through, return-value pass-through, and error propagation — not to
 * re-test business logic that already has a home elsewhere.
 */
describe('WorkOrdersService facade delegation', () => {
  let queryService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
  };
  let preventiveSchedulingService: {
    triggerScheduler: jest.Mock;
    scheduleFirstPreventiveOccurrence: jest.Mock;
    createInitialOccurrenceForPlan: jest.Mock;
    reschedulePreventiveOccurrence: jest.Mock;
  };
  let partsService: {
    requestPartsForOperator: jest.Mock;
    decidePartRequest: jest.Mock;
  };
  let reportService: {
    applyValidationDecision: jest.Mock;
    createCorrectiveReportForOperator: jest.Mock;
    submitPreventiveMaintenanceForOperator: jest.Mock;
  };
  let calendarQueryService: {
    getCalendarEventsForOperator: jest.Mock;
    getCalendarEventDetailsForOperator: jest.Mock;
    getTimelineForOperator: jest.Mock;
    getCalendarEvents: jest.Mock;
    getCalendarEventDetails: jest.Mock;
    getTimeline: jest.Mock;
  };
  let dashboardQueryService: {
    getStatistics: jest.Mock;
    getMachinePreventiveStates: jest.Mock;
    getCalendarWidgetForOperator: jest.Mock;
    getNotificationCardsForOperator: jest.Mock;
    getDashboardCalendarWidget: jest.Mock;
    getNotificationCards: jest.Mock;
  };
  let assistantContextService: { getCorrectiveAssistant: jest.Mock };
  let commandService: {
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let operatorCommandService: {
    startWorkOrderForOperator: jest.Mock;
    completeWorkOrderForOperator: jest.Mock;
    rescheduleWorkOrderForOperator: jest.Mock;
  };
  let kpiService: { updateKpiForMachine: jest.Mock };
  let service: WorkOrdersService;

  beforeEach(() => {
    queryService = { findAll: jest.fn(), findOne: jest.fn() };
    preventiveSchedulingService = {
      triggerScheduler: jest.fn(),
      scheduleFirstPreventiveOccurrence: jest.fn(),
      createInitialOccurrenceForPlan: jest.fn(),
      reschedulePreventiveOccurrence: jest.fn(),
    };
    partsService = {
      requestPartsForOperator: jest.fn(),
      decidePartRequest: jest.fn(),
    };
    reportService = {
      applyValidationDecision: jest.fn(),
      createCorrectiveReportForOperator: jest.fn(),
      submitPreventiveMaintenanceForOperator: jest.fn(),
    };
    calendarQueryService = {
      getCalendarEventsForOperator: jest.fn(),
      getCalendarEventDetailsForOperator: jest.fn(),
      getTimelineForOperator: jest.fn(),
      getCalendarEvents: jest.fn(),
      getCalendarEventDetails: jest.fn(),
      getTimeline: jest.fn(),
    };
    dashboardQueryService = {
      getStatistics: jest.fn(),
      getMachinePreventiveStates: jest.fn(),
      getCalendarWidgetForOperator: jest.fn(),
      getNotificationCardsForOperator: jest.fn(),
      getDashboardCalendarWidget: jest.fn(),
      getNotificationCards: jest.fn(),
    };
    assistantContextService = { getCorrectiveAssistant: jest.fn() };
    commandService = {
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    operatorCommandService = {
      startWorkOrderForOperator: jest.fn(),
      completeWorkOrderForOperator: jest.fn(),
      rescheduleWorkOrderForOperator: jest.fn(),
    };
    kpiService = { updateKpiForMachine: jest.fn() };

    service = new WorkOrdersService(
      queryService as never,
      preventiveSchedulingService as never,
      partsService as never,
      reportService as never,
      calendarQueryService as never,
      dashboardQueryService as never,
      assistantContextService as never,
      commandService as never,
      operatorCommandService as never,
      kpiService as never,
    );
  });

  it('create delegates to WorkOrderCommandService', async () => {
    const dto = { ot_id: 'WO-1' } as never;
    const expected = { _id: 'wo-1' };
    commandService.create.mockResolvedValue(expected);

    await expect(service.create(dto)).resolves.toBe(expected);
    expect(commandService.create).toHaveBeenCalledWith(dto);
  });

  it('findAll delegates to WorkOrderQueryService', async () => {
    const expected = { items: [], totalItems: 0, page: 1, limit: 10 };
    queryService.findAll.mockResolvedValue(expected);

    await expect(service.findAll(1, 10, 0, { search: 'x' })).resolves.toBe(
      expected,
    );
    expect(queryService.findAll).toHaveBeenCalledWith(1, 10, 0, {
      search: 'x',
    });
  });

  it('findOne delegates to WorkOrderQueryService', async () => {
    const expected = { _id: 'wo-1' };
    queryService.findOne.mockResolvedValue(expected);

    await expect(service.findOne('wo-1')).resolves.toBe(expected);
    expect(queryService.findOne).toHaveBeenCalledWith('wo-1');
  });

  it('update delegates to WorkOrderCommandService', async () => {
    const dto = { description: 'edit' } as never;
    const expected = { _id: 'wo-1' };
    commandService.update.mockResolvedValue(expected);

    await expect(service.update('wo-1', dto)).resolves.toBe(expected);
    expect(commandService.update).toHaveBeenCalledWith('wo-1', dto);
  });

  it('remove delegates to WorkOrderCommandService', async () => {
    const expected = { _id: 'wo-1' };
    commandService.remove.mockResolvedValue(expected);

    await expect(service.remove('wo-1')).resolves.toBe(expected);
    expect(commandService.remove).toHaveBeenCalledWith('wo-1');
  });

  it('getStatistics delegates to WorkOrderDashboardQueryService', async () => {
    const expected = { totalWorkOrders: 5 };
    dashboardQueryService.getStatistics.mockResolvedValue(expected);

    await expect(service.getStatistics()).resolves.toBe(expected);
  });

  it('triggerScheduler delegates to WorkOrderPreventiveSchedulingService', async () => {
    const context = { shouldContinue: jest.fn(() => true) } as never;
    const expected = { source: 'manual', createdNextExecution: 1 };
    preventiveSchedulingService.triggerScheduler.mockResolvedValue(expected);

    await expect(service.triggerScheduler('cron', context)).resolves.toBe(
      expected,
    );
    expect(preventiveSchedulingService.triggerScheduler).toHaveBeenCalledWith(
      'cron',
      context,
    );
  });

  describe('applyValidationAction', () => {
    it('delegates the decision to WorkOrderReportService and triggers KPI recomputation on a fresh approval', async () => {
      const machineId = new Types.ObjectId();
      const updated = { machine_id: machineId };
      reportService.applyValidationDecision.mockResolvedValue(updated);

      const result = await service.applyValidationAction(
        'wo-1',
        'approve',
        'validator-1',
      );

      expect(reportService.applyValidationDecision).toHaveBeenCalledWith({
        workOrderId: 'wo-1',
        action: 'approve',
        validatorId: 'validator-1',
      });
      expect(kpiService.updateKpiForMachine).toHaveBeenCalledWith(
        machineId.toString(),
      );
      expect(result).toBe(updated);
    });

    it('does not trigger KPI recomputation on rejection', async () => {
      reportService.applyValidationDecision.mockResolvedValue({
        machine_id: new Types.ObjectId(),
      });

      await service.applyValidationAction('wo-1', 'reject', 'validator-1');

      expect(kpiService.updateKpiForMachine).not.toHaveBeenCalled();
    });

    it('does not trigger KPI recomputation when the decision was already applied (idempotent replay)', async () => {
      const alreadyApplied: Record<string, unknown> = {
        machine_id: new Types.ObjectId(),
      };
      Object.defineProperty(alreadyApplied, '__validationAlreadyApplied', {
        value: true,
        enumerable: false,
      });
      reportService.applyValidationDecision.mockResolvedValue(alreadyApplied);

      await service.applyValidationAction('wo-1', 'approve', 'validator-1');

      expect(kpiService.updateKpiForMachine).not.toHaveBeenCalled();
    });

    it('does not trigger KPI recomputation when the report service returns null', async () => {
      reportService.applyValidationDecision.mockResolvedValue(null);

      const result = await service.applyValidationAction(
        'wo-1',
        'approve',
        'validator-1',
      );

      expect(kpiService.updateKpiForMachine).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  it('getMachinePreventiveStates delegates to WorkOrderDashboardQueryService', async () => {
    const expected = { machineId: 'm-1' };
    dashboardQueryService.getMachinePreventiveStates.mockResolvedValue(
      expected,
    );

    await expect(service.getMachinePreventiveStates('m-1')).resolves.toBe(
      expected,
    );
    expect(
      dashboardQueryService.getMachinePreventiveStates,
    ).toHaveBeenCalledWith('m-1');
  });

  it('scheduleFirstPreventiveOccurrence delegates to WorkOrderPreventiveSchedulingService', async () => {
    const input = {
      machineId: 'machine',
      planId: 'plan',
      scheduledDate: '2026-08-02',
      operatorId: 'operator',
    };
    const expected = {
      occurrence: { _id: 'wo' },
      schedulingState: 'scheduled',
    };
    preventiveSchedulingService.scheduleFirstPreventiveOccurrence.mockResolvedValue(
      expected,
    );

    await expect(
      service.scheduleFirstPreventiveOccurrence(input),
    ).resolves.toBe(expected);
    expect(
      preventiveSchedulingService.scheduleFirstPreventiveOccurrence,
    ).toHaveBeenCalledWith(input);
  });

  it('createInitialOccurrenceForPlan delegates to WorkOrderPreventiveSchedulingService, preserving null skips', async () => {
    preventiveSchedulingService.createInitialOccurrenceForPlan.mockResolvedValue(
      null,
    );

    await expect(
      service.createInitialOccurrenceForPlan('plan-id'),
    ).resolves.toBeNull();
    expect(
      preventiveSchedulingService.createInitialOccurrenceForPlan,
    ).toHaveBeenCalledWith('plan-id');
  });

  it('reschedulePreventiveOccurrence delegates to WorkOrderPreventiveSchedulingService, preserving thrown errors', async () => {
    const error = new Error('Invalid new_due_date');
    const input = {
      workOrderId: 'wo',
      newDueDate: 'bad',
      reason: 'mistyped date',
      userId: 'user',
      role: 'operator',
    };
    preventiveSchedulingService.reschedulePreventiveOccurrence.mockRejectedValue(
      error,
    );

    await expect(service.reschedulePreventiveOccurrence(input)).rejects.toBe(
      error,
    );
    expect(
      preventiveSchedulingService.reschedulePreventiveOccurrence,
    ).toHaveBeenCalledWith(input);
  });

  it('createCorrectiveReportForOperator delegates to WorkOrderReportService', async () => {
    const input = {
      operatorId: 'op',
      machineId: 'm',
      codePanne: 'F1',
      actions: ['reset'],
    };
    const expected = { workOrder: {}, report: {}, duplicate: false };
    reportService.createCorrectiveReportForOperator.mockResolvedValue(expected);

    await expect(
      service.createCorrectiveReportForOperator(input),
    ).resolves.toBe(expected);
    expect(
      reportService.createCorrectiveReportForOperator,
    ).toHaveBeenCalledWith(input);
  });

  it('submitPreventiveMaintenanceForOperator delegates to WorkOrderReportService', async () => {
    const input = {
      operatorId: 'op',
      workOrderId: 'wo',
      tasksCompleted: ['check'],
      condition: 'good',
    };
    const expected = { workOrder: {}, report: {}, lubricationLog: null };
    reportService.submitPreventiveMaintenanceForOperator.mockResolvedValue(
      expected,
    );

    await expect(
      service.submitPreventiveMaintenanceForOperator(input),
    ).resolves.toBe(expected);
    expect(
      reportService.submitPreventiveMaintenanceForOperator,
    ).toHaveBeenCalledWith(input);
  });

  it('requestPartsForOperator delegates to WorkOrderPartsService', async () => {
    const input = {
      operatorId: 'op',
      workOrderId: 'wo',
      partId: 'part',
      quantity: 1,
    };
    const expected = { _id: 'pr-1' };
    partsService.requestPartsForOperator.mockResolvedValue(expected);

    await expect(service.requestPartsForOperator(input)).resolves.toBe(
      expected,
    );
    expect(partsService.requestPartsForOperator).toHaveBeenCalledWith(input);
  });

  it('decidePartRequest delegates to WorkOrderPartsService', async () => {
    const input = {
      requestId: 'pr-1',
      decision: 'approve' as const,
      deciderId: 'admin',
    };
    const expected = { _id: 'pr-1', status: 'reserved' };
    partsService.decidePartRequest.mockResolvedValue(expected);

    await expect(service.decidePartRequest(input)).resolves.toBe(expected);
    expect(partsService.decidePartRequest).toHaveBeenCalledWith(input);
  });

  it('getCalendarEventsForOperator delegates to WorkOrderCalendarQueryService', async () => {
    const date = new Date('2026-07-16T12:00:00.000Z');
    const expected = { items: [] };
    calendarQueryService.getCalendarEventsForOperator.mockResolvedValue(
      expected,
    );

    await expect(
      service.getCalendarEventsForOperator('month', date, 'op', {}),
    ).resolves.toBe(expected);
    expect(
      calendarQueryService.getCalendarEventsForOperator,
    ).toHaveBeenCalledWith('month', date, 'op', {});
  });

  it('getCalendarEventDetailsForOperator delegates to WorkOrderCalendarQueryService', async () => {
    const expected = { id: 'wo-1' };
    calendarQueryService.getCalendarEventDetailsForOperator.mockResolvedValue(
      expected,
    );

    await expect(
      service.getCalendarEventDetailsForOperator('wo-1', 'op'),
    ).resolves.toBe(expected);
    expect(
      calendarQueryService.getCalendarEventDetailsForOperator,
    ).toHaveBeenCalledWith('wo-1', 'op');
  });

  it('getCalendarWidgetForOperator delegates to WorkOrderDashboardQueryService', async () => {
    const expected = { today: [] };
    dashboardQueryService.getCalendarWidgetForOperator.mockResolvedValue(
      expected,
    );

    await expect(service.getCalendarWidgetForOperator('op')).resolves.toBe(
      expected,
    );
    expect(
      dashboardQueryService.getCalendarWidgetForOperator,
    ).toHaveBeenCalledWith('op');
  });

  it('getNotificationCardsForOperator delegates to WorkOrderDashboardQueryService', async () => {
    const expected = [{ key: 'upcoming_maintenance' }];
    dashboardQueryService.getNotificationCardsForOperator.mockResolvedValue(
      expected,
    );

    await expect(service.getNotificationCardsForOperator('op')).resolves.toBe(
      expected,
    );
    expect(
      dashboardQueryService.getNotificationCardsForOperator,
    ).toHaveBeenCalledWith('op');
  });

  it('getTimelineForOperator delegates to WorkOrderCalendarQueryService', async () => {
    const date = new Date('2026-07-20T00:00:00.000Z');
    const expected = { today: [] };
    calendarQueryService.getTimelineForOperator.mockResolvedValue(expected);

    await expect(
      service.getTimelineForOperator(date, 'op', 'machine-1'),
    ).resolves.toBe(expected);
    expect(calendarQueryService.getTimelineForOperator).toHaveBeenCalledWith(
      date,
      'op',
      'machine-1',
    );
  });

  it('startWorkOrderForOperator delegates to WorkOrderOperatorCommandService', async () => {
    const scope = { operatorId: 'op', workOrderId: 'wo' };
    const expected = { _id: 'wo', status: 'in_progress' };
    operatorCommandService.startWorkOrderForOperator.mockResolvedValue(
      expected,
    );

    await expect(service.startWorkOrderForOperator(scope)).resolves.toBe(
      expected,
    );
    expect(
      operatorCommandService.startWorkOrderForOperator,
    ).toHaveBeenCalledWith(scope);
  });

  it('completeWorkOrderForOperator delegates to WorkOrderOperatorCommandService', async () => {
    const scope = { operatorId: 'op', workOrderId: 'wo' };
    const expected = { _id: 'wo', status: 'waiting_validation' };
    operatorCommandService.completeWorkOrderForOperator.mockResolvedValue(
      expected,
    );

    await expect(service.completeWorkOrderForOperator(scope)).resolves.toBe(
      expected,
    );
    expect(
      operatorCommandService.completeWorkOrderForOperator,
    ).toHaveBeenCalledWith(scope);
  });

  it('rescheduleWorkOrderForOperator delegates to WorkOrderOperatorCommandService', async () => {
    const input = {
      operatorId: 'op',
      workOrderId: 'wo',
      newDueDate: '2026-08-01T00:00:00.000Z',
      reason: 'unavailable',
    };
    const expected = { occurrence: {}, schedulingState: 'scheduled' };
    operatorCommandService.rescheduleWorkOrderForOperator.mockResolvedValue(
      expected,
    );

    await expect(service.rescheduleWorkOrderForOperator(input)).resolves.toBe(
      expected,
    );
    expect(
      operatorCommandService.rescheduleWorkOrderForOperator,
    ).toHaveBeenCalledWith(input);
  });

  it('getCalendarEvents delegates to WorkOrderCalendarQueryService', async () => {
    const date = new Date('2026-07-16T12:00:00.000Z');
    const expected = { items: [] };
    calendarQueryService.getCalendarEvents.mockResolvedValue(expected);

    await expect(service.getCalendarEvents('month', date, {})).resolves.toBe(
      expected,
    );
    expect(calendarQueryService.getCalendarEvents).toHaveBeenCalledWith(
      'month',
      date,
      {},
    );
  });

  it('getCalendarEventDetails delegates to WorkOrderCalendarQueryService', async () => {
    const expected = { id: 'wo-1' };
    calendarQueryService.getCalendarEventDetails.mockResolvedValue(expected);

    await expect(service.getCalendarEventDetails('wo-1')).resolves.toBe(
      expected,
    );
    expect(calendarQueryService.getCalendarEventDetails).toHaveBeenCalledWith(
      'wo-1',
    );
  });

  it('getTimeline delegates to WorkOrderCalendarQueryService', async () => {
    const date = new Date('2026-07-16T12:00:00.000Z');
    const expected = { today: [] };
    calendarQueryService.getTimeline.mockResolvedValue(expected);

    await expect(
      service.getTimeline(date, 'machine-1', 'tech-1'),
    ).resolves.toBe(expected);
    expect(calendarQueryService.getTimeline).toHaveBeenCalledWith(
      date,
      'machine-1',
      'tech-1',
    );
  });

  it('getDashboardCalendarWidget delegates to WorkOrderDashboardQueryService', async () => {
    const scope = { technicianId: 'tech-1' };
    const expected = { today: [] };
    dashboardQueryService.getDashboardCalendarWidget.mockResolvedValue(
      expected,
    );

    await expect(service.getDashboardCalendarWidget(scope)).resolves.toBe(
      expected,
    );
    expect(
      dashboardQueryService.getDashboardCalendarWidget,
    ).toHaveBeenCalledWith(scope);
  });

  it('getNotificationCards delegates to WorkOrderDashboardQueryService', async () => {
    const scope = { technicianId: 'tech-1' };
    const expected = [{ key: 'upcoming_maintenance' }];
    dashboardQueryService.getNotificationCards.mockResolvedValue(expected);

    await expect(service.getNotificationCards(scope)).resolves.toBe(expected);
    expect(dashboardQueryService.getNotificationCards).toHaveBeenCalledWith(
      scope,
    );
  });

  it('getCorrectiveAssistant delegates to WorkOrderAssistantContextService', async () => {
    const expected = { pannes: [], documents: [] };
    assistantContextService.getCorrectiveAssistant.mockResolvedValue(expected);

    await expect(service.getCorrectiveAssistant('machine-1')).resolves.toBe(
      expected,
    );
    expect(assistantContextService.getCorrectiveAssistant).toHaveBeenCalledWith(
      'machine-1',
    );
  });

  it('updateKpiForMachine delegates to WorkOrderKpiService', async () => {
    kpiService.updateKpiForMachine.mockResolvedValue(undefined);

    await service.updateKpiForMachine('machine-1');

    expect(kpiService.updateKpiForMachine).toHaveBeenCalledWith('machine-1');
  });
});
