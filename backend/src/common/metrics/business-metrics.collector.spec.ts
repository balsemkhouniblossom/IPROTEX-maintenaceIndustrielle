import { BusinessMetricsCollector } from './business-metrics.collector';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('BusinessMetricsCollector', () => {
  let workOrderModel: {
    countDocuments: jest.Mock;
    aggregate: jest.Mock;
  };
  let interventionReportModel: {
    countDocuments: jest.Mock;
  };
  let kpiService: {
    computeStockAlerts: jest.Mock;
  };
  let collector: BusinessMetricsCollector;

  beforeEach(() => {
    workOrderModel = {
      countDocuments: jest.fn().mockReturnValue(execResult(3)),
      aggregate: jest.fn().mockReturnValue(execResult([{ totalHours: 7.125 }])),
    };
    interventionReportModel = {
      countDocuments: jest.fn().mockReturnValue(execResult(5)),
    };
    kpiService = {
      computeStockAlerts: jest.fn().mockResolvedValue({ count: 2, items: [] }),
    };
    collector = new BusinessMetricsCollector(
      workOrderModel as never,
      interventionReportModel as never,
      kpiService as never,
    );
  });

  it('collects business metrics from the real application data owners', async () => {
    await expect(collector.collect()).resolves.toEqual({
      openWorkOrders: 3,
      machineDowntimeHours: 7.13,
      completedInterventions: 5,
      lowStockItems: 2,
    });

    expect(kpiService.computeStockAlerts).toHaveBeenCalledTimes(1);
  });

  it('counts open work orders by excluding the shared closed status list', async () => {
    await collector.collect();

    expect(workOrderModel.countDocuments).toHaveBeenCalledWith({
      status: {
        $nin: [
          'completed',
          'validated',
          'cancelled',
          'canceled',
          'CLOTURE',
          'ANNULE',
        ],
      },
    });
  });

  it('computes completed corrective downtime with the same date fallback as reports', async () => {
    await collector.collect();

    expect(workOrderModel.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          $match: {
            type_maintenance: { $regex: /correct/i },
            status: { $in: ['completed', 'validated', 'CLOTURE'] },
          },
        },
        {
          $project: {
            start: { $ifNull: ['$date_start', '$date_created'] },
            end: { $ifNull: ['$date_end', '$date_closed'] },
          },
        },
      ]),
    );
  });

  it('counts intervention reports with a completed end date', async () => {
    await collector.collect();

    expect(interventionReportModel.countDocuments).toHaveBeenCalledWith({
      date_fin: { $exists: true, $ne: null },
    });
  });
});
