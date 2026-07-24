import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
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
    const plans = await this.planModel
      .find({
        type_maintenance: /prevent/i,
        instruction: { $exists: true, $ne: '' },
      })
      .lean()
      .exec();
    let created = 0;
    for (const plan of plans) {
      const instructions = String(plan.instruction)
        .split(/\r?\n|[;,]/g)
        .map((item) => item.replace(/^[-*\u2022\s]+/, '').trim())
        .filter(Boolean);
      for (let index = 0; index < instructions.length; index += 1) {
        const sourceKey = `${String(plan._id)}:${index}`;
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
    }
    return { plans: plans.length, created };
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
