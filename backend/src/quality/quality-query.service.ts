import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { normalizePagination, toPaginatedResponse } from '../common/pagination';
import {
  ProductDefectCatalogue,
  ProductDefectCatalogueDocument,
} from '../schemas/product-defect-catalogue.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceDocument,
  QualityDefectSource,
} from '../schemas/quality-defect-occurrence.schema';

@Injectable()
export class QualityQueryService {
  constructor(
    @InjectModel(ProductDefectCatalogue.name)
    private readonly catalogueModel: Model<ProductDefectCatalogueDocument>,
    @InjectModel(QualityDefectOccurrence.name)
    private readonly occurrenceModel: Model<QualityDefectOccurrenceDocument>,
  ) {}
  async catalogue(page?: string, limit?: string, process?: string) {
    const p = normalizePagination(page, limit);
    const filter = process ? { normalized_process: process } : {};
    const [items, count] = await Promise.all([
      this.catalogueModel
        .find(filter)
        .sort({ defect_code: 1 })
        .skip(p.skip)
        .limit(p.limit)
        .lean()
        .exec(),
      this.catalogueModel.countDocuments(filter).exec(),
    ]);
    return toPaginatedResponse(items, count, p.page, p.limit);
  }
  async catalogueCode(code: string) {
    if (!/^F\d{3}$/.test(code))
      throw new BadRequestException('Invalid defect code');
    const item = await this.catalogueModel
      .findOne({ defect_code: code })
      .lean()
      .exec();
    if (!item) throw new NotFoundException('Defect code not found');
    return item;
  }
  async defects(query: {
    page?: string;
    limit?: string;
    year?: string;
    month?: string;
    process?: string;
    defectCode?: string;
    source?: string;
  }) {
    const p = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = {};
    if (query.process) filter.process = query.process;
    if (query.defectCode) {
      if (!/^F\d{3}$/.test(query.defectCode))
        throw new BadRequestException('Invalid defectCode');
      filter.defect_code = query.defectCode;
    }
    if (query.source) {
      if (
        !Object.values(QualityDefectSource).includes(
          query.source as QualityDefectSource,
        )
      )
        throw new BadRequestException('Invalid source');
      filter.source = query.source;
    }
    if (query.year || query.month) {
      const year = Number(query.year);
      const month = query.month ? Number(query.month) : 1;
      if (
        !Number.isInteger(year) ||
        year < 2000 ||
        year > 2100 ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
      )
        throw new BadRequestException('Invalid year/month');
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, query.month ? month : 12, 1));
      filter.occurrence_date = { $gte: start, $lt: end };
    }
    const [items, count] = await Promise.all([
      this.occurrenceModel
        .find(filter)
        .sort({ occurrence_date: -1, _id: -1 })
        .skip(p.skip)
        .limit(p.limit)
        .lean()
        .exec(),
      this.occurrenceModel.countDocuments(filter).exec(),
    ]);
    return toPaginatedResponse(items, count, p.page, p.limit);
  }
  async defect(id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid defect id');
    const item = await this.occurrenceModel.findById(id).lean().exec();
    if (!item) throw new NotFoundException('Quality defect not found');
    return item;
  }
}
