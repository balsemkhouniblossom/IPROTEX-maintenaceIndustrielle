import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FaultEvent,
  FaultEventDocument,
  FaultEventSeverity,
} from '../../schemas/fault-event.schema';
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

type FaultAggregateRow = {
  _id: string;
  count: number;
  criticalCount: number;
  lastRaisedAt: Date;
};

/** One row per fault code raised within the requested scope and date range, ranked by frequency — device-reported `FaultEvent`s, the same alarm feed the live-monitoring dashboard and the AI assistant's grounded context both already read from. */
@Injectable()
export class FaultFrequencyReportProvider implements ReportDataProvider {
  readonly type = ReportType.FAULT_FREQUENCY;

  constructor(
    @InjectModel(FaultEvent.name)
    private readonly faultEventModel: Model<FaultEventDocument>,
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

    const aggregateRows = await this.faultEventModel
      .aggregate<FaultAggregateRow>([
        {
          $match: {
            ...(machineIds ? { machine_id: { $in: machineIds } } : {}),
            ...(dateFilter ? { raised_at: dateFilter } : {}),
          },
        },
        {
          $group: {
            _id: '$code_panne',
            count: { $sum: 1 },
            criticalCount: {
              $sum: {
                $cond: [
                  { $eq: ['$severity', FaultEventSeverity.CRITICAL] },
                  1,
                  0,
                ],
              },
            },
            lastRaisedAt: { $max: '$raised_at' },
          },
        },
        { $sort: { count: -1 } },
      ])
      .exec();

    const rows = aggregateRows.map((row) => ({
      fault_code: row._id,
      occurrences: row.count,
      critical_occurrences: row.criticalCount,
      last_raised: row.lastRaisedAt ? row.lastRaisedAt.toISOString() : '',
    }));

    return {
      title: 'Fault Frequency Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'fault_code', label: 'Fault Code' },
        { key: 'occurrences', label: 'Occurrences' },
        { key: 'critical_occurrences', label: 'Critical Occurrences' },
        { key: 'last_raised', label: 'Last Raised' },
      ],
      rows,
      summary: [
        { label: 'Distinct fault codes', value: rows.length },
        {
          label: 'Total events',
          value: rows.reduce((sum, r) => sum + r.occurrences, 0),
        },
      ],
    };
  }
}
