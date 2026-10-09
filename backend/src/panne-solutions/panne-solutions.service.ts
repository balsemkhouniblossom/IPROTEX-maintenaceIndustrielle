import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../schemas/panne-solution.schema';
import { CreatePanneSolutionDto } from './dto/create-panne-solution.dto';
import { UpdatePanneSolutionDto } from './dto/update-panne-solution.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';

@Injectable()
export class PanneSolutionsService {
  constructor(
    @InjectModel(PanneSolution.name)
    private readonly panneSolutionModel: Model<PanneSolutionDocument>,
  ) {}

  create(
    createPanneSolutionDto: CreatePanneSolutionDto,
  ): Promise<PanneSolution> {
    const createdPanneSolution = new this.panneSolutionModel(
      createPanneSolutionDto,
    );
    return createdPanneSolution.save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<PanneSolution>> {
    const [items, totalItems] = await Promise.all([
      this.panneSolutionModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate('panne_id')
        .exec(),
      this.panneSolutionModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string): Promise<PanneSolution | null> {
    return this.panneSolutionModel.findById(id).populate('panne_id').exec();
  }

  update(
    id: string,
    updatePanneSolutionDto: UpdatePanneSolutionDto,
  ): Promise<PanneSolution | null> {
    return this.panneSolutionModel
      .findByIdAndUpdate(id, updatePanneSolutionDto, { new: true })
      .populate('panne_id')
      .exec();
  }

  remove(id: string): Promise<PanneSolution | null> {
    return this.panneSolutionModel.findByIdAndDelete(id).exec();
  }
}
