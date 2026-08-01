import { Types } from 'mongoose';
import { KpiService } from './kpi.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function findChain<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  const self = {
    populate: jest.fn().mockReturnValue(chain),
    lean: jest.fn().mockReturnValue(chain),
    sort: jest.fn().mockReturnValue(chain),
    exec: jest.fn().mockResolvedValue(value),
  };
  Object.assign(chain, self);
  return chain;
}

function facetResult(counts: Partial<Record<string, number>>) {
  const toRows = (count?: number) => (count === undefined ? [] : [{ count }]);
  return [
    {
      overdue: toRows(counts.overdue),
      dueToday: toRows(counts.dueToday),
      waitingValidation: toRows(counts.waitingValidation),
      completedToday: toRows(counts.completedToday),
      total: toRows(counts.total),
    },
  ];
}

describe('KpiService', () => {
  let workOrderModel: {
    aggregate: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let stockModel: { find: jest.Mock };
  let machineModel: { countDocuments: jest.Mock };
  let userModel: { find: jest.Mock; countDocuments: jest.Mock };
  let service: KpiService;

  beforeEach(() => {
    workOrderModel = {
      aggregate: jest.fn().mockReturnValue(execResult(facetResult({}))),
      find: jest.fn().mockReturnValue(findChain([])),
      countDocuments: jest.fn().mockReturnValue(execResult(0)),
    };
    stockModel = { find: jest.fn().mockReturnValue(findChain([])) };
    machineModel = { countDocuments: jest.fn().mockReturnValue(execResult(0)) };
    userModel = {
      find: jest.fn().mockReturnValue(findChain([])),
      countDocuments: jest.fn().mockReturnValue(execResult(0)),
    };

    service = new KpiService(
      workOrderModel as never,
      stockModel as never,
      machineModel as never,
      userModel as never,
    );
  });

  describe('computeWorkOrderStatusCounts', () => {
    it('extracts each facet count from a single aggregation call', async () => {
      workOrderModel.aggregate.mockReturnValue(
        execResult(
          facetResult({
            overdue: 3,
            dueToday: 2,
            waitingValidation: 5,
            completedToday: 1,
            total: 42,
          }),
        ),
      );

      const result = await service.computeWorkOrderStatusCounts();

      expect(result).toEqual({
        overdueCount: 3,
        dueTodayCount: 2,
        waitingValidationCount: 5,
        completedTodayCount: 1,
        totalCount: 42,
      });
      expect(workOrderModel.aggregate).toHaveBeenCalledTimes(1);
    });

    it('defaults every facet to 0 when the aggregation returns no rows', async () => {
      workOrderModel.aggregate.mockReturnValue(execResult([]));

      const result = await service.computeWorkOrderStatusCounts();

      expect(result).toEqual({
        overdueCount: 0,
        dueTodayCount: 0,
        waitingValidationCount: 0,
        completedTodayCount: 0,
        totalCount: 0,
      });
    });

    it('scopes the aggregation to a single technician when requested', async () => {
      const technicianId = new Types.ObjectId().toHexString();

      await service.computeWorkOrderStatusCounts({ technicianId });

      const pipeline = workOrderModel.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $match: { technician_id: new Types.ObjectId(technicianId) },
      });
    });

    it('scopes the aggregation to a set of machines when requested', async () => {
      const machineIds = [
        new Types.ObjectId().toHexString(),
        new Types.ObjectId().toHexString(),
      ];

      await service.computeWorkOrderStatusCounts({ machineIds });

      const pipeline = workOrderModel.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $match: {
          machine_id: { $in: machineIds.map((id) => new Types.ObjectId(id)) },
        },
      });
    });
  });

  describe('computeStockAlerts', () => {
    it('alerts when available (on-hand minus reserved) falls to or below the threshold', async () => {
      stockModel.find.mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(),
            stock_id: 'STOCK-1',
            part_id: { _id: new Types.ObjectId(), nom_piece: 'Drive belt' },
            quantite_en_stock: 10,
            quantite_reservee: 8,
            seuil_alerte_stock: 5,
          },
        ]),
      );

      const result = await service.computeStockAlerts();

      expect(result.count).toBe(1);
      expect(result.items[0]).toMatchObject({
        stockCode: 'STOCK-1',
        partLabel: 'Drive belt',
        quantiteEnStock: 10,
        quantiteReservee: 8,
        available: 2,
        threshold: 5,
      });
    });

    it('does not alert when available stock is above the threshold, even if raw on-hand quantity looks low', async () => {
      stockModel.find.mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(),
            stock_id: 'STOCK-2',
            part_id: new Types.ObjectId(),
            quantite_en_stock: 20,
            quantite_reservee: 0,
            seuil_alerte_stock: 5,
          },
        ]),
      );

      const result = await service.computeStockAlerts();

      expect(result.count).toBe(0);
    });

    it('falls back to quantite_minimale when no seuil_alerte_stock is set', async () => {
      stockModel.find.mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(),
            stock_id: 'STOCK-3',
            part_id: new Types.ObjectId(),
            quantite_en_stock: 4,
            quantite_reservee: 0,
            quantite_minimale: 10,
          },
        ]),
      );

      const result = await service.computeStockAlerts();

      expect(result.count).toBe(1);
      expect(result.items[0].threshold).toBe(10);
    });

    it('skips stocks with no threshold configured at all', async () => {
      stockModel.find.mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(),
            stock_id: 'STOCK-4',
            part_id: new Types.ObjectId(),
            quantite_en_stock: 0,
            quantite_reservee: 0,
          },
        ]),
      );

      const result = await service.computeStockAlerts();

      expect(result.count).toBe(0);
    });
  });

  describe('computePreventiveCompliance', () => {
    it('counts an order as on-time when it closed at or before its due date', async () => {
      workOrderModel.find.mockReturnValue(
        findChain([
          {
            due_date: new Date('2026-07-10T00:00:00.000Z'),
            date_closed: new Date('2026-07-09T00:00:00.000Z'),
          },
          {
            due_date: new Date('2026-07-10T00:00:00.000Z'),
            date_end: new Date('2026-07-12T00:00:00.000Z'),
          },
        ]),
      );

      const result = await service.computePreventiveCompliance();

      expect(result).toEqual({
        ratePercent: 50,
        onTimeCount: 1,
        evaluableCount: 2,
      });
    });

    it('excludes orders with no resolvable due date or completion timestamp from both counts', async () => {
      workOrderModel.find.mockReturnValue(
        findChain([
          { due_date: new Date('2026-07-10T00:00:00.000Z') }, // no closed timestamp
          { date_closed: new Date('2026-07-09T00:00:00.000Z') }, // no due date
        ]),
      );

      const result = await service.computePreventiveCompliance();

      expect(result).toEqual({
        ratePercent: 0,
        onTimeCount: 0,
        evaluableCount: 0,
      });
    });

    it('returns a 0% rate (not NaN) when there is nothing to evaluate', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));

      const result = await service.computePreventiveCompliance();

      expect(result.ratePercent).toBe(0);
    });

    it('queries for any non-corrective type (preventive, lubrication, inspection), not just preventive', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));

      await service.computePreventiveCompliance();

      const [filter] = workOrderModel.find.mock.calls[0];
      expect(filter.type_maintenance).toEqual({ $not: /correct/i });
      // $not excludes anything matching /correct/i — 'corrective' matches
      // (and is therefore excluded); the schedulable types do not match
      // (and are therefore included).
      const excludedByFilter = filter.type_maintenance.$not;
      expect('corrective').toMatch(excludedByFilter);
      expect('lubrication').not.toMatch(excludedByFilter);
      expect('inspection').not.toMatch(excludedByFilter);
      expect('preventive').not.toMatch(excludedByFilter);
    });
  });

  describe('computeCorrectiveResponseTime', () => {
    it('averages the hours between date_created and date_start', async () => {
      workOrderModel.find.mockReturnValue(
        findChain([
          {
            date_created: new Date('2026-07-10T00:00:00.000Z'),
            date_start: new Date('2026-07-10T02:00:00.000Z'), // 2h
          },
          {
            date_created: new Date('2026-07-10T00:00:00.000Z'),
            date_start: new Date('2026-07-10T06:00:00.000Z'), // 6h
          },
        ]),
      );

      const result = await service.computeCorrectiveResponseTime();

      expect(result).toEqual({ averageResponseHours: 4, sampleSize: 2 });
    });

    it('ignores an order where date_start precedes date_created (bad data)', async () => {
      workOrderModel.find.mockReturnValue(
        findChain([
          {
            date_created: new Date('2026-07-10T05:00:00.000Z'),
            date_start: new Date('2026-07-10T00:00:00.000Z'),
          },
        ]),
      );

      const result = await service.computeCorrectiveResponseTime();

      expect(result).toEqual({ averageResponseHours: 0, sampleSize: 0 });
    });
  });

  describe('computeMttrMtbf', () => {
    it('computes MTTR as the mean repair duration and MTBF as the mean gap between corrective closures', async () => {
      workOrderModel.find.mockReturnValue(
        findChain([
          {
            type_maintenance: 'corrective',
            date_start: new Date('2026-07-01T00:00:00.000Z'),
            date_end: new Date('2026-07-01T04:00:00.000Z'), // 4h repair
          },
          {
            type_maintenance: 'corrective',
            date_start: new Date('2026-07-03T00:00:00.000Z'),
            date_end: new Date('2026-07-03T02:00:00.000Z'), // 2h repair, closed 48h after the first
          },
        ]),
      );

      const result = await service.computeMttrMtbf();

      expect(result.mttrHours).toBe(3); // (4 + 2) / 2
      // Gap between the two closures: 2026-07-01T04:00 -> 2026-07-03T02:00 = 46h
      expect(result.mtbfHours).toBe(46);
      expect(result.sampleSize).toBe(2);
    });

    it('reports 0 MTBF (and 100% availability) with fewer than two corrective closures', async () => {
      workOrderModel.find.mockReturnValue(
        findChain([
          {
            type_maintenance: 'corrective',
            date_start: new Date('2026-07-01T00:00:00.000Z'),
            date_end: new Date('2026-07-01T04:00:00.000Z'),
          },
        ]),
      );

      const result = await service.computeMttrMtbf();

      expect(result.mtbfHours).toBe(0);
      expect(result.availabilityPercent).toBe(100);
    });

    it('defaults availability to 100% when there is no history at all', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));

      const result = await service.computeMttrMtbf();

      expect(result).toEqual({
        mttrHours: 0,
        mtbfHours: 0,
        availabilityPercent: 100,
        sampleSize: 0,
      });
    });
  });

  describe('WorkOrderScopeFilter date range (dateFrom/dateTo)', () => {
    it('threads dateFrom/dateTo into the date_created filter for computePreventiveCompliance', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');
      const dateTo = new Date('2026-02-01T00:00:00.000Z');

      await service.computePreventiveCompliance({ dateFrom, dateTo });

      const [filter] = workOrderModel.find.mock.calls[0];
      expect(filter.date_created).toEqual({ $gte: dateFrom, $lt: dateTo });
    });

    it('supports an open-ended lower bound (dateFrom only)', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');

      await service.computeCorrectiveResponseTime({ dateFrom });

      const [filter] = workOrderModel.find.mock.calls[0];
      expect(filter.date_created).toEqual({ $gte: dateFrom });
    });

    it('supports an open-ended upper bound (dateTo only)', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      const dateTo = new Date('2026-02-01T00:00:00.000Z');

      await service.computeMttrMtbf({ dateTo });

      const [filter] = workOrderModel.find.mock.calls[0];
      expect(filter.date_created).toEqual({ $lt: dateTo });
    });

    it('omits date_created entirely when no date range is given (unchanged prior behavior)', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));

      await service.computePreventiveCompliance();

      const [filter] = workOrderModel.find.mock.calls[0];
      expect(filter.date_created).toBeUndefined();
    });

    it('combines with machineIds/technicianId scoping', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      const machineId = new Types.ObjectId().toString();
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');

      await service.computeMttrMtbf({ machineIds: [machineId], dateFrom });

      const [filter] = workOrderModel.find.mock.calls[0];
      expect(filter.machine_id).toEqual({
        $in: [new Types.ObjectId(machineId)],
      });
      expect(filter.date_created).toEqual({ $gte: dateFrom });
    });
  });

  describe('computeWorkload', () => {
    it('groups open work orders by technician and attaches a display name', async () => {
      const technicianId = new Types.ObjectId();
      // The real pipeline groups on `{ $toString: '$technician_id' }`, so the
      // driver hands back the id as a string, not an ObjectId.
      workOrderModel.aggregate.mockReturnValue(
        execResult([{ _id: technicianId.toString(), openCount: 4 }]),
      );
      userModel.find.mockReturnValue(
        findChain([{ _id: technicianId, nom_complet: 'Jane Technician' }]),
      );

      const result = await service.computeWorkload();

      expect(result).toEqual([
        {
          technicianId: technicianId.toString(),
          name: 'Jane Technician',
          openCount: 4,
        },
      ]);
    });

    it('returns an empty list without querying users when nobody has open work', async () => {
      workOrderModel.aggregate.mockReturnValue(execResult([]));

      const result = await service.computeWorkload();

      expect(result).toEqual([]);
      expect(userModel.find).not.toHaveBeenCalled();
    });
  });

  describe('getAdminDashboard', () => {
    it('assembles every fleet-wide metric and computes month-over-month percentage change', async () => {
      workOrderModel.aggregate.mockReturnValue(
        execResult(facetResult({ total: 10 })),
      );
      workOrderModel.countDocuments
        .mockReturnValueOnce(execResult(20)) // current month
        .mockReturnValueOnce(execResult(10)); // last month
      machineModel.countDocuments.mockReturnValue(execResult(7));
      userModel.countDocuments.mockReturnValue(execResult(3));

      const result = await service.getAdminDashboard();

      expect(result.workOrders.currentMonthCount).toBe(20);
      expect(result.workOrders.lastMonthCount).toBe(10);
      expect(result.workOrders.percentageChange).toBe(100);
      expect(result.totals).toEqual({ machines: 7, users: 3 });
      expect(result.businessTimezone).toBe('Africa/Tunis');
      expect(result.stockAlerts).toEqual({ count: 0, items: [] });
    });

    it('reports 0% change when there were no work orders last month', async () => {
      workOrderModel.countDocuments
        .mockReturnValueOnce(execResult(5))
        .mockReturnValueOnce(execResult(0));

      const result = await service.getAdminDashboard();

      expect(result.workOrders.percentageChange).toBe(0);
    });
  });

  describe('getTechnicianDashboardCounts', () => {
    it('scopes the shared status-count computation to the given technician', async () => {
      const technicianId = new Types.ObjectId().toHexString();
      workOrderModel.aggregate.mockReturnValue(
        execResult(
          facetResult({
            overdue: 1,
            dueToday: 2,
            waitingValidation: 0,
            completedToday: 3,
          }),
        ),
      );

      const result = await service.getTechnicianDashboardCounts(technicianId);

      expect(result).toEqual({
        overdueCount: 1,
        dueTodayCount: 2,
        waitingValidationCount: 0,
        completedTodayCount: 3,
        totalCount: 0,
      });
      const pipeline = workOrderModel.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $match: { technician_id: new Types.ObjectId(technicianId) },
      });
    });
  });

  describe('getOperatorDashboard', () => {
    it('scopes status counts and summary counters to the operator’s own work orders', async () => {
      const operatorId = new Types.ObjectId().toHexString();
      workOrderModel.countDocuments
        .mockReturnValueOnce(execResult(6)) // assigned
        .mockReturnValueOnce(execResult(2)) // in progress
        .mockReturnValueOnce(execResult(9)); // completed

      const result = await service.getOperatorDashboard(operatorId);

      expect(result.assignedCount).toBe(6);
      expect(result.inProgressCount).toBe(2);
      expect(result.completedCount).toBe(9);
      expect(result.overdueCount).toBe(0);
      expect(typeof result.generatedAt).toBe('string');
    });
  });
});
