import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { CreateInterventionReportDto } from './dto/create-intervention-report.dto';
import { UpdateInterventionReportDto } from './dto/update-intervention-report.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { SAFE_USER_PROJECTION } from '../users/safe-user-projection';

@Injectable()
export class InterventionReportsService {
  constructor(
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
  ) {}

  async create(
    createInterventionReportDto: CreateInterventionReportDto,
  ): Promise<InterventionReport> {
    const createdInterventionReport = new this.interventionReportModel(
      createInterventionReportDto,
    );
    return createdInterventionReport.save();
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<InterventionReport>> {
    const [items, totalItems] = await Promise.all([
      this.interventionReportModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate('ot_id')
        .populate('technician_id', SAFE_USER_PROJECTION)
        .exec(),
      this.interventionReportModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async findOne(id: string): Promise<InterventionReport | null> {
    return this.interventionReportModel
      .findById(id)
      .populate('ot_id')
      .populate('technician_id', SAFE_USER_PROJECTION)
      .exec();
  }

  async update(
    id: string,
    updateInterventionReportDto: UpdateInterventionReportDto,
  ): Promise<InterventionReport | null> {
    return this.interventionReportModel
      .findByIdAndUpdate(id, updateInterventionReportDto, { new: true })
      .populate('ot_id')
      .populate('technician_id', SAFE_USER_PROJECTION)
      .exec();
  }

  async remove(id: string): Promise<InterventionReport | null> {
    return this.interventionReportModel.findByIdAndDelete(id).exec();
  }
}
