import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import { Capteur, CapteurDocument } from '../schemas/capteur.schema';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../schemas/lubrification-log.schema';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { CreateModuleDto } from './dto/create-module.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { assertNoDependencies } from '../common/dependency-protection';

@Injectable()
export class ModulesService {
  constructor(
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(Capteur.name)
    private readonly capteurModel: Model<CapteurDocument>,
    @InjectModel(LubrificationLog.name)
    private readonly lubrificationLogModel: Model<LubrificationLogDocument>,
  ) {}

  create(payload: CreateModuleDto) {
    return new this.moduleModel(payload).save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<ModuleEntity>> {
    const [items, totalItems] = await Promise.all([
      this.moduleModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate('machine_id')
        .populate('mod_type_id')
        .populate('parent_module_id')
        .exec(),
      this.moduleModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string) {
    return this.moduleModel
      .findById(id)
      .populate('machine_id')
      .populate('mod_type_id')
      .populate('parent_module_id')
      .exec();
  }

  update(id: string, payload: UpdateModuleDto) {
    return this.moduleModel
      .findByIdAndUpdate(id, payload, { new: true })
      .exec();
  }

  async remove(id: string) {
    await assertNoDependencies('Module', [
      {
        label: 'child modules',
        model: this.moduleModel,
        filter: { parent_module_id: id },
      },
      {
        label: 'work orders',
        model: this.workOrderModel,
        filter: { module_id: id },
      },
      {
        label: 'maintenance plans',
        model: this.maintenancePlanModel,
        filter: { module_id: id },
      },
      { label: 'sensors', model: this.capteurModel, filter: { module_id: id } },
      {
        label: 'lubrication logs',
        model: this.lubrificationLogModel,
        filter: { module_id: id },
      },
    ]);
    return this.moduleModel.findByIdAndDelete(id).exec();
  }
}
