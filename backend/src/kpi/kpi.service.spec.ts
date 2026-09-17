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
      open: toRows(counts.open),
      inProgress: toRows(counts.inProgress),
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
  let cache: { get: jest.Mock; set: jest.Mock };
  let mttrSource: { calculate: jest.Mock };
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
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    mttrSource = {
      calculate: jest.fn().mockResolvedValue({
        summary: {
          completedRepairs: 0,
          totalRepairMinutes: 0,
          mttrMinutes: null,
        },
      }),
    };

    service = new KpiService(
      workOrderModel as never,
      stockModel as never,
      machineModel as never,
      userModel as never,
      cache as never,
      { calculateMttrMinutes: jest.fn().mockReturnValue(180) } as never,
      mttrSource as never,
    );
  });

  describe('computeWorkOrderStatusCounts', () => {
    it('extracts each facet count from a single aggregation call', async () => {
      workOrderModel.aggregate.mockReturnValue(
        execResult(
          facetResult({
            open: 8,
            inProgress: 2,
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
        openCount: 8,
        inProgressCount: 2,
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
        openCount: 0,
        inProgressCount: 0,
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
    it('uses the shared InterventionReport MTTR source and WorkOrder closures for MTBF', async () => {
      const firstClosure = new Date('2026-07-01T04:00:00.000Z');
      const secondClosure = new Date('2026-07-03T02:00:00.000Z');
      workOrderModel.find.mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(),
            type_maintenance: 'corrective',
            status: 'completed',
            date_closed: firstClosure,
          },
          {
            _id: new Types.ObjectId(),
            type_maintenance: 'corrective',
            status: 'validated',
            date_closed: secondClosure,
          },
        ]),
      );
      mttrSource.calculate.mockResolvedValueOnce({
        summary: {
          completedRepairs: 2,
          totalRepairMinutes: 360,
          mttrMinutes: 180,
        },
      });

      const result = await service.computeMttrMtbf();

      expect(result.mttrMinutes).toBe(180);
      expect(result.mttrHours).toBe(3);
      expect(result.mtbfHours).toBe(46);
      expect(result.sampleSize).toBe(2);
    });

    it('returns null MTTR without inventing a zero mean', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      mttrSource.calculate.mockResolvedValueOnce({
        summary: {
          completedRepairs: 0,
          totalRepairMinutes: 0,
          mttrMinutes: null,
        },
      });

      const result = await service.computeMttrMtbf();

      expect(result.mttrMinutes).toBeNull();
      expect(result.mttrHours).toBeNull();
      expect(result.mtbfHours).toBe(0);
      expect(result.availabilityPercent).toBe(100);
      expect(result.sampleSize).toBe(0);
    });

    it('scopes the shared MTTR source by machine, technician, and completion range', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      mttrSource.calculate.mockResolvedValueOnce({
        summary: {
          completedRepairs: 0,
          totalRepairMinutes: 0,
          mttrMinutes: null,
        },
      });
      const machineId = new Types.ObjectId().toHexString();
      const technicianId = new Types.ObjectId().toHexString();
      const dateFrom = new Date('2026-01-01T00:00:00.000Z');
      const dateTo = new Date('2026-02-01T00:00:00.000Z');

      await service.computeMttrMtbf({
        machineIds: [machineId],
        technicianId,
        dateFrom,
        dateTo,
      });

      expect(mttrSource.calculate).toHaveBeenCalledWith({
        machineIds: [machineId],
        technicianId,
        dateFrom,
        dateTo,
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

    it('passes completion bounds to the shared MTTR source instead of filtering reports by creation date', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      mttrSource.calculate.mockResolvedValueOnce({
        summary: {
          completedRepairs: 0,
          totalRepairMinutes: 0,
          mttrMinutes: null,
        },
      });
      const dateTo = new Date('2026-02-01T00:00:00.000Z');

      await service.computeMttrMtbf({ dateTo });

      expect(mttrSource.calculate).toHaveBeenCalledWith(
        expect.objectContaining({ dateTo }),
      );
    });

    it('combines machine and technician scope in the shared MTTR source', async () => {
      workOrderModel.find.mockReturnValue(findChain([]));
      mttrSource.calculate.mockResolvedValueOnce({
        summary: {
          completedRepairs: 0,
          totalRepairMinutes: 0,
          mttrMinutes: null,
        },
      });
      const machineId = new Types.ObjectId().toString();
      const technicianId = new Types.ObjectId().toString();

      await service.computeMttrMtbf({ machineIds: [machineId], technicianId });

      expect(mttrSource.calculate).toHaveBeenCalledWith({
        machineIds: [machineId],
        technicianId,
      });
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

    it('serves the second call from cache instead of recomputing', async () => {
      const first = await service.getAdminDashboard();
      const callsAfterFirst = workOrderModel.countDocuments.mock.calls.length;
      expect(cache.set).toHaveBeenCalledWith(
        'kpi:admin-dashboard',
        first,
        30_000,
      );

      cache.get.mockResolvedValueOnce(first);
      const second = await service.getAdminDashboard();

      expect(second).toBe(first);
      expect(workOrderModel.countDocuments.mock.calls).toHaveLength(
        callsAfterFirst,
      );
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
        openCount: 0,
        inProgressCount: 0,
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
