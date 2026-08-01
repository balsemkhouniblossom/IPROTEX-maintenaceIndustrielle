import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { KPI, KPIDocument } from '../schemas/kpi.schema';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { CreateKpiDto } from './dto/create-kpi.dto';
import { UpdateKpiDto } from './dto/update-kpi.dto';

@Injectable()
export class KpisService {
  constructor(
    @InjectModel(KPI.name) private readonly kpiModel: Model<KPIDocument>,
  ) {}

  create(payload: CreateKpiDto) {
    return new this.kpiModel(payload).save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<KPI>> {
    const [items, totalItems] = await Promise.all([
      this.kpiModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate('machine_id')
        .exec(),
      this.kpiModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string) {
    return this.kpiModel.findById(id).populate('machine_id').exec();
  }

  update(id: string, payload: UpdateKpiDto) {
    return this.kpiModel.findByIdAndUpdate(id, payload, { new: true }).exec();
  }

  remove(id: string) {
    return this.kpiModel.findByIdAndDelete(id).exec();
  }
}
