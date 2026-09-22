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
  ProductQualityMonthlyDefects,
  ProductQualityMonthlyDefectsDocument,
} from '../schemas/product-quality-monthly-defects.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceDocument,
  QualityDefectSource,
} from '../schemas/quality-defect-occurrence.schema';
import { SaveManualProductMttrDto } from './dto/save-manual-product-mttr.dto';
import { normalizeQualityProcessName } from './quality-process-name';

@Injectable()
export class QualityManualProductMttrService {
  constructor(
    @InjectModel(ProductQualityMttrEntry.name)
    private readonly entryModel: Model<ProductQualityMttrEntryDocument>,
    @InjectModel(ProductQualityMonthlyDefects.name)
    private readonly defectModel: Model<ProductQualityMonthlyDefectsDocument>,
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
    const [
      machineTypes,
      entries,
      manualDefects,
      historical,
      mttrYears,
      defectYears,
    ] = await Promise.all([
      this.machineTypeModel.find({}).sort({ name: 1 }).lean().exec(),
      this.entryModel.find({ year }).lean().exec(),
      this.defectModel.find({ year }).lean().exec(),
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
      this.defectModel.distinct('year').exec(),
    ]);
    const entryMap = new Map(
      entries.map((entry) => [
        `${entry.machine_type_id.toString()}:${entry.month}`,
        entry,
      ]),
    );
    const historicalByProcessMonth = new Map<
      string,
      {
        process: string;
        month: number;
        defectCount: number;
        defectCodes: Set<string>;
      }
    >();
    for (const item of historical) {
      const process = normalizeQualityProcessName(item._id.process);
      const key = `${process}:${item._id.month}`;
      const existing = historicalByProcessMonth.get(key) ?? {
        process,
        month: item._id.month,
        defectCount: 0,
        defectCodes: new Set<string>(),
      };
      existing.defectCount += item.defectCount;
      item.defectCodes.forEach((code) => existing.defectCodes.add(code));
      historicalByProcessMonth.set(key, existing);
    }
    const manualDefectMap = new Map(
      manualDefects.map((entry) => [
        `${entry.machine_type_id.toString()}:${entry.month}`,
        entry,
      ]),
    );
    return {
      year,
      timeZone,
      availableYears: [...new Set([year, ...mttrYears, ...defectYears])].sort(
        (left, right) => right - left,
      ),
      processes: machineTypes.map((machineType) => ({
        machineTypeId: machineType._id.toString(),
        name: machineType.name,
        months: Array.from({ length: 12 }, (_, index) => {
          const month = index + 1;
          const entry = entryMap.get(`${machineType._id.toString()}:${month}`);
          const manualDefect = manualDefectMap.get(
            `${machineType._id.toString()}:${month}`,
          );
          const officialDefect = historicalByProcessMonth.get(
            `${normalizeQualityProcessName(machineType.name)}:${month}`,
          );
          const storedUnit = (entry as { unit?: string } | undefined)?.unit;
          let mttrValue: number | null = entry?.mttr_value ?? null;
          if (mttrValue !== null && storedUnit === 'HOURS') mttrValue *= 60;
          let defectSource: 'OFFICIAL_IMPORT' | 'MANUAL' | null = null;
          if (officialDefect) defectSource = 'OFFICIAL_IMPORT';
          else if (manualDefect) defectSource = 'MANUAL';
          return {
            month,
            mttrValue,
            unit: 'MINUTES' as const,
            updatedAt: entry?.updatedAt ?? null,
            defectCount:
              officialDefect?.defectCount ?? manualDefect?.defect_count ?? null,
            defectSource,
            defectReadOnly: Boolean(officialDefect),
            defectCodes: officialDefect
              ? [...officialDefect.defectCodes].sort((left, right) =>
                  left.localeCompare(right),
                )
              : [],
            defectUpdatedAt: manualDefect?.updatedAt ?? null,
          };
        }),
      })),
      historical: [...historicalByProcessMonth.values()]
        .map((item) => ({
          process: item.process,
          month: item.month,
          defectCount: item.defectCount,
          defectCodes: [...item.defectCodes].sort((left, right) =>
            left.localeCompare(right),
          ),
        }))
        .sort(
          (left, right) =>
            left.process.localeCompare(right.process) ||
            left.month - right.month,
        ),
    };
  }

  async save(input: SaveManualProductMttrDto, userId: string) {
    const year = this.parseYear(input.year);
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invalid authenticated user');
    const defectEntries = input.defectEntries ?? [];
    const keys = input.entries.map(
      (entry) => `${entry.machineTypeId}:${entry.month}`,
    );
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('Duplicate process/month entry');
    const defectKeys = defectEntries.map(
      (entry) => `${entry.machineTypeId}:${entry.month}`,
    );
    if (new Set(defectKeys).size !== defectKeys.length)
      throw new BadRequestException('Duplicate defect process/month entry');
    const machineTypeIds = [
      ...new Set(
        [...input.entries, ...defectEntries].map(
          (entry) => entry.machineTypeId,
        ),
      ),
    ];
    const selectedMachineTypes = await this.machineTypeModel
      .find({ _id: { $in: machineTypeIds } })
      .lean()
      .exec();
    const existingCount = selectedMachineTypes.length;
    if (existingCount !== machineTypeIds.length)
      throw new BadRequestException('Unknown machine type');
    const actor = new Types.ObjectId(userId);
    if (defectEntries.length > 0) {
      const officialCells = await this.getOfficialCellKeys(year);
      const machineTypeNames = new Map(
        selectedMachineTypes.map((item) => [
          item._id.toString(),
          normalizeQualityProcessName(item.name),
        ]),
      );
      const hasProtectedEntry = defectEntries.some((entry) =>
        officialCells.has(
          `${machineTypeNames.get(entry.machineTypeId)}:${entry.month}`,
        ),
      );
      if (hasProtectedEntry)
        throw new BadRequestException(
          'Official imported defect data cannot be overwritten',
        );
    }
    if (input.entries.length > 0) {
      await this.entryModel.bulkWrite(
        input.entries.map((entry) => {
          const filter = {
            year,
            month: entry.month,
            machine_type_id: new Types.ObjectId(entry.machineTypeId),
          };
          if (entry.mttrValue === null) return { deleteOne: { filter } };
          return {
            updateOne: {
              filter,
              update: {
                $set: {
                  mttr_value: entry.mttrValue,
                  unit: 'MINUTES',
                  updated_by: actor,
                },
                $setOnInsert: { entered_by: actor },
              },
              upsert: true,
            },
          };
        }),
      );
    }
    if (defectEntries.length > 0) {
      await this.defectModel.bulkWrite(
        defectEntries.map((entry) => {
          const filter = {
            year,
            month: entry.month,
            machine_type_id: new Types.ObjectId(entry.machineTypeId),
          };
          if (entry.defectCount === null) return { deleteOne: { filter } };
          return {
            updateOne: {
              filter,
              update: {
                $set: {
                  defect_count: entry.defectCount,
                  source: 'MANUAL',
                  updated_by: actor,
                },
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

  private async getOfficialCellKeys(year: number): Promise<Set<string>> {
    const timeZone = getBusinessTimezone();
    const yearStart = startOfBusinessYear(
      new Date(Date.UTC(year, 6, 1, 12)),
      timeZone,
    );
    const nextYearStart = startOfBusinessYear(
      new Date(Date.UTC(year + 1, 6, 1, 12)),
      timeZone,
    );
    const cells = await this.occurrenceModel
      .aggregate<{ _id: { process: string; month: number } }>([
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
          },
        },
      ])
      .exec();
    return new Set(
      cells.map(
        (cell) =>
          `${normalizeQualityProcessName(cell._id.process)}:${cell._id.month}`,
      ),
    );
  }
}
