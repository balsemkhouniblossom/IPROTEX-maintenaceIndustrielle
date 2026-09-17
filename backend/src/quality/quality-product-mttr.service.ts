import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  getBusinessTimezone,
  startOfBusinessYear,
} from '../common/business-time';
import {
  ProductQualityMonthlyMttr,
  ProductQualityMonthlyMttrDocument,
} from '../schemas/product-quality-monthly-mttr.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceDocument,
  QualityDefectSource,
} from '../schemas/quality-defect-occurrence.schema';
import { UpsertProductQualityMonthDto } from './dto/upsert-product-quality-month.dto';

@Injectable()
export class QualityProductMttrService {
  constructor(
    @InjectModel(ProductQualityMonthlyMttr.name)
    private readonly monthlyModel: Model<ProductQualityMonthlyMttrDocument>,
    @InjectModel(QualityDefectOccurrence.name)
    private readonly occurrenceModel: Model<QualityDefectOccurrenceDocument>,
  ) {}

  private parseYear(value?: string): number {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new BadRequestException('Invalid year');
    return year;
  }

  private parseMonth(value: string): number {
    const month = Number(value);
    if (!Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException('Invalid month');
    return month;
  }

  async getYear(yearInput?: string) {
    const year = this.parseYear(yearInput);
    const timeZone = getBusinessTimezone();
    const yearAnchor = new Date(Date.UTC(year, 6, 1, 12));
    const nextYearAnchor = new Date(Date.UTC(year + 1, 6, 1, 12));
    const [manualEntries, historicalRows, manualYears, historicalYears] =
      await Promise.all([
        this.monthlyModel.find({ year }).sort({ month: 1 }).lean().exec(),
        this.occurrenceModel
          .aggregate<{ _id: number; count: number }>([
            {
              $match: {
                source: QualityDefectSource.HISTORICAL_IMPORT,
                occurrence_date: {
                  $gte: startOfBusinessYear(yearAnchor, timeZone),
                  $lt: startOfBusinessYear(nextYearAnchor, timeZone),
                },
              },
            },
            {
              $group: {
                _id: {
                  $month: { date: '$occurrence_date', timezone: timeZone },
                },
                count: { $sum: '$quantity_affected' },
              },
            },
          ])
          .exec(),
        this.monthlyModel.distinct('year').exec(),
        this.occurrenceModel
          .aggregate<{ _id: number }>([
            { $match: { source: QualityDefectSource.HISTORICAL_IMPORT } },
            {
              $group: {
                _id: {
                  $year: { date: '$occurrence_date', timezone: timeZone },
                },
              },
            },
          ])
          .exec(),
      ]);
    const manualByMonth = new Map(
      manualEntries.map((item) => [item.month, item]),
    );
    const historicalByMonth = new Map(
      historicalRows.map((item) => [item._id, item.count]),
    );
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const manual = manualByMonth.get(month);
      const totalResolutionSeconds = manual
        ? manual.total_resolution_minutes * 60
        : null;
      return {
        month,
        historicalDefects: historicalByMonth.get(month) ?? 0,
        resolvedDefects: manual?.resolved_defects ?? null,
        totalResolutionMinutes: manual?.total_resolution_minutes ?? null,
        totalResolutionSeconds,
        mttrSeconds: manual
          ? (manual.total_resolution_minutes * 60) / manual.resolved_defects
          : null,
        note: manual?.note ?? null,
        source: manual ? 'MANUAL_MONTHLY_ENTRY' : null,
        enteredBy: manual?.entered_by?.toString() ?? null,
        updatedBy: manual?.updated_by?.toString() ?? null,
        createdAt: manual?.createdAt ?? null,
        updatedAt: manual?.updatedAt ?? null,
      };
    });
    const populated = months.filter((month) => month.resolvedDefects !== null);
    const totalResolvedDefects = populated.reduce(
      (sum, month) => sum + (month.resolvedDefects ?? 0),
      0,
    );
    const totalResolutionMinutes = populated.reduce(
      (sum, month) => sum + (month.totalResolutionMinutes ?? 0),
      0,
    );
    const availableYears = [
      ...new Set(
        [
          year,
          Number(
            new Intl.DateTimeFormat('en', { year: 'numeric', timeZone })
              .formatToParts(new Date())
              .find((part) => part.type === 'year')?.value,
          ),
          ...manualYears,
          ...historicalYears.map((item) => item._id),
        ].filter((item): item is number => Number.isInteger(item)),
      ),
    ].sort((a, b) => b - a);
    return {
      year,
      timeZone,
      availableYears,
      totalResolvedDefects,
      totalResolutionMinutes,
      annualMttrSeconds: totalResolvedDefects
        ? (totalResolutionMinutes * 60) / totalResolvedDefects
        : null,
      months,
    };
  }

  async upsertMonth(
    yearInput: string,
    monthInput: string,
    input: UpsertProductQualityMonthDto,
    userId: string,
  ) {
    const year = this.parseYear(yearInput);
    const month = this.parseMonth(monthInput);
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invalid authenticated user');
    const actor = new Types.ObjectId(userId);
    const note = input.note?.trim() || undefined;
    const record = await this.monthlyModel
      .findOneAndUpdate(
        { year, month },
        {
          $set: {
            resolved_defects: input.resolvedDefects,
            total_resolution_minutes: input.totalResolutionMinutes,
            note,
            updated_by: actor,
          },
          $setOnInsert: { entered_by: actor },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      )
      .lean()
      .exec();
    return {
      year,
      month,
      resolvedDefects: record.resolved_defects,
      totalResolutionMinutes: record.total_resolution_minutes,
      mttrSeconds:
        (record.total_resolution_minutes * 60) / record.resolved_defects,
      note: record.note ?? null,
      updatedAt: record.updatedAt,
    };
  }
}
