import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AiAnomalyAnalysis,
  AiAnomalyAnalysisDocument,
  AiAnomalyDatasetOrigin,
  AiAnomalyGeneralizationStatus,
  AiAnomalyInputSource,
  AiAnomalyValidationScope,
  AiAnomalyValidationStatus,
} from '../schemas/ai-anomaly-analysis.schema';
import { Capteur, CapteurDocument } from '../schemas/capteur.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import { Role } from '../schemas/user.schema';
import { NotificationType } from '../schemas/notification.schema';
import { DocumentAccessService } from '../documents/document-access.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import {
  CreateAiAnomalyAnalysisDto,
  CreateAiAnomalyBatchDto,
  AiAnomalyQueryDto,
  ValidateAiAnomalyAnalysisDto,
} from './dto/ai-anomaly.dto';
import { AiAnomalyFastApiClient } from './ai-anomaly-fastapi.client';
import {
  AiAnomalyActor,
  AiAnomalyFastApiResult,
  ImsAnomalyFeatureRow,
} from './ai-anomaly.types';
import { normalizePagination, toPaginatedResponse } from '../common/pagination';

type SerializedAiAnomalyAnalysis = {
  id: string;
  analysis_id: string;
  machine_id: string;
  capteur_id?: string;
  requested_by: string;
  model_version: string;
  input_source: AiAnomalyInputSource;
  experiment: string;
  measurement_timestamp: string;
  bearing: number;
  anomaly_score: number;
  risk_score: number;
  risk_level: string;
  raw_anomaly: boolean;
  persistent_alert: boolean;
  component_scores: {
    zScore: number;
    isolationForest: number;
  };
  reason_codes: string[];
  prototype_result: boolean;
  model_response: AiAnomalyFastApiResult;
  dataset_origin: AiAnomalyDatasetOrigin;
  validation_scope: AiAnomalyValidationScope;
  generalization_status: AiAnomalyGeneralizationStatus;
  validation_status: AiAnomalyValidationStatus;
  validated_by?: string;
  validation_comment?: string;
  validated_at?: string;
  created_at?: string;
  updated_at?: string;
};

type PersistedAiAnomalyResult = {
  doc: AiAnomalyAnalysisDocument;
  inserted: boolean;
};

@Injectable()
export class AiAnomalyService {
  private readonly logger = new Logger(AiAnomalyService.name);

  constructor(
    @InjectModel(AiAnomalyAnalysis.name)
    private readonly analysisModel: Model<AiAnomalyAnalysisDocument>,
    @InjectModel(Capteur.name)
    private readonly capteurModel: Model<CapteurDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    private readonly documentAccessService: DocumentAccessService,
    private readonly fastApiClient: AiAnomalyFastApiClient,
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  async getModelMetadata() {
    return this.fastApiClient.getModels();
  }

  async createAnalysis(
    dto: CreateAiAnomalyAnalysisDto,
    actor: AiAnomalyActor,
  ): Promise<SerializedAiAnomalyAnalysis[]> {
    this.assertSingleTimestamp(dto.rows);
    return this.createAndPersist(dto, actor, false);
  }

  async createBatch(
    dto: CreateAiAnomalyBatchDto,
    actor: AiAnomalyActor,
  ): Promise<SerializedAiAnomalyAnalysis[]> {
    return this.createAndPersist(dto, actor, true);
  }

  async listAnalyses(dto: AiAnomalyQueryDto, actor: AiAnomalyActor) {
    this.assertViewRole(actor);
    const { page, limit, skip } = normalizePagination(dto.page, dto.limit);
    const filter: FilterQuery<AiAnomalyAnalysisDocument> =
      await this.buildListFilter(dto, actor);

    const [items, totalItems] = await Promise.all([
      this.analysisModel
        .find(filter)
        .sort({ measurement_timestamp: -1, created_at: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.analysisModel.countDocuments(filter).exec(),
    ]);

    return toPaginatedResponse(
      items.map((item) => this.serialize(item)),
      totalItems,
      page,
      limit,
    );
  }

  async getAnalysis(
    id: string,
    actor: AiAnomalyActor,
  ): Promise<SerializedAiAnomalyAnalysis> {
    this.assertViewRole(actor);
    const analysis = await this.findAnalysisByPublicOrMongoId(id);
    await this.documentAccessService.assertCanAccessMachine(
      actor,
      this.toIdString(analysis.machine_id),
    );
    return this.serialize(analysis);
  }

  async getMachineHistory(
    machineId: string,
    query: AiAnomalyQueryDto,
    actor: AiAnomalyActor,
  ) {
    this.assertViewRole(actor);
    await this.documentAccessService.assertCanAccessMachine(actor, machineId);
    return this.listAnalyses({ ...query, machine_id: machineId }, actor);
  }

  async validateAnalysis(
    id: string,
    dto: ValidateAiAnomalyAnalysisDto,
    actor: AiAnomalyActor,
  ): Promise<SerializedAiAnomalyAnalysis> {
    this.assertViewRole(actor);
    const analysis = await this.findAnalysisByPublicOrMongoId(id);
    await this.documentAccessService.assertCanAccessMachine(
      actor,
      this.toIdString(analysis.machine_id),
    );

    if (analysis.validation_status !== AiAnomalyValidationStatus.PENDING) {
      throw new BadRequestException('Analysis has already been validated');
    }

    analysis.validation_status = dto.validation_status;
    analysis.validated_by = new Types.ObjectId(actor.userId);
    analysis.validation_comment = dto.validation_comment?.trim() || undefined;
    analysis.validated_at = new Date();
    await analysis.save();
    return this.serialize(analysis);
  }

  private async createAndPersist(
    dto: CreateAiAnomalyAnalysisDto,
    actor: AiAnomalyActor,
    statelessBatch: boolean,
  ): Promise<SerializedAiAnomalyAnalysis[]> {
    await this.assertPlatformMapping(dto.machine_id, dto.capteur_id, actor);
    this.assertNoDuplicateRows(dto.rows);
    this.assertChronologicalRows(dto.rows);

    this.logger.log(
      `Requesting IMS anomaly analysis source=${dto.input_source} machine=${dto.machine_id} capteur=${dto.capteur_id ?? 'none'} rows=${dto.rows.length} statelessBatch=${statelessBatch}`,
    );

    const response = statelessBatch
      ? await this.fastApiClient.analyzeBatch({ rows: dto.rows })
      : await this.fastApiClient.analyze({ rows: dto.rows });

    const persisted = await Promise.all(
      response.results.map((result) =>
        this.persistResult(result, dto, actor.userId),
      ),
    );

    await Promise.all(
      persisted.map((item) => this.createPersistentAlertNotifications(item)),
    );

    return persisted.map((item) => this.serialize(item.doc));
  }

  private async persistResult(
    result: AiAnomalyFastApiResult,
    dto: CreateAiAnomalyAnalysisDto,
    userId: string,
  ): Promise<PersistedAiAnomalyResult> {
    const measurementTimestamp = this.parseTimestamp(result.timestamp);
    const filter = {
      machine_id: new Types.ObjectId(dto.machine_id),
      model_version: result.modelVersion,
      input_source: dto.input_source,
      experiment: result.experiment,
      measurement_timestamp: measurementTimestamp,
      bearing: result.bearing,
    };
    const analysisId = this.buildAnalysisId(filter);
    const existing = await this.analysisModel.exists(filter).exec();

    const doc = await this.analysisModel
      .findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            analysis_id: analysisId,
            ...filter,
            capteur_id: dto.capteur_id
              ? new Types.ObjectId(dto.capteur_id)
              : undefined,
            requested_by: new Types.ObjectId(userId),
            anomaly_score: result.anomalyScore,
            risk_score: result.riskScore,
            risk_level: result.riskLevel,
            raw_anomaly: result.rawAnomaly,
            persistent_alert: result.persistentAlert,
            component_scores: result.componentScores,
            reason_codes: result.reasonCodes,
            prototype_result: result.prototypeResult,
            model_response: result,
            dataset_origin: AiAnomalyDatasetOrigin.IMS_PUBLIC_TEST_RIG,
            validation_scope: AiAnomalyValidationScope.IMS_1ST_TEST_ONLY,
            generalization_status:
              AiAnomalyGeneralizationStatus.NOT_ESTABLISHED_FOR_IPROTEX,
            validation_status: AiAnomalyValidationStatus.PENDING,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!doc) {
      throw new BadRequestException('AI anomaly analysis could not be stored');
    }

    return { doc, inserted: !existing };
  }

  private async createPersistentAlertNotifications(
    persisted: PersistedAiAnomalyResult,
  ): Promise<void> {
    const { doc, inserted } = persisted;
    if (!inserted || !doc.persistent_alert) return;

    const machineId = this.toIdString(doc.machine_id);
    const referenceId = this.toIdString(doc._id);
    const timestamp = doc.measurement_timestamp.toISOString();
    const title = 'Experimental IMS dataset replay persistent alert';
    const message =
      `Experimental IMS dataset replay produced a persistent alert for analysis ${doc.analysis_id} ` +
      `at ${timestamp}. This is not live IPROTEX telemetry.`;

    try {
      await Promise.all(
        [Role.ADMIN, Role.TECHNICIAN].map((role) =>
          this.notificationCenterService.createIfNotExists({
            type: NotificationType.SENSOR_ALERT,
            title,
            message,
            translationKey: 'notifications.aiAnomalyPersistentAlert',
            translationParams: {
              analysisId: doc.analysis_id,
              machineId,
              timestamp,
            },
            recipientRole: role,
            machineId,
            referenceId,
            dedupeKey: `ai-anomaly:persistent-alert:${doc.analysis_id}:${role}`,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to create IMS anomaly persistent-alert notification analysis=${doc.analysis_id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async assertPlatformMapping(
    machineId: string,
    capteurId: string | undefined,
    actor: AiAnomalyActor,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }

    await this.documentAccessService.assertCanAccessMachine(actor, machineId);

    if (!capteurId) return;
    if (!Types.ObjectId.isValid(capteurId)) {
      throw new BadRequestException('Invalid capteur_id');
    }

    const capteur = await this.capteurModel.findById(capteurId).exec();
    if (!capteur) throw new NotFoundException('Capteur not found');

    const module = await this.moduleModel.findById(capteur.module_id).exec();
    if (!module) {
      throw new BadRequestException('Capteur module mapping is unavailable');
    }

    if (this.toIdString(module.machine_id) !== machineId) {
      throw new BadRequestException(
        'Capteur is not installed on the requested machine',
      );
    }
  }

  private assertNoDuplicateRows(rows: ImsAnomalyFeatureRow[]): void {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.experiment}|${row.timestamp}|${row.sensor_channel}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          'Duplicate IMS rows are not allowed for experiment, timestamp, and sensor_channel',
        );
      }
      seen.add(key);
    }
  }

  private assertChronologicalRows(rows: ImsAnomalyFeatureRow[]): void {
    const lastBySeries = new Map<string, number>();
    for (const row of rows) {
      const timestamp = Date.parse(row.timestamp);
      if (!Number.isFinite(timestamp)) {
        throw new BadRequestException('Invalid timestamp');
      }
      const key = `${row.experiment}|${row.sensor_channel}`;
      const last = lastBySeries.get(key);
      if (last !== undefined && timestamp < last) {
        throw new BadRequestException(
          'IMS rows must be chronological within each experiment and sensor_channel',
        );
      }
      lastBySeries.set(key, timestamp);
    }
  }

  private assertSingleTimestamp(rows: ImsAnomalyFeatureRow[]): void {
    const timestamps = new Set(rows.map((row) => row.timestamp));
    if (timestamps.size !== 1) {
      throw new BadRequestException(
        'Stateful single analysis accepts rows for exactly one timestamp',
      );
    }
  }

  private async buildListFilter(
    dto: AiAnomalyQueryDto,
    actor: AiAnomalyActor,
  ): Promise<FilterQuery<AiAnomalyAnalysisDocument>> {
    const filter: FilterQuery<AiAnomalyAnalysisDocument> = {};
    const accessibleMachineIds =
      await this.documentAccessService.listAccessibleMachineIds(actor);

    if (dto.machine_id) {
      await this.documentAccessService.assertCanAccessMachine(
        actor,
        dto.machine_id,
      );
      filter.machine_id = new Types.ObjectId(dto.machine_id);
    } else if (accessibleMachineIds) {
      filter.machine_id = { $in: accessibleMachineIds };
    }

    if (dto.validation_status) filter.validation_status = dto.validation_status;
    if (dto.risk_level) filter.risk_level = dto.risk_level;
    if (dto.input_source) filter.input_source = dto.input_source;
    const dateRange = this.buildDateRangeFilter(dto.dateFrom, dto.dateTo);
    if (dateRange) filter.measurement_timestamp = dateRange;
    return filter;
  }

  private buildDateRangeFilter(
    dateFrom?: string,
    dateTo?: string,
  ): { $gte?: Date; $lte?: Date } | undefined {
    const from = dateFrom
      ? this.parseQueryDate(dateFrom, 'dateFrom', 'start')
      : undefined;
    const to = dateTo
      ? this.parseQueryDate(dateTo, 'dateTo', 'end')
      : undefined;

    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'dateFrom must be before or equal to dateTo',
      );
    }

    if (!from && !to) return undefined;
    return {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }

  private parseQueryDate(
    value: string,
    fieldName: 'dateFrom' | 'dateTo',
    bound: 'start' | 'end',
  ): Date {
    const trimmed = value.trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);
      const date =
        bound === 'start'
          ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
          : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        throw new BadRequestException(`${fieldName} must be a valid ISO date`);
      }
      return date;
    }

    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        trimmed,
      )
    ) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date`);
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date`);
    }
    return parsed;
  }

  private async findAnalysisByPublicOrMongoId(
    id: string,
  ): Promise<AiAnomalyAnalysisDocument> {
    const or: FilterQuery<AiAnomalyAnalysisDocument>[] = [{ analysis_id: id }];
    if (Types.ObjectId.isValid(id)) {
      or.push({ _id: new Types.ObjectId(id) });
    }
    const analysis = await this.analysisModel.findOne({ $or: or }).exec();
    if (!analysis) throw new NotFoundException('AI anomaly analysis not found');
    return analysis;
  }

  private assertViewRole(actor: AiAnomalyActor): void {
    if (actor.role !== Role.ADMIN && actor.role !== Role.TECHNICIAN) {
      throw new NotFoundException('AI anomaly analysis not found');
    }
  }

  private buildAnalysisId(filter: {
    machine_id: Types.ObjectId;
    model_version: string;
    input_source: AiAnomalyInputSource;
    experiment: string;
    measurement_timestamp: Date;
    bearing: number;
  }): string {
    const hash = createHash('sha256')
      .update(
        [
          filter.machine_id.toHexString(),
          filter.model_version,
          filter.input_source,
          filter.experiment,
          filter.measurement_timestamp.toISOString(),
          filter.bearing,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 16);
    return `AI-ANOM-${hash}`;
  }

  private parseTimestamp(timestamp: string): Date {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('AI service returned invalid timestamp');
    }
    return parsed;
  }

  private serialize(
    doc: AiAnomalyAnalysisDocument,
  ): SerializedAiAnomalyAnalysis {
    return {
      id: this.toIdString(doc._id),
      analysis_id: doc.analysis_id,
      machine_id: this.toIdString(doc.machine_id),
      capteur_id: doc.capteur_id ? this.toIdString(doc.capteur_id) : undefined,
      requested_by: this.toIdString(doc.requested_by),
      model_version: doc.model_version,
      input_source: doc.input_source,
      experiment: doc.experiment,
      measurement_timestamp: doc.measurement_timestamp.toISOString(),
      bearing: doc.bearing,
      anomaly_score: doc.anomaly_score,
      risk_score: doc.risk_score,
      risk_level: doc.risk_level,
      raw_anomaly: doc.raw_anomaly,
      persistent_alert: doc.persistent_alert,
      component_scores: doc.component_scores,
      reason_codes: doc.reason_codes,
      prototype_result: doc.prototype_result,
      model_response: doc.model_response,
      dataset_origin: doc.dataset_origin,
      validation_scope: doc.validation_scope,
      generalization_status: doc.generalization_status,
      validation_status: doc.validation_status,
      validated_by: doc.validated_by
        ? this.toIdString(doc.validated_by)
        : undefined,
      validation_comment: doc.validation_comment,
      validated_at: doc.validated_at?.toISOString(),
      created_at: doc.created_at?.toISOString(),
      updated_at: doc.updated_at?.toISOString(),
    };
  }

  private toIdString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (value && typeof value === 'object' && '_id' in value) {
      return this.toIdString((value as { _id?: unknown })._id);
    }
    return String(value);
  }
}
