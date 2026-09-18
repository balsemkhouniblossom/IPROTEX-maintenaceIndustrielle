import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderDashboardQueryService } from './work-order-dashboard-query.service';
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

describe('WorkOrderDashboardQueryService', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const machineId = new Types.ObjectId().toHexString();

  let workOrderModel: {
    find: jest.Mock;
    countDocuments: jest.Mock;
    db: { model: jest.Mock };
  };
  let machineModel: { findById: jest.Mock };
  let moduleModel: { find: jest.Mock };
  let maintenancePlanModel: { find: jest.Mock };
  let interventionReportModel: { countDocuments: jest.Mock };
  let kpiService: {
    getAdminDashboard: jest.Mock;
    computeStockAlerts: jest.Mock;
  };
  let mesureModel: { countDocuments: jest.Mock };
  let service: WorkOrderDashboardQueryService;

  beforeEach(() => {
    mesureModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    workOrderModel = {
      find: jest.fn().mockReturnValue(chain([])),
      countDocuments: jest.fn().mockReturnValue(chain(0)),
      db: { model: jest.fn().mockReturnValue(mesureModel) },
    };
    machineModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    moduleModel = { find: jest.fn().mockReturnValue(chain([])) };
    maintenancePlanModel = { find: jest.fn().mockReturnValue(chain([])) };
    interventionReportModel = {
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    kpiService = {
      getAdminDashboard: jest.fn().mockResolvedValue({
        workOrders: {
          currentMonthCount: 5,
          lastMonthCount: 3,
          percentageChange: 66.7,
          totalCount: 42,
        },
      }),
      computeStockAlerts: jest.fn().mockResolvedValue({ count: 2 }),
    };

    service = new WorkOrderDashboardQueryService(
      workOrderModel as never,
      machineModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
      interventionReportModel as never,
      new MaintenanceSchedulingService(),
      kpiService as never,
    );
  });

  describe('getStatistics', () => {
    it('combines KpiService admin totals with the pending-maintenance count', async () => {
      workOrderModel.countDocuments.mockReturnValue(chain(7));

      const result = await service.getStatistics();

      expect(result).toEqual({
        currentMonthWorkOrders: 5,
        lastMonthWorkOrders: 3,
        percentageChange: 66.7,
        pendingMaintenance: 7,
        totalWorkOrders: 42,
      });
      expect(workOrderModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          status: { $in: ['pending', 'open', 'in_progress'] },
        }),
      );
    });
  });

  describe('getMachinePreventiveStates', () => {
    it('rejects an invalid machine id before querying', async () => {
      await expect(
        service.getMachinePreventiveStates('not-an-id'),
      ).rejects.toThrow(BadRequestException);
      expect(machineModel.findById).not.toHaveBeenCalled();
    });

    it('rejects when the machine does not exist', async () => {
      await expect(
        service.getMachinePreventiveStates(machineId),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns an empty preventive-plan summary when the machine has no modules/plans', async () => {
      machineModel.findById.mockReturnValue(chain({ _id: machineId }));

      const result = await service.getMachinePreventiveStates(machineId);

      expect(result.machineId).toBe(machineId);
      expect(result.sections.preventivePlan).toEqual([]);
    });

    it('returns preventive plan summary with orders grouped by plan', async () => {
      const machine = { _id: new Types.ObjectId(), machine_id: 'M-1' };
      const module = {
        _id: new Types.ObjectId(),
        module_id: 'MOD-1',
        localisation: 'Building A',
      };
      const plan = {
        _id: new Types.ObjectId(),
        plan_id: 'PLAN-1',
        maintenance_code: 'MC-1',
        frequence: 1,
        unite_frequence: 'monthly',
        frequence_label: 'Monthly',
      };
      const order = {
        _id: new Types.ObjectId(),
        plan_id: plan._id,
        status: 'scheduled',
        due_date: new Date(),
        execution_date: null,
        date_start: null,
        date_closed: null,
        date_end: null,
        date_created: null,
      };

      machineModel.findById.mockReturnValue(chain(machine));
      moduleModel.find.mockReturnValue(chain([module]));
      maintenancePlanModel.find.mockReturnValue(chain([plan]));
      workOrderModel.find.mockReturnValue(chain([order]));

      const result = await service.getMachinePreventiveStates(machineId);

      expect(result.machineId).toBe(machineId);
      expect(result.sections).toBeDefined();
      expect(result.sections.preventivePlan).toHaveLength(1);
      expect(result.sections.preventivePlan[0].plan).toBeDefined();
    });
  });

  describe('getDashboardCalendarWidget', () => {
    it('returns zeroed buckets when there are no matching work orders', async () => {
      const result = await service.getDashboardCalendarWidget();

      expect(result.counts.today).toBe(0);
      expect(result.counts.overdue).toBe(0);
      expect(result.today).toEqual([]);
    });

    it('scopes the query to the technician when a scope is provided', async () => {
      await service.getDashboardCalendarWidget({ technicianId: operatorId });

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
        }),
        expect.anything(),
      );
    });

    it('classifies work orders into time buckets by due date', async () => {
      const today = new Date('2026-09-18T12:00:00.000Z');
      const yesterday = new Date('2026-09-17T12:00:00.000Z');
      const nextWeek = new Date('2026-09-25T12:00:00.000Z');
      const nextMonth = new Date('2026-10-18T12:00:00.000Z');

      workOrderModel.find.mockReturnValue(
        chain([
          {
            _id: new Types.ObjectId(),
            ot_id: 'WO-1',
            status: 'pending',
            due_date: yesterday,
          },
          {
            _id: new Types.ObjectId(),
            ot_id: 'WO-2',
            status: 'pending',
            due_date: nextWeek,
          },
          {
            _id: new Types.ObjectId(),
            ot_id: 'WO-3',
            status: 'pending',
            due_date: nextMonth,
          },
        ]),
      );

      const result = await service.getDashboardCalendarWidget();

      expect(result.counts.overdue).toBe(1);
      expect(result.counts.nextWeek).toBe(1);
      expect(result.counts.nextMonth).toBe(1);
      expect(result.overdue).toHaveLength(1);
      expect(result.nextWeek).toHaveLength(1);
    });
  });

  describe('getCalendarWidgetForOperator', () => {
    it('scopes the widget to the given operator', async () => {
      await service.getCalendarWidgetForOperator(operatorId);

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
        }),
        expect.anything(),
      );
    });
  });

  describe('getNotificationCards', () => {
    it('returns all eight cards with the critical-alarm and stock-alert counts sourced from their canonical owners', async () => {
      mesureModel.countDocuments.mockResolvedValue(4);
      kpiService.computeStockAlerts.mockResolvedValue({ count: 9 });

      const cards = await service.getNotificationCards();

      const byKey = Object.fromEntries(
        cards.map((card) => [card.key, card.count]),
      );
      expect(byKey.critical_sensor_alarm).toBe(4);
      expect(byKey.stock_alert).toBe(9);
      expect(cards).toHaveLength(8);
    });

    it('scopes the approved-today count to the technician when a scope is provided', async () => {
      await service.getNotificationCards({ technicianId: operatorId });

      expect(interventionReportModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
        }),
      );
    });
  });

  describe('getNotificationCardsForOperator', () => {
    it('scopes the cards to the given operator', async () => {
      await service.getNotificationCardsForOperator(operatorId);

      expect(interventionReportModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
        }),
      );
    });
  });
});
