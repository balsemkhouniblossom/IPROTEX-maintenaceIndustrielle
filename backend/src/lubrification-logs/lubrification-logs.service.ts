import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../schemas/lubrification-log.schema';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { SAFE_USER_PROJECTION } from '../users/safe-user-projection';
import { CreateLubrificationLogDto } from './dto/create-lubrification-log.dto';
import { UpdateLubrificationLogDto } from './dto/update-lubrification-log.dto';

@Injectable()
export class LubrificationLogsService {
  constructor(
    @InjectModel(LubrificationLog.name)
    private readonly lubrificationLogModel: Model<LubrificationLogDocument>,
  ) {}

  create(payload: CreateLubrificationLogDto) {
    return new this.lubrificationLogModel(payload).save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<LubrificationLog>> {
    const [items, totalItems] = await Promise.all([
      this.lubrificationLogModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate('module_id')
        .populate('lubrifiant_id')
        .populate('technician_id', SAFE_USER_PROJECTION)
        .exec(),
      this.lubrificationLogModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string) {
    return this.lubrificationLogModel
      .findById(id)
      .populate('module_id')
      .populate('lubrifiant_id')
      .populate('technician_id', SAFE_USER_PROJECTION)
      .exec();
  }

  update(id: string, payload: UpdateLubrificationLogDto) {
    return this.lubrificationLogModel
      .findByIdAndUpdate(id, payload, { new: true })
      .exec();
  }

  remove(id: string) {
    return this.lubrificationLogModel.findByIdAndDelete(id).exec();
  }
}
