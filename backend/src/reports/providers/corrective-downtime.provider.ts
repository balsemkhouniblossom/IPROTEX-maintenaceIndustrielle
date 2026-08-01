import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import { COMPLETED_WORK_ORDER_STATUSES } from '../../common/work-order-status';
import { DocumentAccessService } from '../../documents/document-access.service';
import { resolveReportMachineScope } from '../report-machine-scope.util';
import { buildDateRangeFilter } from '../report-date-filter.util';
import {
  ReportActor,
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

const DEFAULT_LIMIT = 1000;

/** One row per completed corrective work order: how long the machine was down for it (`date_start`/`date_created` through `date_end`/`date_closed`, in hours) — the same duration definition `KpiService.computeMttrMtbf` uses for MTTR, at per-event detail instead of an average. */
@Injectable()
export class CorrectiveDowntimeReportProvider implements ReportDataProvider {
  readonly type = ReportType.CORRECTIVE_DOWNTIME;

  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

  async buildDataset(
    params: ReportParams,
    actor: ReportActor,
  ): Promise<ReportDataset> {
    const machineIds = await resolveReportMachineScope(
      this.documentAccessService,
      actor,
      params.machineId,
    );
    const dateFilter = buildDateRangeFilter(params.dateFrom, params.dateTo);

    const filter: FilterQuery<WorkOrderDocument> = {
      type_maintenance: { $regex: /correct/i },
      status: { $in: COMPLETED_WORK_ORDER_STATUSES },
      ...(machineIds ? { machine_id: { $in: machineIds } } : {}),
      ...(dateFilter ? { date_created: dateFilter } : {}),
    };

    const workOrders = await this.workOrderModel
      .find(filter)
      .populate('machine_id', 'machine_id reference')
      .sort({ date_created: -1 })
      .limit(params.limit ?? DEFAULT_LIMIT)
      .exec();

    const rows: Array<Record<string, string | number | null>> = [];
    let totalHours = 0;
    for (const wo of workOrders) {
      const start = wo.date_start || wo.date_created;
      const end = wo.date_end || wo.date_closed;
      if (!start || !end) continue;
      const hours =
        Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100;
      if (hours < 0) continue;
      totalHours += hours;

      const machine = wo.machine_id as unknown as {
        machine_id?: string;
        reference?: string;
      };
      rows.push({
        work_order: wo.ot_id,
        machine: machine?.reference
          ? `${machine.machine_id} (${machine.reference})`
          : (machine?.machine_id ?? ''),
        fault_code: wo.code_panne ?? '',
        started: start.toISOString(),
        closed: end.toISOString(),
        downtime_hours: hours,
      });
    }

    return {
      title: 'Corrective Downtime Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'work_order', label: 'Work Order' },
        { key: 'machine', label: 'Machine' },
        { key: 'fault_code', label: 'Fault Code' },
        { key: 'started', label: 'Started' },
        { key: 'closed', label: 'Closed' },
        { key: 'downtime_hours', label: 'Downtime (hours)' },
      ],
      rows,
      summary: [
        { label: 'Corrective events', value: rows.length },
        {
          label: 'Total downtime (hours)',
          value: Math.round(totalHours * 100) / 100,
        },
        {
          label: 'Average downtime (hours)',
          value:
            rows.length > 0
              ? Math.round((totalHours / rows.length) * 100) / 100
              : 0,
        },
      ],
    };
  }
}
