import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { Mesure, MesureDocument } from '../schemas/mesure.schema';
import { CreateMesureDto } from './dto/create-mesure.dto';
import { UpdateMesureDto } from './dto/update-mesure.dto';

@Injectable()
export class MesuresService {
  constructor(
    @InjectModel(Mesure.name) private readonly model: Model<MesureDocument>,
  ) {}

  create(dto: CreateMesureDto) {
    return new this.model(dto).save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    capteurId?: string,
    status?: string,
  ): Promise<PaginatedResponse<Mesure>> {
    const filter: FilterQuery<MesureDocument> = {};
    if (capteurId) filter.capteur_id = capteurId;
    if (status) filter.status = status;
    const [items, totalItems] = await Promise.all([
      this.model
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('capteur_id')
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string) {
    const item = await this.model.findById(id).populate('capteur_id').exec();
    if (!item) throw new NotFoundException('Measurement not found');
    return item;
  }

  async update(id: string, dto: UpdateMesureDto) {
    const item = await this.model
      .findByIdAndUpdate(id, dto, { new: true, runValidators: true })
      .exec();
    if (!item) throw new NotFoundException('Measurement not found');
    return item;
  }

  async remove(id: string) {
    const item = await this.model.findByIdAndDelete(id).exec();
    if (!item) throw new NotFoundException('Measurement not found');
    return item;
  }
}
