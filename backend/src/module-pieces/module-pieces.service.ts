import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import {
  ModulePieces,
  ModulePiecesDocument,
} from '../schemas/module-pieces.schema';
import { CreateModulePieceDto } from './dto/create-module-piece.dto';
import { UpdateModulePieceDto } from './dto/update-module-piece.dto';

@Injectable()
export class ModulePiecesService {
  constructor(
    @InjectModel(ModulePieces.name)
    private readonly model: Model<ModulePiecesDocument>,
  ) {}
  create(dto: CreateModulePieceDto) {
    return new this.model(dto).save();
  }
  async findAll(
    page: number,
    limit: number,
    skip: number,
    moduleTypeId?: string,
  ): Promise<PaginatedResponse<ModulePieces>> {
    const filter: FilterQuery<ModulePiecesDocument> = moduleTypeId
      ? { mod_type_id: moduleTypeId }
      : {};
    const [items, totalItems] = await Promise.all([
      this.model
        .find(filter)
        .skip(skip)
        .limit(limit)
        .populate('mod_type_id')
        .populate('part_id')
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPaginatedResponse(items, totalItems, page, limit);
  }
  async findOne(id: string) {
    const item = await this.model
      .findById(id)
      .populate('mod_type_id')
      .populate('part_id')
      .exec();
    if (!item) throw new NotFoundException('Module part standard not found');
    return item;
  }
  async update(id: string, dto: UpdateModulePieceDto) {
    const item = await this.model
      .findByIdAndUpdate(id, dto, { new: true, runValidators: true })
      .exec();
    if (!item) throw new NotFoundException('Module part standard not found');
    return item;
  }
  async remove(id: string) {
    const item = await this.model.findByIdAndDelete(id).exec();
    if (!item) throw new NotFoundException('Module part standard not found');
    return item;
  }
}
