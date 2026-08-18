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
import { toMachineTypeSummary } from '../common/response/reference-summaries';
import { MachineTypeResponse } from './contracts/machine-type-response.types';

@Injectable()
export class MachineTypesService {
  constructor(
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(ModuleType.name)
    private readonly moduleTypeModel: Model<ModuleTypeDocument>,
    @InjectModel(KnowledgeArticle.name)
    private readonly knowledgeArticleModel: Model<KnowledgeArticleDocument>,
    private readonly counterService: CounterService,
  ) {}

  async create(dto: CreateMachineTypeDto): Promise<MachineTypeResponse> {
    const nextId = await this.counterService.getNextSequence('machine_type');
    const created = new this.machineTypeModel({
      ...dto,
      type_id: nextId,
    });
    const saved = await created.save();
    return toMachineTypeSummary(saved);
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<MachineTypeResponse>> {
    const [items, totalItems] = await Promise.all([
      this.machineTypeModel
        .find()
        .sort({ type_id: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.machineTypeModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(
      items.map(toMachineTypeSummary),
      totalItems,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<MachineTypeResponse | null> {
    const found = await this.machineTypeModel.findById(id).exec();
    return found ? toMachineTypeSummary(found) : null;
  }

  async update(
    id: string,
    updateMachineTypeDto: UpdateMachineTypeDto,
  ): Promise<MachineTypeResponse | null> {
    const updated = await this.machineTypeModel
      .findByIdAndUpdate(id, updateMachineTypeDto, { new: true })
      .exec();
    return updated ? toMachineTypeSummary(updated) : null;
  }

  async remove(id: string): Promise<MachineTypeResponse | null> {
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
    const removed = await this.machineTypeModel.findByIdAndDelete(id).exec();
    return removed ? toMachineTypeSummary(removed) : null;
  }
}
