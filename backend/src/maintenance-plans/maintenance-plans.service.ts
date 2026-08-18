import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
  MaintenancePlanStatus,
} from '../schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import {
  CreateMaintenancePlanDto,
  MaintenancePlanTransitionAction,
  TransitionMaintenancePlanDto,
} from './dto/create-maintenance-plan.dto';
import { UpdateMaintenancePlanDto } from './dto/update-maintenance-plan.dto';
import { MaintenancePlansQueryDto } from './dto/maintenance-plans-query.dto';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import {
  buildCaseInsensitiveSearchFilter,
  parseCsvParam,
  parseSortParam,
} from '../common/query-params.util';

export const MAINTENANCE_PLANS_SORT_ALLOWED_FIELDS = [
  'createdAt',
  'status',
  'maintenance_code',
] as const;
const MAINTENANCE_PLANS_DEFAULT_SORT: Record<string, 1 | -1> = {
  createdAt: -1,
};

function buildMaintenancePlansFilter(
  query: MaintenancePlansQueryDto = {},
): FilterQuery<MaintenancePlanDocument> {
  const filter: FilterQuery<MaintenancePlanDocument> = {};

  const statuses = parseCsvParam(query.status);
  if (statuses) filter.status = { $in: statuses };

  const types = parseCsvParam(query.typeMaintenance);
  if (types) filter.type_maintenance = { $in: types };

  if (query.search) {
    const searchRegex = buildCaseInsensitiveSearchFilter(query.search);
    filter.$or = [
      { plan_id: searchRegex },
      { maintenance_code: searchRegex },
      { instruction: searchRegex },
      { responsable: searchRegex },
    ];
  }

  return filter;
}

function cleanInstruction(value?: string): string | undefined {
  if (typeof value !== 'string') return value;

  const cleaned = value
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:Photo|Mode)\s*:\s*N\/A\s*$/i.test(line))
    .join('\n')
    .trim();

  return cleaned || undefined;
}

function cleanResponsable(value?: string): string | undefined {
  if (typeof value !== 'string') return value;

  const responsable = value.trim();
  if (!responsable) return undefined;

  return /setup\s*technician/i.test(responsable) ? 'Maintenance' : responsable;
}

interface TransitionRule {
  from: MaintenancePlanStatus[];
  to: MaintenancePlanStatus;
}

const TRANSITION_RULES: Record<
  MaintenancePlanTransitionAction,
  TransitionRule
> = {
  activate: {
    from: [MaintenancePlanStatus.DRAFT],
    to: MaintenancePlanStatus.ACTIVE,
  },
  resume: {
    from: [MaintenancePlanStatus.PAUSED],
    to: MaintenancePlanStatus.ACTIVE,
  },
  pause: {
    from: [MaintenancePlanStatus.ACTIVE],
    to: MaintenancePlanStatus.PAUSED,
  },
  complete: {
    from: [MaintenancePlanStatus.ACTIVE],
    to: MaintenancePlanStatus.COMPLETED,
  },
  archive: {
    from: [
      MaintenancePlanStatus.DRAFT,
      MaintenancePlanStatus.ACTIVE,
      MaintenancePlanStatus.PAUSED,
      MaintenancePlanStatus.COMPLETED,
    ],
    to: MaintenancePlanStatus.ARCHIVED,
  },
};

const ACTION_TO_HISTORY_ACTION: Record<
  MaintenancePlanTransitionAction,
  string
> = {
  activate: 'activated',
  resume: 'resumed',
  pause: 'paused',
  complete: 'completed',
  archive: 'archived',
};

@Injectable()
export class MaintenancePlansService {
  constructor(
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    private readonly workOrdersService: WorkOrdersService,
  ) {}

  async create(dto: CreateMaintenancePlanDto, actorId?: string) {
    const now = new Date();
    return this.maintenancePlanModel.create({
      ...dto,
      instruction: cleanInstruction(dto.instruction),
      responsable: cleanResponsable(dto.responsable),
      status: MaintenancePlanStatus.DRAFT,
      version: 1,
      lifecycle_history: [
        {
          action: 'created',
          to_status: MaintenancePlanStatus.DRAFT,
          actor_user_id: this.toObjectIdOrUndefined(actorId),
          at: now,
        },
      ],
    });
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    query: MaintenancePlansQueryDto = {},
  ): Promise<PaginatedResponse<MaintenancePlan>> {
    const filter = buildMaintenancePlansFilter(query);
    const sort = parseSortParam(
      query.sort,
      MAINTENANCE_PLANS_SORT_ALLOWED_FIELDS,
      MAINTENANCE_PLANS_DEFAULT_SORT,
    );

    const [items, totalItems] = await Promise.all([
      this.maintenancePlanModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('module_id')
        .exec(),
      this.maintenancePlanModel.countDocuments(filter).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string) {
    return this.maintenancePlanModel.findById(id).populate('module_id').exec();
  }

  async update(id: string, dto: UpdateMaintenancePlanDto, actorId?: string) {
    const plan = await this.maintenancePlanModel.findById(id).exec();
    if (!plan) {
      throw new NotFoundException('Maintenance plan not found');
    }
    if (plan.status === MaintenancePlanStatus.ARCHIVED) {
      throw new ConflictException('Archived maintenance plans are read-only');
    }

    if (await this.hasValidatedOccurrence(id)) {
      if (dto.expected_version === undefined) {
        throw new ConflictException(
          'This plan has validated occurrences; expected_version is required to edit it safely',
        );
      }
      if (dto.expected_version !== plan.version) {
        throw new ConflictException(
          'This plan has changed since you last loaded it; reload and retry',
        );
      }
    }

    const { expected_version: _expectedVersion, ...fields } = dto;
    const updates: Record<string, unknown> = { ...fields };
    if (Object.hasOwn(fields, 'instruction')) {
      updates.instruction = cleanInstruction(fields.instruction);
    }
    if (Object.hasOwn(fields, 'responsable')) {
      updates.responsable = cleanResponsable(fields.responsable);
    }

    const now = new Date();
    const updated = await this.maintenancePlanModel
      .findOneAndUpdate(
        { _id: id, ...this.versionFilter(plan.version) },
        {
          $set: updates,
          $inc: { version: 1 },
          $push: {
            lifecycle_history: {
              action: 'updated',
              from_status: plan.status,
              to_status: plan.status,
              actor_user_id: this.toObjectIdOrUndefined(actorId),
              at: now,
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new ConflictException(
        'This plan has changed since you last loaded it; reload and retry',
      );
    }

    return updated;
  }

  async remove(id: string, expectedVersion?: number) {
    const plan = await this.maintenancePlanModel.findById(id).exec();
    if (!plan) {
      throw new NotFoundException('Maintenance plan not found');
    }
    if (plan.status === MaintenancePlanStatus.ARCHIVED) {
      throw new ConflictException('Archived maintenance plans are read-only');
    }

    if (await this.hasAnyOccurrence(id)) {
      throw new ConflictException(
        'This plan has work order occurrences and cannot be deleted; archive it instead to preserve historical references',
      );
    }

    if (expectedVersion !== undefined && expectedVersion !== plan.version) {
      throw new ConflictException(
        'This plan has changed since you last loaded it; reload and retry',
      );
    }

    const deleted = await this.maintenancePlanModel
      .findOneAndDelete({ _id: id, ...this.versionFilter(plan.version) })
      .exec();
    if (!deleted) {
      throw new ConflictException(
        'This plan has changed since you last loaded it; reload and retry',
      );
    }

    return deleted;
  }

  /**
   * Applies a single named lifecycle transition. The old status is part of
   * the update filter (not just checked beforehand), so a race between two
   * concurrent transition requests fails safe — whichever request wins
   * updates the document, the loser gets a 409 instead of silently
   * clobbering the winner's change.
   */
  async transition(
    id: string,
    dto: TransitionMaintenancePlanDto,
    actorId?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid maintenance plan id');
    }

    const plan = await this.maintenancePlanModel.findById(id).exec();
    if (!plan) {
      throw new NotFoundException('Maintenance plan not found');
    }

    const rule = TRANSITION_RULES[dto.action];
    if (!rule) {
      throw new BadRequestException(`Unknown transition action: ${dto.action}`);
    }

    // A plan with no `status` at all is legacy/imported data (see the
    // schema comment on `status`) and behaves as if it were already
    // Active — the same convention `WorkOrdersService.isPlanSchedulable`
    // uses. `effectiveStatus` folds that in purely for the purpose of
    // deciding whether this action is valid from where the plan already is.
    const effectiveStatus = plan.status || MaintenancePlanStatus.ACTIVE;
    if (!rule.from.includes(effectiveStatus)) {
      throw new ConflictException(
        `Cannot ${dto.action} a plan in "${effectiveStatus}" status`,
      );
    }

    const statusFilter = rule.from.includes(MaintenancePlanStatus.ACTIVE)
      ? {
          $or: [{ status: { $in: rule.from } }, { status: { $exists: false } }],
        }
      : { status: { $in: rule.from } };

    const now = new Date();
    const updated = await this.maintenancePlanModel
      .findOneAndUpdate(
        { _id: id, ...statusFilter },
        {
          $set: { status: rule.to },
          $inc: { version: 1 },
          $push: {
            lifecycle_history: {
              action: ACTION_TO_HISTORY_ACTION[dto.action],
              from_status: plan.status,
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
        `Cannot ${dto.action} a plan in "${effectiveStatus}" status`,
      );
    }

    let createdOccurrence: WorkOrderDocument | null = null;
    if (dto.action === 'activate') {
      createdOccurrence =
        await this.workOrdersService.createInitialOccurrenceForPlan(id);
    }

    return { plan: updated, createdOccurrence };
  }

  /**
   * A legacy/imported plan may have no `version` field at all. Matching it
   * with a literal `{ version: undefined }` filter is unreliable across
   * drivers, so an absent version is matched via `$exists: false` instead
   * — `$inc` on a missing path still correctly initializes it to 1.
   */
  private versionFilter(version?: number): Record<string, unknown> {
    return version === undefined
      ? { version: { $exists: false } }
      : { version };
  }

  private async hasValidatedOccurrence(planId: string): Promise<boolean> {
    const exists = await this.workOrderModel
      .exists({ plan_id: new Types.ObjectId(planId), status: 'validated' })
      .exec();
    return Boolean(exists);
  }

  private async hasAnyOccurrence(planId: string): Promise<boolean> {
    const exists = await this.workOrderModel
      .exists({ plan_id: new Types.ObjectId(planId) })
      .exec();
    return Boolean(exists);
  }

  private toObjectIdOrUndefined(value?: string): Types.ObjectId | undefined {
    return value && Types.ObjectId.isValid(value)
      ? new Types.ObjectId(value)
      : undefined;
  }
}
