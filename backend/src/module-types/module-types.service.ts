import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModuleType, ModuleTypeDocument } from '../schemas/module-type.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import {
  ModulePieces,
  ModulePiecesDocument,
} from '../schemas/module-pieces.schema';
import { CreateModuleTypeDto } from './dto/create-module-type.dto';
import { UpdateModuleTypeDto } from './dto/update-module-type.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { assertNoDependencies } from '../common/dependency-protection';

@Injectable()
export class ModuleTypesService {
  constructor(
    @InjectModel(ModuleType.name)
    private readonly moduleTypeModel: Model<ModuleTypeDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(ModulePieces.name)
    private readonly modulePiecesModel: Model<ModulePiecesDocument>,
  ) {}

  async create(createModuleTypeDto: CreateModuleTypeDto): Promise<ModuleType> {
    const createdModuleType = new this.moduleTypeModel(createModuleTypeDto);
    return createdModuleType.save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<ModuleType>> {
    const [items, totalItems] = await Promise.all([
      this.moduleTypeModel.find().skip(skip).limit(limit).exec(),
      this.moduleTypeModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string): Promise<any> {
    return this.moduleTypeModel.findById(id).exec();
  }

  async update(
    id: string,
    updateModuleTypeDto: UpdateModuleTypeDto,
  ): Promise<any> {
    return this.moduleTypeModel
      .findByIdAndUpdate(id, updateModuleTypeDto, { new: true })
      .exec();
  }

  async remove(id: string): Promise<any> {
    await assertNoDependencies('Module type', [
      {
        label: 'modules',
        model: this.moduleModel,
        filter: { mod_type_id: id },
      },
      {
        label: 'module part standards',
        model: this.modulePiecesModel,
        filter: { mod_type_id: id },
      },
    ]);
    return this.moduleTypeModel.findByIdAndDelete(id).exec();
  }
}
