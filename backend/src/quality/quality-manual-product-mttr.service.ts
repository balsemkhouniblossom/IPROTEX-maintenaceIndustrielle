import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  getBusinessTimezone,
  startOfBusinessYear,
} from '../common/business-time';
import {
  MachineType,
  MachineTypeDocument,
} from '../schemas/machine-type.schema';
import {
  ProductQualityMttrEntry,
  ProductQualityMttrEntryDocument,
} from '../schemas/product-quality-mttr-entry.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceDocument,
  QualityDefectSource,
} from '../schemas/quality-defect-occurrence.schema';
import { SaveManualProductMttrDto } from './dto/save-manual-product-mttr.dto';

@Injectable()
export class QualityManualProductMttrService {
  constructor(
    @InjectModel(ProductQualityMttrEntry.name)
    private readonly entryModel: Model<ProductQualityMttrEntryDocument>,
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(QualityDefectOccurrence.name)
    private readonly occurrenceModel: Model<QualityDefectOccurrenceDocument>,
  ) {}

  private parseYear(value?: string | number): number {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      throw new BadRequestException('Invalid year');
    }
    return year;
  }

  async getYear(yearInput?: string | number) {
    const year = this.parseYear(yearInput);
    const timeZone = getBusinessTimezone();
    const yearStart = startOfBusinessYear(
      new Date(Date.UTC(year, 6, 1, 12)),
      timeZone,
    );
    const nextYearStart = startOfBusinessYear(
      new Date(Date.UTC(year + 1, 6, 1, 12)),
      timeZone,
    );
    const [machineTypes, entries, historical, storedYears] = await Promise.all([
      this.machineTypeModel.find({}).sort({ name: 1 }).lean().exec(),
      this.entryModel.find({ year }).lean().exec(),
      this.occurrenceModel
        .aggregate<{
          _id: { process: string; month: number };
          defectCount: number;
          defectCodes: string[];
        }>([
          {
            $match: {
              source: QualityDefectSource.HISTORICAL_IMPORT,
              occurrence_date: { $gte: yearStart, $lt: nextYearStart },
            },
          },
          {
            $group: {
              _id: {
                process: '$process',
                month: {
                  $month: { date: '$occurrence_date', timezone: timeZone },
                },
              },
              defectCount: { $sum: '$quantity_affected' },
              defectCodes: { $addToSet: '$defect_code' },
            },
          },
          { $sort: { '_id.process': 1, '_id.month': 1 } },
        ])
        .exec(),
      this.entryModel.distinct('year').exec(),
    ]);
    const entryMap = new Map(
      entries.map((entry) => [
        `${entry.machine_type_id.toString()}:${entry.month}`,
        entry,
      ]),
    );
    return {
      year,
      timeZone,
      availableYears: [...new Set([year, ...storedYears])].sort(
        (left, right) => right - left,
      ),
      processes: machineTypes.map((machineType) => ({
        machineTypeId: machineType._id.toString(),
        name: machineType.name,
        months: Array.from({ length: 12 }, (_, index) => {
          const month = index + 1;
          const entry = entryMap.get(`${machineType._id.toString()}:${month}`);
          return {
            month,
            mttrMinutes: entry?.mttr_minutes ?? null,
            updatedAt: entry?.updatedAt ?? null,
          };
        }),
      })),
      historical: historical.map((item) => ({
        process: item._id.process,
        month: item._id.month,
        defectCount: item.defectCount,
        defectCodes: item.defectCodes.sort(),
      })),
    };
  }

  async save(input: SaveManualProductMttrDto, userId: string) {
    const year = this.parseYear(input.year);
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invalid authenticated user');
    const keys = input.entries.map(
      (entry) => `${entry.machineTypeId}:${entry.month}`,
    );
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('Duplicate process/month entry');
    const machineTypeIds = [
      ...new Set(input.entries.map((entry) => entry.machineTypeId)),
    ];
    const existingCount = await this.machineTypeModel
      .countDocuments({ _id: { $in: machineTypeIds } })
      .exec();
    if (existingCount !== machineTypeIds.length)
      throw new BadRequestException('Unknown machine type');
    const actor = new Types.ObjectId(userId);
    if (input.entries.length > 0) {
      await this.entryModel.bulkWrite(
        input.entries.map((entry) => {
          const filter = {
            year,
            month: entry.month,
            machine_type_id: new Types.ObjectId(entry.machineTypeId),
          };
          if (entry.mttrMinutes === null) return { deleteOne: { filter } };
          return {
            updateOne: {
              filter,
              update: {
                $set: { mttr_minutes: entry.mttrMinutes, updated_by: actor },
                $setOnInsert: { entered_by: actor },
              },
              upsert: true,
            },
          };
        }),
      );
    }
    return this.getYear(year);
  }
}
