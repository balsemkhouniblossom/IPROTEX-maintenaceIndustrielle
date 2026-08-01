import { Injectable } from '@nestjs/common';
import * as businessTime from '../../common/business-time';
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

const DEFAULT_MONTHS_BACK = 6;
const MAX_BUCKETS = 24;

/** One row per calendar month in the requested range: MTTR, MTBF, and availability%, each computed by `KpiService.computeMttrMtbf` scoped to that single month — a genuine trend line built entirely out of the same per-scope aggregate the Admin dashboard's MTTR/MTBF card already shows, called once per bucket instead of once. */
@Injectable()
export class MttrMtbfTrendsReportProvider implements ReportDataProvider {
  readonly type = ReportType.MTTR_MTBF_TRENDS;

  constructor(
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

    const now = new Date();
    const rangeEnd =
      params.dateTo ??
      businessTime.addBusinessDays(businessTime.startOfBusinessDay(now), 1);
    const rangeStart =
      params.dateFrom ??
      businessTime.addBusinessMonths(
        businessTime.startOfBusinessMonth(rangeEnd),
        -DEFAULT_MONTHS_BACK,
      );

    const buckets: Array<{ start: Date; end: Date }> = [];
    let cursor = businessTime.startOfBusinessMonth(rangeStart);
    while (cursor < rangeEnd && buckets.length < MAX_BUCKETS) {
      const next = businessTime.addBusinessMonths(cursor, 1);
      buckets.push({ start: cursor, end: next < rangeEnd ? next : rangeEnd });
      cursor = next;
    }

    const rows: Array<Record<string, string | number>> = [];
    for (const bucket of buckets) {
      const result = await this.kpiService.computeMttrMtbf({
        machineIds: machineIds?.map((id) => id.toString()),
        dateFrom: bucket.start,
        dateTo: bucket.end,
      });
      rows.push({
        period: bucket.start.toISOString().slice(0, 7), // YYYY-MM
        mttr_hours: result.mttrHours,
        mtbf_hours: result.mtbfHours,
        availability_percent: result.availabilityPercent,
        sample_size: result.sampleSize,
      });
    }

    return {
      title: 'MTTR / MTBF Trends Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'period', label: 'Month' },
        { key: 'mttr_hours', label: 'MTTR (hours)' },
        { key: 'mtbf_hours', label: 'MTBF (hours)' },
        { key: 'availability_percent', label: 'Availability %' },
        { key: 'sample_size', label: 'Sample Size' },
      ],
      rows,
      summary: [{ label: 'Months covered', value: rows.length }],
    };
  }
}
