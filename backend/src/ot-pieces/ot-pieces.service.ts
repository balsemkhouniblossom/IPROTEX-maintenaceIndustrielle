import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OTPieces, OTPiecesDocument } from '../schemas/ot-pieces.schema';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { CreateOtPieceDto } from './dto/create-ot-piece.dto';
import { UpdateOtPieceDto } from './dto/update-ot-piece.dto';

@Injectable()
export class OtPiecesService {
  constructor(
    @InjectModel(OTPieces.name)
    private readonly otPiecesModel: Model<OTPiecesDocument>,
  ) {}

  create(payload: CreateOtPieceDto) {
    return new this.otPiecesModel(payload).save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<OTPieces>> {
    const [items, totalItems] = await Promise.all([
      this.otPiecesModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate('ot_id')
        .populate('part_id')
        .exec(),
      this.otPiecesModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string) {
    return this.otPiecesModel
      .findById(id)
      .populate('ot_id')
      .populate('part_id')
      .exec();
  }

  update(id: string, payload: UpdateOtPieceDto) {
    return this.otPiecesModel
      .findByIdAndUpdate(id, payload, { new: true })
      .exec();
  }

  remove(id: string) {
    return this.otPiecesModel.findByIdAndDelete(id).exec();
  }
}
