import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import * as crypto from 'node:crypto';
import {
  GeneratedReport,
  GeneratedReportDocument,
  ReportStatus,
  DEFAULT_REPORT_RETENTION_MS,
} from '../schemas/generated-report.schema';
import { Role } from '../schemas/user.schema';
import { FileStorageService } from '../storage/file-storage.service';
import { ProtectedStoredFile } from '../storage/file-storage.types';
import { canRequestReportType } from './report-access';
import {
  REPORT_DATA_PROVIDERS,
  REPORT_RENDERERS,
  ReportActor,
  ReportDataProvider,
  ReportParams,
  ReportRenderer,
} from './report.interfaces';
import { RequestReportDto } from './dto/request-report.dto';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { parseSortParam } from '../common/query-params.util';

const DEFAULT_HISTORY_LIMIT = 20;
export const REPORTS_SORT_ALLOWED_FIELDS = [
  'createdAt',
  'type',
  'status',
] as const;
const REPORTS_DEFAULT_SORT: Record<string, 1 | -1> = { createdAt: -1 };

function buildReportsFilter(
  query: ReportsQueryDto = {},
): FilterQuery<GeneratedReportDocument> {
  const filter: FilterQuery<GeneratedReportDocument> = {};
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.format) filter.format = query.format;
  return filter;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(GeneratedReport.name)
    private readonly generatedReportModel: Model<GeneratedReportDocument>,
    @Inject(REPORT_DATA_PROVIDERS)
    private readonly providers: ReportDataProvider[],
    @Inject(REPORT_RENDERERS) private readonly renderers: ReportRenderer[],
    private readonly fileStorageService: FileStorageService,
  ) {}

  /**
   * Creates the `pending` row and returns immediately — generation itself
   * happens in the background (see `generateReport`), never awaited here,
   * so a request for a large export doesn't hold the HTTP connection open
   * while it runs. Callers poll `getReport(id)` for status, then
   * `download(id)` once `status` is `completed`.
   */
  async requestReport(
    dto: RequestReportDto,
    actor: ReportActor,
  ): Promise<GeneratedReportDocument> {
    if (!canRequestReportType(actor.role, dto.type)) {
      throw new ForbiddenException(
        `Your role may not request a ${dto.type} report`,
      );
    }

    const report = await this.generatedReportModel.create({
      report_id: `RPT-${crypto.randomUUID()}`,
      type: dto.type,
      format: dto.format,
      status: ReportStatus.PENDING,
      parameters: dto.parameters ?? {},
      requested_by: new Types.ObjectId(actor.userId),
      requester_role: actor.role,
    });

    void this.generateReport(report._id.toString(), dto, actor).catch(
      (error) => {
        this.logger.error(
          `Unhandled error generating report ${report.report_id}: ${String(error)}`,
        );
      },
    );

    return report;
  }

  /**
   * The actual generation pipeline: normalize params -> find the data
   * provider for this report type -> build the dataset -> find the
   * renderer for this format -> render to bytes -> checksum -> store ->
   * mark completed. Any failure along the way is captured onto the row
   * (`status: failed`, `error_message`) rather than thrown past this
   * method, since — whether called fire-and-forget from `requestReport`
   * or awaited directly by the scheduler/tests — nothing should ever be
   * left stuck on `pending`/`processing`.
   */
  async generateReport(
    reportId: string,
    dto: RequestReportDto,
    actor: ReportActor,
  ): Promise<GeneratedReportDocument> {
    await this.generatedReportModel
      .findByIdAndUpdate(reportId, { status: ReportStatus.PROCESSING })
      .exec();

    try {
      const provider = this.providers.find((p) => p.type === dto.type);
      if (!provider)
        throw new Error(
          `No data provider registered for report type ${dto.type}`,
        );
      const renderer = this.renderers.find((r) => r.format === dto.format);
      if (!renderer)
        throw new Error(
          `No renderer registered for report format ${dto.format}`,
        );

      const params = this.normalizeParams(dto.parameters ?? {});
      const dataset = await provider.buildDataset(params, actor);
      const buffer = await renderer.render(dataset);
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

      const stored = await this.fileStorageService.save({
        buffer,
        fileName: `${reportId}.${renderer.fileExtension}`,
        folder: 'uploads',
        contentType: renderer.contentType,
      });

      const updated = await this.generatedReportModel
        .findByIdAndUpdate(
          reportId,
          {
            status: ReportStatus.COMPLETED,
            file_path: stored.storageKey ?? stored.relativePath,
            file_size_bytes: buffer.length,
            checksum,
            row_count: dataset.rows.length,
            generated_at: new Date(),
            expires_at: new Date(Date.now() + DEFAULT_REPORT_RETENTION_MS),
          },
          { new: true },
        )
        .exec();
      if (!updated) throw new Error('Report row disappeared during generation');
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.generatedReportModel
        .findByIdAndUpdate(
          reportId,
          { status: ReportStatus.FAILED, error_message: message },
          { new: true },
        )
        .exec();
      if (!failed)
        throw new Error('Report row disappeared during failure handling');
      return failed;
    }
  }

  async getReport(
    id: string,
    actor: ReportActor,
  ): Promise<GeneratedReportDocument> {
    const report = await this.generatedReportModel.findById(id).exec();
    if (!report) throw new NotFoundException('Report not found');
    this.assertCanView(report, actor);
    return report;
  }

  async listOwnReports(
    actor: ReportActor,
    query: ReportsQueryDto = {},
  ): Promise<PaginatedResponse<GeneratedReportDocument>> {
    const filter: FilterQuery<GeneratedReportDocument> = {
      ...buildReportsFilter(query),
      requested_by: new Types.ObjectId(actor.userId),
    };
    return this.listReports(filter, query);
  }

  async listAllReports(
    query: ReportsQueryDto = {},
  ): Promise<PaginatedResponse<GeneratedReportDocument>> {
    return this.listReports(buildReportsFilter(query), query);
  }

  private async listReports(
    filter: FilterQuery<GeneratedReportDocument>,
    query: ReportsQueryDto,
  ): Promise<PaginatedResponse<GeneratedReportDocument>> {
    const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
    const limit =
      query.limit && query.limit > 0
        ? Math.min(Math.floor(query.limit), 100)
        : DEFAULT_HISTORY_LIMIT;
    const sort = parseSortParam(
      query.sort,
      REPORTS_SORT_ALLOWED_FIELDS,
      REPORTS_DEFAULT_SORT,
    );

    const [items, totalItems] = await Promise.all([
      this.generatedReportModel
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.generatedReportModel.countDocuments(filter).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async deleteReport(id: string, actor: ReportActor): Promise<void> {
    const report = await this.generatedReportModel.findById(id).exec();
    if (!report) throw new NotFoundException('Report not found');
    this.assertCanView(report, actor);

    if (
      report.file_path &&
      this.fileStorageService.ownsFile(report.file_path)
    ) {
      await this.fileStorageService.delete(report.file_path).catch((error) => {
        this.logger.warn(
          `Failed to delete stored file for report ${report.report_id}: ${String(error)}`,
        );
      });
    }
    await this.generatedReportModel.findByIdAndDelete(id).exec();
  }

  /**
   * Verifies the stored checksum against the bytes actually read back from
   * storage before ever returning them — a corrupted or tampered file
   * fails closed (500) rather than being silently served.
   */
  async downloadReport(
    id: string,
    actor: ReportActor,
  ): Promise<{ file: ProtectedStoredFile; report: GeneratedReportDocument }> {
    const report = await this.generatedReportModel.findById(id).exec();
    if (!report) throw new NotFoundException('Report not found');
    this.assertCanView(report, actor);

    if (report.status !== ReportStatus.COMPLETED || !report.file_path) {
      throw new BadRequestException(
        `Report is not ready for download (status: ${report.status})`,
      );
    }
    if (report.expires_at && report.expires_at.getTime() <= Date.now()) {
      throw new GoneException(
        'This report has expired and is no longer available for download',
      );
    }
    if (!this.fileStorageService.ownsFile(report.file_path)) {
      throw new NotFoundException('Report file not found');
    }

    const file = await this.fileStorageService.readProtectedFile(
      report.file_path,
    );

    if (report.checksum) {
      const actualChecksum = crypto
        .createHash('sha256')
        .update(file.buffer)
        .digest('hex');
      if (actualChecksum !== report.checksum) {
        this.logger.error(`Checksum mismatch for report ${report.report_id}`);
        throw new Error('Report file failed integrity verification');
      }
    }

    return { file, report };
  }

  normalizeParams(raw: Record<string, unknown>): ReportParams {
    return {
      dateFrom:
        typeof raw.dateFrom === 'string' ? new Date(raw.dateFrom) : undefined,
      dateTo: typeof raw.dateTo === 'string' ? new Date(raw.dateTo) : undefined,
      machineId: typeof raw.machineId === 'string' ? raw.machineId : undefined,
      technicianId:
        typeof raw.technicianId === 'string' ? raw.technicianId : undefined,
      limit: typeof raw.limit === 'number' ? raw.limit : undefined,
    };
  }

  private assertCanView(
    report: GeneratedReportDocument,
    actor: ReportActor,
  ): void {
    if (actor.role === Role.ADMIN) return;
    if (report.requested_by.toString() === actor.userId) return;
    throw new ForbiddenException(
      'You may only view or download your own reports',
    );
  }
}
