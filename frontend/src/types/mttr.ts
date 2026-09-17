export interface MttrMachine {
  recordId: string;
  code: string;
  reference?: string | null;
}

export interface MttrTechnician {
  recordId: string;
  name: string;
}

export interface MttrRepair {
  reportRecordId: string;
  reportId: string;
  workOrderRecordId: string;
  workOrderId: string;
  machine: MttrMachine;
  technician: MttrTechnician;
  startDate: string;
  endDate: string;
  durationMinutes: number;
}

export interface MttrMonth {
  monthIndex: number;
  monthKey: string;
  completedRepairs: number;
  totalRepairMinutes: number;
  mttrMinutes: number | null;
  repairs: MttrRepair[];
}

export type MttrExclusionReason =
  | 'missingStartEnd'
  | 'endBeforeStart'
  | 'nonCorrective'
  | 'cancelledIncomplete'
  | 'missingUnresolvableWorkOrder';

export interface MttrExcluded {
  total: number;
  byReason: Record<MttrExclusionReason, number>;
}

export interface MttrSummary {
  completedRepairs: number;
  totalRepairMinutes: number;
  mttrMinutes: number | null;
}

export interface MttrAnalyticsData {
  year?: number;
  businessTimezone: string;
  filters: {
    machineId?: string;
    technicianId?: string;
  };
  summary: MttrSummary;
  months: MttrMonth[];
  excluded: MttrExcluded;
  generatedAt: string;
}
