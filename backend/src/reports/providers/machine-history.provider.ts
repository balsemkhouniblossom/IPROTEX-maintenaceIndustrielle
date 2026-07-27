import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../../schemas/intervention-report.schema';
import { DocumentAccessService } from '../../documents/document-access.service';
import { buildDateRangeFilter } from '../report-date-filter.util';
import {
  ReportActor,
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

const DEFAULT_LIMIT = 500;

/** Every work order recorded against one machine, joined with its intervention report (root cause / action taken) where one exists — the single-machine "what has happened to this asset" report. */
@Injectable()
export class MachineHistoryReportProvider implements ReportDataProvider {
  readonly type = ReportType.MACHINE_HISTORY;

  constructor(
    @InjectModel(WorkOrder.name) private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

  async buildDataset(params: ReportParams, actor: ReportActor): Promise<ReportDataset> {
    if (!params.machineId) {
      throw new BadRequestException('machineId is required for the machine history report');
    }
    await this.documentAccessService.assertCanAccessMachine(
      { userId: actor.userId, role: actor.role },
      params.machineId,
    );

    const dateFilter = buildDateRangeFilter(params.dateFrom, params.dateTo);
    const workOrders = await this.workOrderModel
      .find({
        machine_id: new Types.ObjectId(params.machineId),
        ...(dateFilter ? { date_created: dateFilter } : {}),
      })
      .populate('technician_id', 'nom_complet')
      .sort({ date_created: -1 })
      .limit(params.limit ?? DEFAULT_LIMIT)
      .exec();

    const reports = await this.interventionReportModel
      .find({ ot_id: { $in: workOrders.map((wo) => wo._id) } })
      .exec();
    const reportByWorkOrderId = new Map(reports.map((r) => [r.ot_id.toString(), r]));

    const rows = workOrders.map((wo) => {
      const report = reportByWorkOrderId.get((wo._id as Types.ObjectId).toString());
      const technician = wo.technician_id as unknown as { nom_complet?: string } | undefined;
      return {
        date: wo.date_created ? wo.date_created.toISOString() : '',
        work_order: wo.ot_id,
        type: wo.type_maintenance ?? '',
        status: wo.status,
        fault_code: wo.code_panne ?? '',
        technician: technician?.nom_complet ?? '',
        description: wo.description ?? '',
        root_cause: report?.cause_racine ?? '',
        action_taken: report?.description_action ?? '',
      };
    });

    return {
      title: 'Machine History Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'work_order', label: 'Work Order' },
        { key: 'type', label: 'Type' },
        { key: 'status', label: 'Status' },
        { key: 'fault_code', label: 'Fault Code' },
        { key: 'technician', label: 'Technician' },
        { key: 'description', label: 'Description' },
        { key: 'root_cause', label: 'Root Cause' },
        { key: 'action_taken', label: 'Action Taken' },
      ],
      rows,
      summary: [{ label: 'Total work orders', value: rows.length }],
    };
  }
}
