import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderCalendarQueryService } from './work-order-calendar-query.service';
import { MaintenanceSchedulingService } from '../maintenance-scheduling.service';

function chain<T>(value: T) {
  const result: Record<string, jest.Mock> = {};
  const methods = ['find', 'findById', 'populate', 'select', 'sort', 'lean'];
  for (const method of methods) {
    result[method] = jest.fn().mockReturnValue(result);
  }
  result.exec = jest.fn().mockResolvedValue(value);
  return result;
}

describe('WorkOrderCalendarQueryService', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();

  let workOrderModel: { find: jest.Mock; findById: jest.Mock };
  let machineModel: { findById: jest.Mock };
  let moduleModel: { findById: jest.Mock };
  let maintenancePlanModel: { findById: jest.Mock };
  let machineTypeModel: { findById: jest.Mock };
  let documentModel: { find: jest.Mock };
  let otPiecesModel: { find: jest.Mock };
  let interventionReportModel: { find: jest.Mock };
  let userModel: { findById: jest.Mock };
  let reportService: { resolveCorrectiveData: jest.Mock };
  let service: WorkOrderCalendarQueryService;

  beforeEach(() => {
    workOrderModel = {
      find: jest.fn().mockReturnValue(chain([])),
      findById: jest.fn().mockReturnValue(chain(null)),
    };
    machineModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    moduleModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    maintenancePlanModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    machineTypeModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    documentModel = { find: jest.fn().mockReturnValue(chain([])) };
    otPiecesModel = { find: jest.fn().mockReturnValue(chain([])) };
    interventionReportModel = { find: jest.fn().mockReturnValue(chain([])) };
    userModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    reportService = {
      resolveCorrectiveData: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrderCalendarQueryService(
      workOrderModel as never,
      machineModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
      machineTypeModel as never,
      documentModel as never,
      otPiecesModel as never,
      interventionReportModel as never,
      userModel as never,
      new MaintenanceSchedulingService(),
      reportService as never,
    );
  });

  describe('getCalendarEvents', () => {
    it('returns an empty item list with the requested view/date range when nothing matches', async () => {
      const date = new Date('2026-07-16T12:00:00.000Z');

      const result = await service.getCalendarEvents('month', date, {});

      expect(result.view).toBe('month');
      expect(result.items).toEqual([]);
      expect(result.totalItems).toBe(0);
    });

    it('applies machine/technician/status/priority/maintenance-type filters to the query', async () => {
      const date = new Date('2026-07-16T12:00:00.000Z');
      const machineId = new Types.ObjectId().toHexString();
      const technicianId = new Types.ObjectId().toHexString();

      await service.getCalendarEvents('day', date, {
        machineId,
        technicianId,
        maintenanceType: 'preventive',
        status: 'scheduled',
        priority: 'high',
      });

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          machine_id: new Types.ObjectId(machineId),
          technician_id: new Types.ObjectId(technicianId),
          type_maintenance: 'preventive',
          status: 'scheduled',
          priorite: 'high',
        }),
      );
    });

    it('hydrates, sorts, and filters business-readable calendar events', async () => {
      const machineId = new Types.ObjectId();
      const machineTypeId = new Types.ObjectId();
      const technicianId = new Types.ObjectId();
      const moduleId = new Types.ObjectId();
      const planId = new Types.ObjectId();
      const firstId = new Types.ObjectId();
      const secondId = new Types.ObjectId();
      const rows = [
        {
          _id: secondId,
          description: 'Later inspection',
          due_date: new Date('2026-07-20T09:00:00.000Z'),
          status: 'scheduled',
          priorite: 'high',
          type_maintenance: 'preventive',
          machine_id: {
            _id: machineId,
            machine_id: 'M-100',
            model: 'Press X',
            type_id: machineTypeId,
          },
          module_id: {
            _id: moduleId,
            module_id: 'MOD-1',
            localisation: 'Line 1',
          },
          plan_id: {
            _id: planId,
            plan_id: 'PLAN-1',
            instruction: 'Inspect press',
            frequence: 1,
            unite_frequence: 'weekly',
          },
          technician_id: {
            _id: technicianId,
            nom_complet: 'Assigned Operator',
          },
        },
        {
          _id: firstId,
          scheduled_date: new Date('2026-07-18T09:00:00.000Z'),
          status: 'waiting_validation',
          type_maintenance: 'preventive',
          machine_id: {
            _id: machineId,
            machine_id: 'M-100',
            type_id: machineTypeId,
          },
          plan_id: {
            _id: planId,
            plan_id: 'PLAN-1',
            instruction: 'Inspect press',
            frequence: 1,
            unite_frequence: 'weekly',
          },
          technician_id: {
            _id: technicianId,
            nom_complet: 'Assigned Operator',
          },
        },
      ];
      workOrderModel.find.mockReturnValue(chain(rows));
      machineTypeModel.findById.mockReturnValue(
        chain({ _id: machineTypeId, name: 'Hydraulic press' }),
      );

      const result = await service.getCalendarEvents(
        'month',
        new Date('2026-07-16T12:00:00.000Z'),
        {
          machineTypeId: machineTypeId.toHexString(),
          operatorId: technicianId.toHexString(),
          month: 7,
          year: 2026,
        },
      );

      expect(result.items.map((item) => item.id)).toEqual([
        firstId.toHexString(),
        secondId.toHexString(),
      ]);
      expect(result.items[0]).toMatchObject({
        title: 'Inspect press',
        color: 'purple',
        machine: { code: 'M-100', typeName: 'Hydraulic press' },
        assignedOperator: {
          id: technicianId.toHexString(),
          name: 'Assigned Operator',
        },
        frequency: { normalizedUnit: 'weekly', label: '1 x week' },
      });
      expect(machineTypeModel.findById).toHaveBeenCalledWith(
        machineTypeId.toHexString(),
      );
    });
  });

  describe('getCalendarEventsForOperator', () => {
    it('hard-scopes the query to the operator regardless of filters supplied', async () => {
      const date = new Date('2026-07-16T12:00:00.000Z');

      await service.getCalendarEventsForOperator('month', date, operatorId, {});

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
        }),
      );
    });
  });

  describe('getCalendarEventDetails', () => {
    it('returns null when the work order does not exist', async () => {
      workOrderModel.findById.mockReturnValue(chain(null));

      await expect(
        service.getCalendarEventDetails(workOrderId.toHexString()),
      ).resolves.toBeNull();
    });

    it('resolves corrective fault data via the report service only for corrective work orders', async () => {
      workOrderModel.findById.mockReturnValue(
        chain({
          _id: workOrderId,
          type_maintenance: 'corrective',
          code_panne: 'F1',
          machine_id: new Types.ObjectId(),
        }),
      );

      await service.getCalendarEventDetails(workOrderId.toHexString());

      expect(reportService.resolveCorrectiveData).toHaveBeenCalledWith('F1');
    });

    it('does not resolve corrective fault data for a non-corrective work order', async () => {
      workOrderModel.findById.mockReturnValue(
        chain({
          _id: workOrderId,
          type_maintenance: 'preventive',
          machine_id: new Types.ObjectId(),
        }),
      );

      await service.getCalendarEventDetails(workOrderId.toHexString());

      expect(reportService.resolveCorrectiveData).not.toHaveBeenCalled();
    });
  });

  describe('getCalendarEventDetailsForOperator', () => {
    it('rejects an invalid work order id before querying', async () => {
      await expect(
        service.getCalendarEventDetailsForOperator('not-an-id', operatorId),
      ).rejects.toThrow(BadRequestException);
      expect(workOrderModel.findById).not.toHaveBeenCalled();
    });

    it('rejects when the work order does not exist', async () => {
      workOrderModel.findById.mockReturnValue(chain(null));

      await expect(
        service.getCalendarEventDetailsForOperator(
          workOrderId.toHexString(),
          operatorId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the work order is not assigned to this operator', async () => {
      workOrderModel.findById.mockReturnValue(
        chain({
          _id: workOrderId,
          technician_id: new Types.ObjectId(),
        }),
      );

      await expect(
        service.getCalendarEventDetailsForOperator(
          workOrderId.toHexString(),
          operatorId,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns the shared detail projection once ownership is verified', async () => {
      workOrderModel.findById
        .mockReturnValueOnce(
          chain({
            _id: workOrderId,
            technician_id: new Types.ObjectId(operatorId),
          }),
        )
        .mockReturnValueOnce(
          chain({
            _id: workOrderId,
            technician_id: new Types.ObjectId(operatorId),
            machine_id: new Types.ObjectId(),
            type_maintenance: 'preventive',
          }),
        );

      const result = await service.getCalendarEventDetailsForOperator(
        workOrderId.toHexString(),
        operatorId,
      );

      expect(result?.id).toBe(workOrderId.toString());
    });
  });

  describe('getTimeline', () => {
    it('buckets an empty result set with no error', async () => {
      const groups = await service.getTimeline(
        new Date('2026-07-16T00:00:00.000Z'),
      );

      expect(groups).toEqual({
        today: [],
        tomorrow: [],
        nextWeek: [],
        nextMonth: [],
        sixMonths: [],
        oneYear: [],
      });
    });

    it('scopes by machine and technician when provided', async () => {
      const machineId = new Types.ObjectId().toHexString();

      await service.getTimeline(
        new Date('2026-07-16T00:00:00.000Z'),
        machineId,
        operatorId,
      );

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          machine_id: new Types.ObjectId(machineId),
          technician_id: new Types.ObjectId(operatorId),
        }),
      );
    });
  });

  describe('getTimelineForOperator', () => {
    it('forwards date/machine and hard-scopes technician to the operator', async () => {
      const machineId = new Types.ObjectId().toHexString();

      await service.getTimelineForOperator(
        new Date('2026-07-16T00:00:00.000Z'),
        operatorId,
        machineId,
      );

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          machine_id: new Types.ObjectId(machineId),
          technician_id: new Types.ObjectId(operatorId),
        }),
      );
    });
  });

  describe('calendar calculation boundaries', () => {
    it.each([
      ['DAILY', '2 x day'],
      ['WEEKLY', '2 x week'],
      ['MONTHLY', '2 x month'],
      ['QUARTERLY', 'Every 3 months'],
      ['SEMIANNUAL', 'Every 6 months'],
      ['YEARLY', '2 x year'],
      ['PER_LOADING', 'Every loading'],
      ['PER_SHIFT', 'Every shift'],
      ['PER_PRODUCTION_ORDER', 'Every production order'],
      ['CUSTOM', '2 x month'],
    ])('formats %s maintenance frequency', (normalized, expected) => {
      jest
        .spyOn(service['schedulingService'], 'normalizeFrequency')
        .mockReturnValue(normalized as never);
      expect(service['formatFrequency'](2, 'source value')).toBe(expected);
    });

    it.each([
      ['completed', 'green'],
      ['validated', 'green'],
      ['waiting_validation', 'purple'],
    ])('maps %s status to %s', (status, expected) => {
      const now = new Date('2026-07-16T00:00:00.000Z');
      expect(service['computeEventColor'](status, now, now)).toBe(expected);
    });

    it('maps upcoming and overdue date boundaries to colors and reminder stages', () => {
      const now = new Date('2026-07-16T12:00:00.000Z');
      const day = 24 * 60 * 60 * 1000;
      const due = (days: number) => new Date(now.getTime() + days * day);

      expect(service['computeEventColor']('scheduled', due(-1), now)).toBe(
        'red',
      );
      expect(service['computeEventColor']('scheduled', due(3), now)).toBe(
        'orange',
      );
      expect(service['computeEventColor']('scheduled', due(8), now)).toBe(
        'blue',
      );
      expect(service['computeReminderStage']('completed', now, now)).toBe(
        'completed',
      );
      expect(
        [8, 4, 2, 0, -1, -4, -8].map((days) =>
          service['computeReminderStage']('scheduled', due(days), now),
        ),
      ).toEqual([
        'upcoming_7_days',
        'reminder_3_days',
        'reminder_1_day',
        'due_today',
        'overdue_next_day',
        'overdue_notify_technician',
        'overdue_notify_supervisor',
      ]);
    });

    it('computes local and business-timezone day/week/month/year ranges', () => {
      const date = new Date('2026-07-19T12:00:00.000Z');
      for (const view of [
        'day',
        'week',
        'timeline',
        'month',
        'year',
      ] as const) {
        const local = service['getViewDateRange'](view, date);
        const zoned = service['getViewDateRange'](view, date, 'UTC');
        expect(local.rangeStart.getTime()).toBeLessThanOrEqual(
          local.rangeEnd.getTime(),
        );
        expect(zoned.rangeStart.getTime()).toBeLessThanOrEqual(
          zoned.rangeEnd.getTime(),
        );
      }
    });

    it('rejects each optional post-query calendar filter independently', () => {
      const event = {
        machine: { typeId: 'type-a' },
        assignedOperator: { id: 'operator-a', name: 'Operator A' },
        dueDate: '2026-07-16T00:00:00.000Z',
      } as never;

      expect(
        service['matchCalendarFilter'](event, { machineTypeId: 'type-b' }),
      ).toBe(false);
      expect(
        service['matchCalendarFilter'](event, { operatorId: 'operator-b' }),
      ).toBe(false);
      expect(service['matchCalendarFilter'](event, { month: 8 })).toBe(false);
      expect(service['matchCalendarFilter'](event, { year: 2025 })).toBe(false);
      expect(service['matchCalendarFilter'](event, { week: 1 })).toBe(false);
      expect(service['matchCalendarFilter'](event, {})).toBe(true);
    });
  });
});
