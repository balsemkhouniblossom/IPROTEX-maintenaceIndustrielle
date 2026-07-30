import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import {
  PreventiveTask,
  PreventiveTaskDocument,
} from '../schemas/preventive-task.schema';
import { CreatePreventiveTaskDto } from './dto/create-preventive-task.dto';
import { UpdatePreventiveTaskDto } from './dto/update-preventive-task.dto';
import { NOT_CORRECTIVE_TYPE_FILTER } from '../common/maintenance-type';

@Injectable()
export class PreventiveTasksService {
  constructor(
    @InjectModel(PreventiveTask.name)
    private readonly model: Model<PreventiveTaskDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly planModel: Model<MaintenancePlanDocument>,
  ) {}

  create(dto: CreatePreventiveTaskDto) {
    return new this.model({
      ...dto,
      source: 'manual',
      completed_at: dto.status === 'completed' ? new Date() : undefined,
    }).save();
  }

  async syncPlans() {
    return this.syncPlansMatching({
      ...NOT_CORRECTIVE_TYPE_FILTER,
      instruction: { $exists: true, $ne: '' },
    });
  }

  /**
   * Same idempotent upsert as syncPlans(), narrowed to a specific set of
   * modules \u2014 lets a non-admin caller (e.g. an operator viewing their own
   * machines' checklist) lazily materialize PreventiveTask rows for just
   * their own scope, without needing the admin-only global sync.
   */
  async syncPlansForModuleIds(moduleIds: Types.ObjectId[]) {
    if (!moduleIds.length) return { plans: 0, created: 0 };
    return this.syncPlansMatching({
      ...NOT_CORRECTIVE_TYPE_FILTER,
      instruction: { $exists: true, $ne: '' },
      $expr: {
        $in: [
          { $toString: '$module_id' },
          moduleIds.map((moduleId) => moduleId.toString()),
        ],
      },
    });
  }

  private async syncPlansMatching(
    filter: FilterQuery<MaintenancePlanDocument>,
  ) {
    const plans = await this.planModel.find(filter).lean().exec();
    let created = 0;
    for (const plan of plans) {
      const instructions = this.extractChecklistInstructions(plan.instruction);
      const sourceKeys: string[] = [];
      for (let index = 0; index < instructions.length; index += 1) {
        const sourceKey = `${String(plan._id)}:${index}`;
        sourceKeys.push(sourceKey);
        const result = await this.model
          .updateOne(
            { source_key: sourceKey },
            {
              $set: {
                plan_id: plan._id,
                plan_code: plan.plan_id,
                module_id: plan.module_id,
                instruction: instructions[index],
                responsable: plan.responsable,
              },
              $unset: {
                deleted_at: '',
              },
              $setOnInsert: {
                task_id: `PT-${String(plan._id).slice(-8)}-${index + 1}`,
                status: 'pending',
                source: 'plan',
                source_key: sourceKey,
              },
            },
            { upsert: true },
          )
          .exec();
        if (result.upsertedCount) created += 1;
      }
      await this.model
        .updateMany(
          {
            plan_id: plan._id,
            source: 'plan',
            source_key: { $nin: sourceKeys },
            deleted_at: { $exists: false },
          },
          { $set: { deleted_at: new Date() } },
        )
        .exec();
    }
    return { plans: plans.length, created };
  }

  private extractChecklistInstructions(value?: string): string[] {
    return String(value || '')
      .split(/\r?\n/g)
      .map((item) => item.replace(/^[-*\u2022\s]+/, '').trim())
      .filter((item) => {
        if (!item) return false;
        if (/^checklist\s+for\s+\w+\s*:$/i.test(item)) return false;
        if (/^verification\s+details\s*:$/i.test(item)) return false;
        if (/^(?:photo|mode)\s*:\s*N\/A\s*$/i.test(item)) return false;
        return true;
      });
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    status?: string,
  ): Promise<PaginatedResponse<PreventiveTask>> {
    const filter: FilterQuery<PreventiveTaskDocument> = {
      deleted_at: { $exists: false },
      ...(status ? { status } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('plan_id')
        .populate('module_id')
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPaginatedResponse(items, totalItems, page, limit);
  }
  async findOne(id: string) {
    const item = await this.model
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .populate('plan_id')
      .populate('module_id')
      .exec();
    if (!item) throw new NotFoundException('Preventive task not found');
    return item;
  }
  async update(id: string, dto: UpdatePreventiveTaskDto) {
    const update: Record<string, unknown> = { ...dto };
    if (dto.status === 'completed' && !dto.completed_at)
      update.completed_at = new Date();
    if (dto.status === 'pending') update.completed_at = null;
    const item = await this.model
      .findOneAndUpdate({ _id: id, deleted_at: { $exists: false } }, update, {
        new: true,
        runValidators: true,
      })
      .exec();
    if (!item) throw new NotFoundException('Preventive task not found');
    return item;
  }
  async remove(id: string) {
    const item = await this.model
      .findOneAndUpdate(
        { _id: id, deleted_at: { $exists: false } },
        { deleted_at: new Date() },
        { new: true },
      )
      .exec();
    if (!item) throw new NotFoundException('Preventive task not found');
    return item;
  }
}
