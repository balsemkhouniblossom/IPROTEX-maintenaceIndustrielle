import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MachineType,
  MachineTypeDocument,
} from '../schemas/machine-type.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { ModuleType, ModuleTypeDocument } from '../schemas/module-type.schema';
import {
  KnowledgeArticle,
  KnowledgeArticleDocument,
} from '../schemas/knowledge-article.schema';
import { CreateMachineTypeDto } from './dto/create-machine-type.dto';
import { UpdateMachineTypeDto } from './dto/update-machine-type.dto';
import { CounterService } from '../counters/counter.service';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { assertNoDependencies } from '../common/dependency-protection';

@Injectable()
export class MachineTypesService {
  constructor(
    @InjectModel(MachineType.name)
    private machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(Machine.name) private machineModel: Model<MachineDocument>,
    @InjectModel(ModuleType.name)
    private moduleTypeModel: Model<ModuleTypeDocument>,
    @InjectModel(KnowledgeArticle.name)
    private knowledgeArticleModel: Model<KnowledgeArticleDocument>,
    private counterService: CounterService,
  ) {}

  async create(dto: CreateMachineTypeDto): Promise<MachineType> {
    const nextId = await this.counterService.getNextSequence('machine_type');
    const created = new this.machineTypeModel({
      ...dto,
      type_id: nextId,
    });
    return created.save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<MachineType>> {
    const [items, totalItems] = await Promise.all([
      this.machineTypeModel
        .find()
        .sort({ type_id: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.machineTypeModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string): Promise<any> {
    return this.machineTypeModel.findById(id).exec();
  }

  async update(
    id: string,
    updateMachineTypeDto: UpdateMachineTypeDto,
  ): Promise<any> {
    return this.machineTypeModel
      .findByIdAndUpdate(id, updateMachineTypeDto, { new: true })
      .exec();
  }

  async remove(id: string): Promise<any> {
    await assertNoDependencies('Machine type', [
      { label: 'machines', model: this.machineModel, filter: { type_id: id } },
      {
        label: 'module types',
        model: this.moduleTypeModel,
        filter: { type_id: id },
      },
      {
        label: 'knowledge articles',
        model: this.knowledgeArticleModel,
        filter: { machine_type_id: id },
      },
    ]);
    return this.machineTypeModel.findByIdAndDelete(id).exec();
  }
}
