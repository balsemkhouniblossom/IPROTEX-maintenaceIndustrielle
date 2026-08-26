import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CLOSED_WORK_ORDER_STATUSES,
  COMPLETED_WORK_ORDER_STATUSES,
} from '../work-order-status';
import { KpiService } from '../../kpi/kpi.service';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../../schemas/intervention-report.schema';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';

export interface BusinessMetricsSnapshot {
  openWorkOrders: number;
  machineDowntimeHours: number;
  completedInterventions: number;
  lowStockItems: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class BusinessMetricsCollector {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    private readonly kpiService: KpiService,
  ) {}

  async collect(): Promise<BusinessMetricsSnapshot> {
    const [
      openWorkOrders,
      machineDowntimeHours,
      completedInterventions,
      stockAlerts,
    ] = await Promise.all([
      this.countOpenWorkOrders(),
      this.computeMachineDowntimeHours(),
      this.countCompletedInterventions(),
      this.kpiService.computeStockAlerts(),
    ]);

    return {
      openWorkOrders,
      machineDowntimeHours,
      completedInterventions,
      lowStockItems: stockAlerts.count,
    };
  }

  private countOpenWorkOrders(): Promise<number> {
    return this.workOrderModel
      .countDocuments({
        status: {
          $nin: CLOSED_WORK_ORDER_STATUSES,
        },
      })
      .exec();
  }

  private async computeMachineDowntimeHours(): Promise<number> {
    const [result] = await this.workOrderModel
      .aggregate<{ totalHours: number }>([
        {
          $match: {
            type_maintenance: { $regex: /correct/i },
            status: { $in: COMPLETED_WORK_ORDER_STATUSES },
          },
        },
        {
          $project: {
            start: { $ifNull: ['$date_start', '$date_created'] },
            end: { $ifNull: ['$date_end', '$date_closed'] },
          },
        },
        {
          $match: {
            start: { $ne: null },
            end: { $ne: null },
          },
        },
        {
          $project: {
            hours: {
              $divide: [{ $subtract: ['$end', '$start'] }, 3_600_000],
            },
          },
        },
        {
          $match: {
            hours: { $gte: 0 },
          },
        },
        {
          $group: {
            _id: null,
            totalHours: { $sum: '$hours' },
          },
        },
      ])
      .exec();

    return round2(result?.totalHours ?? 0);
  }

  private countCompletedInterventions(): Promise<number> {
    return this.interventionReportModel
      .countDocuments({
        date_fin: { $exists: true, $ne: null },
      })
      .exec();
  }
}
