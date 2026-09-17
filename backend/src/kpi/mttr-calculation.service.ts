import { Injectable } from '@nestjs/common';
import { COMPLETED_WORK_ORDER_STATUSES } from '../common/work-order-status';
import { CORRECTIVE_TYPE_REGEX } from '../common/maintenance-type';
import * as businessTime from '../common/business-time';

export type ExclusionReason =
  | 'missingStartEnd'
  | 'endBeforeStart'
  | 'nonCorrective'
  | 'cancelledIncomplete'
  | 'missingUnresolvableWorkOrder';

export interface RepairRecord {
  interventionReportId?: string;
  reportBusinessId?: string;
  workOrderId?: string;
  workOrderBusinessId?: string;
  dateDebut?: Date | null;
  dateFin?: Date | null;
  typeMaintenance?: string | null;
  workOrderStatus?: string | null;
  machineId?: string | null;
  machineCode?: string;
  machineReference?: string | null;
  technicianId?: string | null;
  technicianName?: string;
  workOrderMissing?: boolean;
}

export interface MonthlyRepair {
  month: number;
  monthLabel: string;
  repairDurationMs: number;
  repairDurationMin: number;
  interventionReportId: string;
  workOrderId: string;
  dateFin: Date;
  machineId?: string | null;
  technicianId?: string | null;
}

export interface MonthResult {
  month: number;
  monthLabel: string;
  detailRows: MonthlyRepair[];
  mttr: number | null;
  sampleSize: number;
}

export interface ExclusionCounts {
  missingStartEnd: number;
  endBeforeStart: number;
  nonCorrective: number;
  cancelledIncomplete: number;
  missingUnresolvableWorkOrder: number;
}

export interface MttrYearlyResult {
  year?: number;
  months: MonthResult[];
  summary: {
    totalRepairs: number;
    overallMttr: number | null;
    totalRepairMinutes: number;
    totalExcluded: number;
  };
  exclusions: ExclusionCounts;
}

@Injectable()
export class MttrCalculationService {
  getZonedParts(date: Date): { year: number; month: number } {
    const timeZone = businessTime.getBusinessTimezone();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const map: Record<string, string> = {};
    for (const part of parts) {
      map[part.type] = part.value;
    }
    return {
      year: Number(map.year),
      month: Number(map.month),
    };
  }

  calculateMttrMinutes(repairs: RepairRecord[]): number | null {
    const valid = repairs.filter((repair) => this.isRepairValid(repair));
    if (valid.length === 0) return null;

    const durationsMs = valid.map((repair) => {
      const start = this.toValidDate(repair.dateDebut);
      const end = this.toValidDate(repair.dateFin);
      if (!start || !end) return 0;
      return end.getTime() - start.getTime();
    });
    const avgMs =
      durationsMs.reduce((sum, duration) => sum + duration, 0) /
      durationsMs.length;
    return avgMs / 60_000;
  }

  calculateTotalRepairMinutes(repairs: RepairRecord[]): number {
    return repairs
      .filter((repair) => this.isRepairValid(repair))
      .reduce((sum, repair) => {
        const start = this.toValidDate(repair.dateDebut);
        const end = this.toValidDate(repair.dateFin);
        return start && end ? sum + (end.getTime() - start.getTime()) / 60_000 : sum;
      }, 0);
  }

  isRepairValid(repair: RepairRecord): boolean {
    return this.classifyExclusion(repair) === null;
  }

  classifyExclusion(repair: RepairRecord): ExclusionReason | null {
    if (repair.workOrderMissing || !repair.workOrderId) {
      return 'missingUnresolvableWorkOrder';
    }

    const start = this.toValidDate(repair.dateDebut);
    const end = this.toValidDate(repair.dateFin);
    if (!start || !end) return 'missingStartEnd';
    if (end.getTime() < start.getTime()) return 'endBeforeStart';
    if (!CORRECTIVE_TYPE_REGEX.test(repair.typeMaintenance || '')) {
      return 'nonCorrective';
    }
    if (
      !repair.workOrderStatus ||
      !COMPLETED_WORK_ORDER_STATUSES.includes(repair.workOrderStatus)
    ) {
      return 'cancelledIncomplete';
    }
    return null;
  }

  buildYearlyResult(
    year: number | undefined,
    repairs: RepairRecord[],
    exclusions: ExclusionCounts,
  ): MttrYearlyResult {
    const validRepairs = repairs.filter((repair) => this.isRepairValid(repair));
    const months: MonthResult[] = [];
    let totalRepairs = year === undefined ? validRepairs.length : 0;

    if (year !== undefined) {
      for (let month = 1; month <= 12; month += 1) {
        const monthRepairs = validRepairs.filter((repair) => {
          const end = this.toValidDate(repair.dateFin);
          const parts = end ? this.getZonedParts(end) : null;
          return parts?.year === year && parts.month === month;
        });
        const detailRows = this.toMonthlyRows(year, month, monthRepairs);
        const mttr = this.calculateMttrMinutes(monthRepairs);
        months.push({
          month,
          monthLabel: `${year}-${String(month).padStart(2, '0')}`,
          detailRows,
          mttr,
          sampleSize: detailRows.length,
        });
        totalRepairs += detailRows.length;
      }
    }

    const totalRepairMinutes = this.calculateTotalRepairMinutes(validRepairs);
    const overallMttr =
      totalRepairs > 0 ? totalRepairMinutes / totalRepairs : null;
    const exclusionReasons: ExclusionReason[] = [
      'missingStartEnd',
      'endBeforeStart',
      'nonCorrective',
      'cancelledIncomplete',
      'missingUnresolvableWorkOrder',
    ];
    const totalExcluded = exclusionReasons.reduce(
      (sum, reason) => sum + exclusions[reason],
      0,
    );

    return {
      year,
      months,
      summary: {
        totalRepairs,
        overallMttr,
        totalRepairMinutes,
        totalExcluded,
      },
      exclusions,
    };
  }

  private toMonthlyRows(
    year: number,
    month: number,
    repairs: RepairRecord[],
  ): MonthlyRepair[] {
    return repairs.map((repair) => {
      const start = this.toValidDate(repair.dateDebut);
      const end = this.toValidDate(repair.dateFin);
      if (!start || !end) {
        throw new Error('Cannot create a monthly MTTR row without valid dates');
      }
      const durationMs = end.getTime() - start.getTime();
      return {
        month,
        monthLabel: `${year}-${String(month).padStart(2, '0')}`,
        repairDurationMs: durationMs,
        repairDurationMin: durationMs / 60_000,
        interventionReportId: repair.interventionReportId || '',
        workOrderId: repair.workOrderId || '',
        dateFin: end,
        machineId: repair.machineId ?? null,
        technicianId: repair.technicianId ?? null,
      };
    });
  }

  toValidDate(value: Date | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
