import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types, ClientSession } from 'mongoose';
import {
  MttrCalculationService,
  RepairRecord,
} from './mttr-calculation.service';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { Panne, PanneDocument } from '../schemas/panne.schema';
import * as businessTime from '../common/business-time';

export interface MttrSourceQuery {
  year?: number;
  machineIds?: string[];
  technicianId?: string;
  machineTypeId?: string;
  faultCode?: string;
  component?: string;
  dateFrom?: Date;
  dateTo?: Date;
  session?: ClientSession;
}

export interface MttrSourceRepair {
  reportRecordId: string;
  reportId: string;
  workOrderRecordId: string;
  workOrderId: string;
  machine: {
    recordId: string;
    code: string;
    reference?: string | null;
  };
  technician: {
    recordId: string;
    name: string;
  };
  startDate: string;
  endDate: string;
  durationMinutes: number;
}

export interface MttrSourceMonth {
  monthIndex: number;
  monthKey: string;
  completedRepairs: number;
  totalRepairMinutes: number;
  mttrMinutes: number | null;
  repairs: MttrSourceRepair[];
}

export interface MttrSourceExclusions {
  total: number;
  byReason: Record<
    | 'missingStartEnd'
    | 'endBeforeStart'
    | 'nonCorrective'
    | 'cancelledIncomplete'
    | 'missingUnresolvableWorkOrder',
    number
  >;
}

export interface MttrSourceResult {
  year?: number;
  businessTimezone: string;
  filters: {
    machineId?: string;
    technicianId?: string;
    machineTypeId?: string;
    faultCode?: string;
    component?: string;
  };
  summary: {
    completedRepairs: number;
    totalRepairMinutes: number;
    mttrMinutes: number | null;
  };
  months: MttrSourceMonth[];
  excluded: MttrSourceExclusions;
  generatedAt: string;
}

interface WorkOrderView {
  recordId: string;
  businessId: string;
  machineId: string | null;
  technicianId: string | null;
  typeMaintenance: string | null;
  status: string | null;
  faultCode: string | null;
}

interface ReportView {
  recordId: string;
  businessId: string;
  workOrderRecordId: string | null;
  technicianRecordId: string | null;
  dateDebut: Date | null;
  dateFin: Date | null;
}

@Injectable()
export class MttrSourceService {
  constructor(
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Panne.name)
    private readonly panneModel: Model<PanneDocument>,
    private readonly calculation: MttrCalculationService,
  ) {}

  async calculate(query: MttrSourceQuery = {}): Promise<MttrSourceResult> {
    const workOrderFilter: FilterQuery<WorkOrderDocument> = {};
    let scopedMachineIds = query.machineIds;
    if (query.machineTypeId) {
      const machineFilter: FilterQuery<MachineDocument> = {
        type_id: new Types.ObjectId(query.machineTypeId),
      };
      if (scopedMachineIds?.length) {
        machineFilter._id = {
          $in: scopedMachineIds.map((id) => new Types.ObjectId(id)),
        };
      }
      const machines = await this.machineModel
        .find(machineFilter)
        .select({ _id: 1 })
        .session(query.session ?? null)
        .lean()
        .exec();
      scopedMachineIds = machines.map((machine) =>
        this.objectIdString(machine._id),
      );
      if (!scopedMachineIds.length) {
        workOrderFilter._id = { $in: [] };
      }
    }
    if (scopedMachineIds?.length) {
      workOrderFilter.machine_id = {
        $in: scopedMachineIds.map((id) => new Types.ObjectId(id)),
      };
    }
    if (query.faultCode) workOrderFilter.code_panne = query.faultCode;
    if (query.component) {
      const matchingFaults = await this.panneModel
        .find({ component: query.component })
        .select({ code_panne: 1 })
        .session(query.session ?? null)
        .lean()
        .exec();
      workOrderFilter.code_panne = {
        $in: matchingFaults.map((fault) => fault.code_panne),
      };
    }

    const workOrders = await this.workOrderModel
      .find(workOrderFilter)
      .select({
        _id: 1,
        ot_id: 1,
        machine_id: 1,
        technician_id: 1,
        type_maintenance: 1,
        status: 1,
        code_panne: 1,
      })
      .session(query.session ?? null)
      .lean()
      .exec();

    const workOrderMap = new Map<string, WorkOrderView>();
    for (const workOrder of workOrders) {
      workOrderMap.set(this.objectIdString(workOrder._id), {
        recordId: this.objectIdString(workOrder._id),
        businessId: workOrder.ot_id,
        machineId: this.objectIdString(workOrder.machine_id),
        technicianId: this.objectIdString(workOrder.technician_id),
        typeMaintenance: workOrder.type_maintenance ?? null,
        status: workOrder.status ?? null,
        faultCode: workOrder.code_panne ?? null,
      });
    }

    const reportFilter: FilterQuery<InterventionReportDocument> = {};
    const workOrderRecordIds = [...workOrderMap.keys()];
    if (workOrderRecordIds.length > 0) {
      reportFilter.ot_id = {
        $in: workOrderRecordIds.map((id) => new Types.ObjectId(id)),
      };
    } else if (query.technicianId) {
      reportFilter.technician_id = new Types.ObjectId(query.technicianId);
    }

    const reports = await this.interventionReportModel
      .find(reportFilter)
      .select({
        _id: 1,
        report_id: 1,
        ot_id: 1,
        technician_id: 1,
        date_debut: 1,
        date_fin: 1,
      })
      .session(query.session ?? null)
      .lean()
      .exec();

    const candidates: RepairRecord[] = [];
    for (const report of reports) {
      const workOrderRecordId = this.objectIdString(report.ot_id);
      const workOrder = workOrderMap.get(workOrderRecordId);
      const reportTechnicianId = this.objectIdString(report.technician_id);
      if (
        !this.matchesTechnician(
          query.technicianId,
          reportTechnicianId,
          workOrder,
        )
      )
        continue;

      const reportView: ReportView = {
        recordId: this.objectIdString(report._id),
        businessId: report.report_id || workOrderRecordId,
        workOrderRecordId: workOrder
          ? workOrder.recordId
          : workOrderRecordId || null,
        technicianRecordId: reportTechnicianId || workOrder?.technicianId || '',
        dateDebut: this.toDate(report.date_debut),
        dateFin: this.toDate(report.date_fin),
      };

      candidates.push(
        this.toRepairRecord(reportView, workOrder, reportTechnicianId),
      );
    }

    const scopedCandidates = candidates.filter((candidate) =>
      this.isInScope(candidate, query),
    );

    const exclusions = {
      missingStartEnd: 0,
      endBeforeStart: 0,
      nonCorrective: 0,
      cancelledIncomplete: 0,
      missingUnresolvableWorkOrder: 0,
    };
    const validCandidates: RepairRecord[] = [];
    for (const candidate of scopedCandidates) {
      const reason = this.calculation.classifyExclusion(candidate);
      if (reason) {
        exclusions[reason] += 1;
      } else {
        validCandidates.push(candidate);
      }
    }

    const calculated = this.calculation.buildYearlyResult(
      query.year,
      validCandidates,
      exclusions,
    );
    const repairs = await this.enrichRepairs(validCandidates, query.session);
    const repairsByKey = new Map(
      repairs.map((repair) => [
        `${repair.reportRecordId}:${repair.workOrderRecordId}:${repair.endDate}`,
        repair,
      ]),
    );
    const months = calculated.months.map((month) => {
      const monthRepairs = month.detailRows
        .map((detail) =>
          repairsByKey.get(
            `${detail.interventionReportId}:${detail.workOrderId}:${detail.dateFin.toISOString()}`,
          ),
        )
        .filter((repair): repair is MttrSourceRepair => Boolean(repair));
      return {
        monthIndex: month.month - 1,
        monthKey: month.monthLabel,
        completedRepairs: month.sampleSize,
        totalRepairMinutes: monthRepairs.reduce(
          (sum, repair) => sum + repair.durationMinutes,
          0,
        ),
        mttrMinutes: month.mttr,
        repairs: monthRepairs,
      };
    });

    const totalRepairMinutes = repairs.reduce(
      (sum, repair) => sum + repair.durationMinutes,
      0,
    );
    const exclusionReasons = Object.keys(exclusions) as Array<
      keyof typeof exclusions
    >;

    return {
      year: query.year,
      businessTimezone: businessTime.getBusinessTimezone(),
      filters: {
        ...(query.machineIds?.[0] ? { machineId: query.machineIds[0] } : {}),
        ...(query.technicianId ? { technicianId: query.technicianId } : {}),
        ...(query.machineTypeId ? { machineTypeId: query.machineTypeId } : {}),
        ...(query.faultCode ? { faultCode: query.faultCode } : {}),
        ...(query.component ? { component: query.component } : {}),
      },
      summary: {
        completedRepairs: repairs.length,
        totalRepairMinutes,
        mttrMinutes: calculated.summary.overallMttr,
      },
      months,
      excluded: {
        total: calculated.summary.totalExcluded,
        byReason: Object.fromEntries(
          exclusionReasons.map((reason) => [reason, exclusions[reason]]),
        ) as MttrSourceExclusions['byReason'],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private matchesTechnician(
    requestedId: string | undefined,
    reportTechnicianId: string,
    workOrder?: WorkOrderView,
  ): boolean {
    if (!requestedId) return true;
    return reportTechnicianId
      ? reportTechnicianId === requestedId
      : workOrder?.technicianId === requestedId;
  }

  private toRepairRecord(
    report: ReportView,
    workOrder: WorkOrderView | undefined,
    reportTechnicianId: string,
  ): RepairRecord {
    if (!workOrder) {
      return {
        interventionReportId: report.recordId,
        reportBusinessId: report.businessId,
        workOrderId: report.workOrderRecordId || undefined,
        workOrderBusinessId: report.workOrderRecordId || undefined,
        dateDebut: report.dateDebut,
        dateFin: report.dateFin,
        technicianId: report.technicianRecordId || undefined,
        workOrderMissing: true,
      };
    }
    return {
      interventionReportId: report.recordId,
      reportBusinessId: report.businessId,
      workOrderId: workOrder.recordId,
      workOrderBusinessId: workOrder.businessId,
      dateDebut: report.dateDebut,
      dateFin: report.dateFin,
      typeMaintenance: workOrder.typeMaintenance,
      workOrderStatus: workOrder.status,
      machineId: workOrder.machineId,
      machineReference: null,
      technicianId: reportTechnicianId || workOrder.technicianId,
    };
  }

  private isInScope(candidate: RepairRecord, query: MttrSourceQuery): boolean {
    const end = this.calculation.toValidDate(candidate.dateFin);
    if (!end) return true;
    if (
      query.year !== undefined &&
      this.calculation.getZonedParts(end).year !== query.year
    )
      return false;
    if (query.dateFrom && end < query.dateFrom) return false;
    return !(query.dateTo && end >= query.dateTo);
  }

  private async enrichRepairs(
    candidates: RepairRecord[],
    session?: ClientSession,
  ): Promise<MttrSourceRepair[]> {
    const machineIds = [
      ...new Set(
        candidates
          .map((candidate) => candidate.machineId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const technicianIds = [
      ...new Set(
        candidates
          .map((candidate) => candidate.technicianId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [machines, users] = await Promise.all([
      machineIds.length
        ? this.machineModel
            .find({
              _id: { $in: machineIds.map((id) => new Types.ObjectId(id)) },
            })
            .select({ _id: 1, machine_id: 1, reference: 1 })
            .session(session ?? null)
            .lean()
            .exec()
        : Promise.resolve([]),
      technicianIds.length
        ? this.userModel
            .find({
              _id: { $in: technicianIds.map((id) => new Types.ObjectId(id)) },
            })
            .select({ _id: 1, nom_complet: 1, user_id: 1 })
            .session(session ?? null)
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const machineByRecordId = new Map(
      machines.map((machine) => [
        this.objectIdString(machine._id),
        {
          code: machine.machine_id,
          reference: machine.reference ?? null,
        },
      ]),
    );
    const userByRecordId = new Map(
      users.map((user) => [
        this.objectIdString(user._id),
        {
          name: user.nom_complet || user.user_id || 'Unknown technician',
        },
      ]),
    );

    return candidates
      .map((candidate) => {
        const start = this.calculation.toValidDate(candidate.dateDebut);
        const end = this.calculation.toValidDate(candidate.dateFin);
        if (
          !start ||
          !end ||
          !candidate.interventionReportId ||
          !candidate.workOrderId
        ) {
          return null;
        }
        const machineId = candidate.machineId || '';
        const technicianId = candidate.technicianId || '';
        const machine = machineByRecordId.get(machineId) || {
          code: 'Unknown machine',
          reference: null,
        };
        const technician = userByRecordId.get(technicianId) || {
          name: 'Unknown technician',
        };
        return {
          reportRecordId: candidate.interventionReportId,
          reportId:
            candidate.reportBusinessId || candidate.interventionReportId || '',
          workOrderRecordId: candidate.workOrderId,
          workOrderId:
            candidate.workOrderBusinessId || candidate.workOrderId || '',
          machine: {
            recordId: machineId,
            code: machine.code,
            reference: machine.reference,
          },
          technician: {
            recordId: technicianId,
            name: technician.name,
          },
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          durationMinutes: (end.getTime() - start.getTime()) / 60_000,
        };
      })
      .filter(Boolean) as MttrSourceRepair[];
  }

  private toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private objectIdString(value: unknown): string {
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && '_id' in value) {
      return this.objectIdString((value as { _id?: unknown })._id);
    }
    return '';
  }
}
