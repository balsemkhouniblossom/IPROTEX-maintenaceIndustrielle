import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { COMPLETED_WORK_ORDER_STATUSES } from '../../common/work-order-status';
import { KpiService } from '../../kpi/kpi.service';
import { buildDateRangeFilter } from '../report-date-filter.util';
import {
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

/** One row per technician: current open-order load (`KpiService.computeWorkload()`, the exact figure the Admin dashboard's workload chart already shows) alongside how many work orders they closed within the requested date range — a snapshot and a historical count side by side, since no existing method covers date-ranged workload. */
@Injectable()
export class TechnicianWorkloadReportProvider implements ReportDataProvider {
  readonly type = ReportType.TECHNICIAN_WORKLOAD;

  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    private readonly kpiService: KpiService,
  ) {}

  async buildDataset(params: ReportParams): Promise<ReportDataset> {
    const currentWorkload = await this.kpiService.computeWorkload();

    const dateFilter = buildDateRangeFilter(params.dateFrom, params.dateTo);
    const closedRows = await this.workOrderModel
      .aggregate<{ _id: Types.ObjectId; closedCount: number }>([
        {
          $match: {
            status: { $in: COMPLETED_WORK_ORDER_STATUSES },
            technician_id: { $exists: true, $ne: null },
            ...(dateFilter ? { date_created: dateFilter } : {}),
          },
        },
        { $group: { _id: '$technician_id', closedCount: { $sum: 1 } } },
      ])
      .exec();
    const closedCountByTechnicianId = new Map(
      closedRows.map((row) => [row._id.toString(), row.closedCount]),
    );

    const technicianIds = new Set([
      ...currentWorkload.map((w) => w.technicianId),
      ...closedRows.map((r) => r._id.toString()),
    ]);

    const rows = [...technicianIds].map((technicianId) => {
      const current = currentWorkload.find(
        (w) => w.technicianId === technicianId,
      );
      return {
        technician: current?.name ?? technicianId,
        open_work_orders: current?.openCount ?? 0,
        closed_in_period: closedCountByTechnicianId.get(technicianId) ?? 0,
      };
    });
    rows.sort((a, b) => b.open_work_orders - a.open_work_orders);

    return {
      title: 'Technician Workload Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'technician', label: 'Technician' },
        { key: 'open_work_orders', label: 'Currently Open' },
        { key: 'closed_in_period', label: 'Closed In Period' },
      ],
      rows,
      summary: [{ label: 'Technicians', value: rows.length }],
    };
  }
}
