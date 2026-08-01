import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import { KpiService } from '../../kpi/kpi.service';
import { DocumentAccessService } from '../../documents/document-access.service';
import { resolveReportMachineScope } from '../report-machine-scope.util';
import {
  ReportActor,
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

/** One row per machine: the fraction of completed preventive work orders that closed at or before their due date, reusing `KpiService.computePreventiveCompliance` — the exact same math the Admin dashboard's compliance card shows, just broken out per machine and date-ranged. */
@Injectable()
export class PreventiveComplianceReportProvider implements ReportDataProvider {
  readonly type = ReportType.PREVENTIVE_COMPLIANCE;

  constructor(
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    private readonly kpiService: KpiService,
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
    const machines = await this.machineModel
      .find(machineIds ? { _id: { $in: machineIds } } : {})
      .select({ machine_id: 1, reference: 1 })
      .exec();

    const rows: Array<Record<string, string | number>> = [];
    let totalOnTime = 0;
    let totalEvaluable = 0;
    for (const machine of machines) {
      const result = await this.kpiService.computePreventiveCompliance({
        machineIds: [machine._id.toString()],
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      });
      totalOnTime += result.onTimeCount;
      totalEvaluable += result.evaluableCount;
      rows.push({
        machine: machine.reference
          ? `${machine.machine_id} (${machine.reference})`
          : machine.machine_id,
        compliance_rate_percent: result.ratePercent,
        on_time_count: result.onTimeCount,
        evaluable_count: result.evaluableCount,
      });
    }

    const overallRate =
      totalEvaluable > 0
        ? Math.round((totalOnTime / totalEvaluable) * 10000) / 100
        : 0;

    return {
      title: 'Preventive Maintenance Compliance Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'machine', label: 'Machine' },
        { key: 'compliance_rate_percent', label: 'Compliance %' },
        { key: 'on_time_count', label: 'On-Time' },
        { key: 'evaluable_count', label: 'Evaluable' },
      ],
      rows,
      summary: [
        { label: 'Machines covered', value: rows.length },
        { label: 'Overall compliance %', value: overallRate },
      ],
    };
  }
}
