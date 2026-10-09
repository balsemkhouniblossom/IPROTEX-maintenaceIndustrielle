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
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { Module, ModuleDocument } from '../schemas/module.schema';

@Injectable()
export class PreventiveTasksService {
  constructor(
    @InjectModel(PreventiveTask.name)
    private readonly model: Model<PreventiveTaskDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly planModel: Model<MaintenancePlanDocument>,
    @InjectModel(Module.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
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

  async syncPlanWithTemplateDetails(planId: Types.ObjectId) {
    const plan = await this.planModel.findById(planId).lean().exec();
    if (!plan) throw new NotFoundException('Maintenance plan not found');

    let instructions = this.extractChecklistInstructions(plan.instruction);
    const maintenanceCodes = String(plan.maintenance_code || '')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const hasDetailedCodeInstructions = maintenanceCodes.every((code) =>
      instructions.some((instruction) =>
        new RegExp(String.raw`^${code}\s*:\s*\S`, 'i').test(instruction),
      ),
    );

    if (maintenanceCodes.length > 0 && !hasDetailedCodeInstructions) {
      const targetModule = await this.moduleModel
        .findById(plan.module_id)
        .select({ machine_id: 1 })
        .lean()
        .exec();
      const targetMachine = targetModule
        ? await this.machineModel
            .findById(targetModule.machine_id)
            .select({ type_id: 1 })
            .lean()
            .exec()
        : null;
      const processMachineIds = targetMachine
        ? await this.machineModel
            .find({ type_id: targetMachine.type_id })
            .distinct('_id')
            .exec()
        : [];
      const processModuleIds = processMachineIds.length
        ? await this.moduleModel
            .find({ machine_id: { $in: processMachineIds } })
            .distinct('_id')
            .exec()
        : [];

      const templates = await this.planModel
        .find({
          _id: { $ne: plan._id },
          module_id: { $in: processModuleIds },
          maintenance_code: { $in: maintenanceCodes },
          instruction: { $exists: true, $ne: '' },
        })
        .lean()
        .exec();
      const detailedInstructions = maintenanceCodes.flatMap((code) => {
        const matchingTemplates = templates.filter(
          (candidate) =>
            String(candidate.maintenance_code || '')
              .trim()
              .toUpperCase() === code,
        );
        const template =
          matchingTemplates.find(
            (candidate) =>
              String(candidate.module_id) === String(plan.module_id),
          ) || matchingTemplates[0];
        return this.extractChecklistInstructions(template?.instruction).map(
          (instruction) =>
            new RegExp(String.raw`^${code}\s*:`, 'i').test(instruction)
              ? instruction
              : `${code}: ${instruction}`,
        );
      });
      if (detailedInstructions.length > 0) {
        instructions = detailedInstructions;
      }
    }

    const created = await this.syncPlan(plan, instructions);
    return { plans: 1, created };
  }

  private async syncPlansMatching(
    filter: FilterQuery<MaintenancePlanDocument>,
  ) {
    const plans = await this.planModel.find(filter).lean().exec();
    const created = (
      await Promise.all(
        plans.map((plan) =>
          this.syncPlan(
            plan,
            this.extractChecklistInstructions(plan.instruction),
          ),
        ),
      )
    ).reduce((total, count) => total + count, 0);
    return { plans: plans.length, created };
  }

  private async syncPlan(
    plan: MaintenancePlanDocument | (MaintenancePlan & { _id: Types.ObjectId }),
    instructions: string[],
  ): Promise<number> {
    const sourceKeys = instructions.map(
      (_, index) => `${String(plan._id)}:${index}`,
    );
    const upserts = await Promise.all(
      instructions.map((instruction, index) => {
        const sourceKey = `${String(plan._id)}:${index}`;
        return this.model
          .updateOne(
            { source_key: sourceKey },
            {
              $set: {
                plan_id: plan._id,
                plan_code: plan.plan_id,
                module_id: plan.module_id,
                instruction,
                responsable: plan.responsable,
              },
              $unset: { deleted_at: '' },
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
      }),
    );
    const created = upserts.reduce(
      (total, result) => total + result.upsertedCount,
      0,
    );
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
    return created;
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
