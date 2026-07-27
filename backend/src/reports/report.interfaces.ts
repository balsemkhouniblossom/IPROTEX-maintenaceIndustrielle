import { ReportFormat, ReportType } from '../schemas/generated-report.schema';

export type ReportActor = { userId: string; role: string };

/** Normalized, already-parsed filter values every data provider receives — dates are real `Date` objects, never ISO strings. */
export type ReportParams = {
  dateFrom?: Date;
  dateTo?: Date;
  machineId?: string;
  technicianId?: string;
  limit?: number;
};

export type ReportColumn = { key: string; label: string };

export type ReportSummaryEntry = { label: string; value: string | number };

/**
 * The single tabular shape every report — regardless of type — is reduced
 * to before rendering. This is what makes "10 report types x 3 formats"
 * only ever need 3 renderers instead of 30: a data provider's only job is
 * mapping its domain data onto this shape, and a renderer's only job is
 * turning this shape into bytes. Neither side needs to know about the
 * other.
 */
export type ReportDataset = {
  title: string;
  generatedAt: Date;
  parameters: Record<string, unknown>;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  summary?: ReportSummaryEntry[];
};

/**
 * One data provider per `ReportType`, each pulling from whichever existing
 * service already owns that data (`KpiService`, `PredictiveMaintenanceService`,
 * etc.) or, where no existing method covers it, querying the relevant
 * Mongoose model directly with a plain filter — never re-deriving math a
 * service already computes. Registered as a flat array behind the
 * `REPORT_DATA_PROVIDERS` token; the orchestrating `ReportsService` looks
 * one up by `type` and never branches on report type itself.
 */
export interface ReportDataProvider {
  readonly type: ReportType;
  buildDataset(params: ReportParams, actor: ReportActor): Promise<ReportDataset>;
}

export const REPORT_DATA_PROVIDERS = Symbol('REPORT_DATA_PROVIDERS');

/**
 * One renderer per `ReportFormat`, each turning any `ReportDataset` into
 * file bytes. Registered as a flat array behind the `REPORT_RENDERERS`
 * token, looked up by `format` — a future format (e.g. JSON, HTML) is
 * one more provider, no orchestration change.
 */
export interface ReportRenderer {
  readonly format: ReportFormat;
  readonly fileExtension: string;
  readonly contentType: string;
  render(dataset: ReportDataset): Promise<Buffer>;
}

export const REPORT_RENDERERS = Symbol('REPORT_RENDERERS');
