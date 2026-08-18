import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder, Types } from 'mongoose';
import {
  KnowledgeArticle,
  KnowledgeArticleDocument,
  KnowledgeArticleLifecycleAction,
  KnowledgeArticleStatus,
} from '../schemas/knowledge-article.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../schemas/machine-type.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import {
  PreventiveTask,
  PreventiveTaskDocument,
} from '../schemas/preventive-task.schema';
import { CreateKnowledgeArticleDto } from './dto/create-knowledge-article.dto';
import { UpdateKnowledgeArticleDto } from './dto/update-knowledge-article.dto';
import { KnowledgeArticleTransitionDto } from './dto/knowledge-article-transition.dto';
import { ReviseKnowledgeArticleDto } from './dto/revise-knowledge-article.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';

interface LinkedRecordIds {
  machine_type_id?: string;
  machine_id?: string;
  maintenance_plan_id?: string;
  preventive_task_id?: string;
}

export interface KnowledgeArticleFilters {
  status?: KnowledgeArticleStatus;
  category?: string;
  machineId?: string;
  machineTypeId?: string;
  maintenancePlanId?: string;
  faultCode?: string;
  errorCode?: string;
  search?: string;
}

export interface KnowledgeSuggestionInput {
  machineId?: string;
  machineTypeId?: string;
  faultCode?: string;
  maintenancePlanId?: string;
  limit?: number;
}

interface TransitionRule {
  allowedFrom: KnowledgeArticleStatus[];
  to: KnowledgeArticleStatus;
  action: KnowledgeArticleLifecycleAction;
  verb: string;
}

const REVISABLE_FROM = new Set([KnowledgeArticleStatus.PUBLISHED]);

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectModel(KnowledgeArticle.name)
    private readonly articleModel: Model<KnowledgeArticleDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(PreventiveTask.name)
    private readonly preventiveTaskModel: Model<PreventiveTaskDocument>,
  ) {}

  async create(dto: CreateKnowledgeArticleDto, actorId?: string) {
    await this.assertLinkedRecordsExist(dto);

    const now = new Date();
    const created = new this.articleModel({
      ...dto,
      author_id: this.toObjectIdOrUndefined(actorId),
      status: KnowledgeArticleStatus.DRAFT,
      version: 1,
      revision: 1,
      lifecycle_history: [
        {
          action: 'created',
          to_status: KnowledgeArticleStatus.DRAFT,
          actor_user_id: this.toObjectIdOrUndefined(actorId),
          at: now,
        },
      ],
    });
    return created.save();
  }

  async findAll(
    filters: KnowledgeArticleFilters,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<KnowledgeArticleDocument>> {
    const query = this.buildFilterQuery(filters);
    const projection = filters.search ? { score: { $meta: 'textScore' } } : {};
    const sort: Record<string, SortOrder | { $meta: string }> = filters.search
      ? { score: { $meta: 'textScore' } }
      : { updatedAt: -1 };

    const [items, totalItems] = await Promise.all([
      this.articleModel
        .find(query, projection)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.articleModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string, requirePublished: boolean) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid knowledge article id');
    }
    const article = await this.articleModel.findById(id).exec();
    if (!article) throw new NotFoundException('Knowledge article not found');

    if (
      requirePublished &&
      article.status !== KnowledgeArticleStatus.PUBLISHED
    ) {
      throw new NotFoundException('Knowledge article not found');
    }
    return article;
  }

  async listVersionHistory(id: string, requirePublished: boolean) {
    const article = await this.findOne(id, requirePublished);
    const rootId = article.root_article_id ?? article._id;
    return this.articleModel
      .find({ $or: [{ _id: rootId }, { root_article_id: rootId }] })
      .sort({ revision: 1 })
      .exec();
  }

  /**
   * Suggests related, Published articles for the corrective/preventive
   * workflows based on whichever of machine/machine-type/fault-code/plan is
   * known at the point the operator or technician is working. Every
   * candidate is scored by how many of the supplied criteria it actually
   * matches, so an article linked to both the exact machine *and* the fault
   * code ranks above one that only shares the machine type.
   */
  async computeSuggestions(input: KnowledgeSuggestionInput) {
    const machineId = input.machineId?.trim();
    const faultCode = input.faultCode?.trim();
    const maintenancePlanId = input.maintenancePlanId?.trim();
    let machineTypeId = input.machineTypeId?.trim();

    if (!machineTypeId && machineId && Types.ObjectId.isValid(machineId)) {
      const machine = await this.machineModel
        .findById(machineId)
        .select('type_id')
        .exec();
      machineTypeId = machine?.type_id ? String(machine.type_id) : undefined;
    }

    const clauses: Record<string, unknown>[] = [];
    if (machineId && Types.ObjectId.isValid(machineId)) {
      clauses.push({ machine_id: new Types.ObjectId(machineId) });
    }
    if (machineTypeId && Types.ObjectId.isValid(machineTypeId)) {
      clauses.push({ machine_type_id: new Types.ObjectId(machineTypeId) });
    }
    if (maintenancePlanId && Types.ObjectId.isValid(maintenancePlanId)) {
      clauses.push({
        maintenance_plan_id: new Types.ObjectId(maintenancePlanId),
      });
    }
    if (faultCode) {
      clauses.push({ fault_codes: faultCode });
    }

    if (clauses.length === 0) return [];

    const candidates = await this.articleModel
      .find({ status: KnowledgeArticleStatus.PUBLISHED, $or: clauses })
      .limit(50)
      .exec();

    const scored = candidates.map((article) => {
      let score = 0;
      if (machineId && String(article.machine_id ?? '') === machineId)
        score += 1;
      if (
        machineTypeId &&
        String(article.machine_type_id ?? '') === machineTypeId
      ) {
        score += 1;
      }
      if (
        maintenancePlanId &&
        String(article.maintenance_plan_id ?? '') === maintenancePlanId
      ) {
        score += 1;
      }
      if (faultCode && article.fault_codes?.includes(faultCode)) score += 2;
      return { article, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const limit = input.limit && input.limit > 0 ? input.limit : 5;
    return scored.slice(0, limit).map((entry) => entry.article);
  }

  async update(id: string, dto: UpdateKnowledgeArticleDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid knowledge article id');
    }
    const existing = await this.articleModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Knowledge article not found');

    const currentStatus = existing.status ?? KnowledgeArticleStatus.DRAFT;
    if (currentStatus !== KnowledgeArticleStatus.DRAFT) {
      throw new ConflictException(
        `Cannot edit a knowledge article in "${currentStatus}" status; revise it to create a new draft version instead`,
      );
    }
    this.assertExpectedVersion(existing.version, dto.expected_version);
    await this.assertLinkedRecordsExist(dto);

    const { expected_version: _expectedVersion, ...fields } = dto;
    const updated = await this.articleModel
      .findOneAndUpdate(
        { _id: id, ...this.versionFilter(existing.version) },
        { $set: fields, $inc: { version: 1 } },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new ConflictException(
        'This knowledge article has changed since you last loaded it; reload and retry',
      );
    }
    return updated;
  }

  async publish(
    id: string,
    dto: KnowledgeArticleTransitionDto,
    actorId?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid knowledge article id');
    }
    const existing = await this.articleModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Knowledge article not found');

    const currentStatus = existing.status ?? KnowledgeArticleStatus.DRAFT;
    if (currentStatus !== KnowledgeArticleStatus.DRAFT) {
      throw new ConflictException(
        `Cannot publish a knowledge article in "${currentStatus}" status`,
      );
    }
    this.assertExpectedVersion(existing.version, dto.expected_version);

    if (!existing.supersedes_article_id) {
      return this.applyTransition(
        existing,
        {
          allowedFrom: [KnowledgeArticleStatus.DRAFT],
          to: KnowledgeArticleStatus.PUBLISHED,
          action: 'published',
          verb: 'publish',
        },
        dto,
        actorId,
      );
    }

    // This draft is a revision of an already-published article: publishing
    // it must also archive its predecessor and link the two, in one
    // transaction, so no reader can ever see two "current" versions.
    const session = await this.articleModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const now = new Date();
        const published = await this.articleModel
          .findOneAndUpdate(
            { _id: existing._id, ...this.versionFilter(existing.version) },
            {
              $set: { status: KnowledgeArticleStatus.PUBLISHED },
              $inc: { version: 1 },
              $push: {
                lifecycle_history: {
                  action: 'published',
                  from_status: currentStatus,
                  to_status: KnowledgeArticleStatus.PUBLISHED,
                  actor_user_id: this.toObjectIdOrUndefined(actorId),
                  reason: dto.reason,
                  at: now,
                },
              },
            },
            { new: true, session },
          )
          .exec();

        if (!published) {
          throw new ConflictException(
            'This knowledge article has changed since you last loaded it; reload and retry',
          );
        }

        const predecessor = await this.articleModel
          .findOneAndUpdate(
            {
              _id: existing.supersedes_article_id,
              status: KnowledgeArticleStatus.PUBLISHED,
            },
            {
              $set: {
                status: KnowledgeArticleStatus.ARCHIVED,
                superseded_by_article_id: published._id,
              },
              $inc: { version: 1 },
              $push: {
                lifecycle_history: {
                  action: 'superseded',
                  from_status: KnowledgeArticleStatus.PUBLISHED,
                  to_status: KnowledgeArticleStatus.ARCHIVED,
                  actor_user_id: this.toObjectIdOrUndefined(actorId),
                  reason: dto.reason,
                  at: now,
                },
              },
            },
            { new: true, session },
          )
          .exec();

        if (!predecessor) {
          throw new ConflictException(
            'The article this revision supersedes is no longer published',
          );
        }

        return published;
      });
    } finally {
      await session.endSession();
    }
  }

  async archive(
    id: string,
    dto: KnowledgeArticleTransitionDto,
    actorId?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid knowledge article id');
    }
    const existing = await this.articleModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Knowledge article not found');

    return this.applyTransition(
      existing,
      {
        allowedFrom: [
          KnowledgeArticleStatus.DRAFT,
          KnowledgeArticleStatus.PUBLISHED,
        ],
        to: KnowledgeArticleStatus.ARCHIVED,
        action: 'archived',
        verb: 'archive',
      },
      dto,
      actorId,
    );
  }

  /**
   * Creates a new Draft revision of a Published article, preserving the
   * currently-published content unchanged until the revision is itself
   * published (see `publish()`). This is the only way to change a
   * Published article's content, guaranteeing version history is never
   * silently lost.
   */
  async reviseArticle(
    id: string,
    dto: ReviseKnowledgeArticleDto,
    actorId?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid knowledge article id');
    }
    const existing = await this.articleModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Knowledge article not found');

    const currentStatus = existing.status ?? KnowledgeArticleStatus.DRAFT;
    if (!REVISABLE_FROM.has(currentStatus)) {
      throw new ConflictException(
        `Cannot revise a knowledge article in "${currentStatus}" status`,
      );
    }
    this.assertExpectedVersion(existing.version, dto.expected_version);
    await this.assertLinkedRecordsExist(dto);

    const now = new Date();
    const rootId = existing.root_article_id ?? existing._id;
    const nextRevision = (existing.revision ?? 1) + 1;

    const created = new this.articleModel({
      article_id: `${existing.article_id}-r${nextRevision}`,
      title: dto.title ?? existing.title,
      category: dto.category ?? existing.category,
      summary: dto.summary ?? existing.summary,
      content: dto.content ?? existing.content,
      tags: dto.tags ?? existing.tags,
      machine_type_id: dto.machine_type_id ?? existing.machine_type_id,
      machine_id: dto.machine_id ?? existing.machine_id,
      maintenance_plan_id:
        dto.maintenance_plan_id ?? existing.maintenance_plan_id,
      preventive_task_id: dto.preventive_task_id ?? existing.preventive_task_id,
      fault_codes: dto.fault_codes ?? existing.fault_codes,
      error_codes: dto.error_codes ?? existing.error_codes,
      author_id: this.toObjectIdOrUndefined(actorId),
      status: KnowledgeArticleStatus.DRAFT,
      version: 1,
      revision: nextRevision,
      root_article_id: rootId,
      supersedes_article_id: existing._id,
      lifecycle_history: [
        {
          action: 'created',
          to_status: KnowledgeArticleStatus.DRAFT,
          actor_user_id: this.toObjectIdOrUndefined(actorId),
          reason: dto.reason,
          at: now,
        },
      ],
    });

    return created.save();
  }

  /**
   * An article may only be hard-deleted while it is still an untouched
   * Draft with no revisions of it and nothing it itself revises — anything
   * with real lifecycle activity must be archived instead, so historical
   * references (a revision chain, a corrective/preventive suggestion that
   * cited it) never resolve to a missing record.
   */
  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid knowledge article id');
    }
    const article = await this.articleModel.findById(id).exec();
    if (!article) throw new NotFoundException('Knowledge article not found');

    const hasRealHistory =
      (article.lifecycle_history?.length ?? 0) > 1 ||
      article.status === KnowledgeArticleStatus.PUBLISHED ||
      article.status === KnowledgeArticleStatus.ARCHIVED ||
      Boolean(article.superseded_by_article_id) ||
      Boolean(article.supersedes_article_id);

    if (hasRealHistory) {
      throw new ConflictException(
        'This knowledge article has lifecycle or version history and cannot be deleted; archive it instead',
      );
    }

    const deleted = await this.articleModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Knowledge article not found');
    return deleted;
  }

  private async applyTransition(
    existing: KnowledgeArticleDocument,
    rule: TransitionRule,
    dto: KnowledgeArticleTransitionDto,
    actorId?: string,
  ) {
    const currentStatus = existing.status ?? KnowledgeArticleStatus.DRAFT;
    if (!rule.allowedFrom.includes(currentStatus)) {
      throw new ConflictException(
        `Cannot ${rule.verb} a knowledge article in "${currentStatus}" status`,
      );
    }
    this.assertExpectedVersion(existing.version, dto.expected_version);

    const statusFilter = rule.allowedFrom.includes(KnowledgeArticleStatus.DRAFT)
      ? {
          $or: [
            { status: { $in: rule.allowedFrom } },
            { status: { $exists: false } },
          ],
        }
      : { status: { $in: rule.allowedFrom } };

    const now = new Date();
    const updated = await this.articleModel
      .findOneAndUpdate(
        {
          _id: existing._id,
          ...statusFilter,
          ...this.versionFilter(existing.version),
        },
        {
          $set: { status: rule.to },
          $inc: { version: 1 },
          $push: {
            lifecycle_history: {
              action: rule.action,
              from_status: existing.status,
              to_status: rule.to,
              actor_user_id: this.toObjectIdOrUndefined(actorId),
              reason: dto.reason,
              at: now,
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new ConflictException(
        `Cannot ${rule.verb} a knowledge article in "${currentStatus}" status`,
      );
    }
    return updated;
  }

  private assertExpectedVersion(
    currentVersion: number | undefined,
    expectedVersion: number | undefined,
  ): void {
    if (currentVersion === undefined) return;
    if (expectedVersion === undefined) {
      throw new ConflictException(
        'expected_version is required to modify this knowledge article',
      );
    }
    if (expectedVersion !== currentVersion) {
      throw new ConflictException(
        'This knowledge article has changed since you last loaded it; reload and retry',
      );
    }
  }

  private versionFilter(version?: number): Record<string, unknown> {
    return version === undefined
      ? { version: { $exists: false } }
      : { version };
  }

  private buildFilterQuery(
    filters: KnowledgeArticleFilters,
  ): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.category) query.category = filters.category;
    if (filters.machineId && Types.ObjectId.isValid(filters.machineId)) {
      query.machine_id = new Types.ObjectId(filters.machineId);
    }
    if (
      filters.machineTypeId &&
      Types.ObjectId.isValid(filters.machineTypeId)
    ) {
      query.machine_type_id = new Types.ObjectId(filters.machineTypeId);
    }
    if (
      filters.maintenancePlanId &&
      Types.ObjectId.isValid(filters.maintenancePlanId)
    ) {
      query.maintenance_plan_id = new Types.ObjectId(filters.maintenancePlanId);
    }
    if (filters.faultCode) query.fault_codes = filters.faultCode;
    if (filters.errorCode) query.error_codes = filters.errorCode;
    if (filters.search?.trim()) {
      query.$text = { $search: filters.search.trim() };
    }
    return query;
  }

  private async assertLinkedRecordsExist(
    links: LinkedRecordIds,
  ): Promise<void> {
    if (links.machine_type_id !== undefined) {
      const exists = await this.machineTypeModel
        .exists({ _id: links.machine_type_id })
        .exec();
      if (!exists)
        throw new BadRequestException('Referenced machine type does not exist');
    }
    if (links.machine_id !== undefined) {
      const exists = await this.machineModel
        .exists({ _id: links.machine_id })
        .exec();
      if (!exists)
        throw new BadRequestException('Referenced machine does not exist');
    }
    if (links.maintenance_plan_id !== undefined) {
      const exists = await this.maintenancePlanModel
        .exists({ _id: links.maintenance_plan_id })
        .exec();
      if (!exists) {
        throw new BadRequestException(
          'Referenced maintenance plan does not exist',
        );
      }
    }
    if (links.preventive_task_id !== undefined) {
      const exists = await this.preventiveTaskModel
        .exists({ _id: links.preventive_task_id })
        .exec();
      if (!exists) {
        throw new BadRequestException(
          'Referenced preventive task does not exist',
        );
      }
    }
  }

  private toObjectIdOrUndefined(id?: string): Types.ObjectId | undefined {
    return id && Types.ObjectId.isValid(id)
      ? new Types.ObjectId(id)
      : undefined;
  }
}
