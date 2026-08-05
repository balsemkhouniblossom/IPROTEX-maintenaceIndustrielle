import {
  MaintenancePlanSummaryResponse,
  ModuleSummaryResponse,
} from '../../common/response/reference-summaries';
import { WorkOrderResponse } from './work-order-response.types';

export interface WorkOrderStatisticsResponse {
  currentMonthWorkOrders: number;
  lastMonthWorkOrders: number;
  percentageChange: number;
  pendingMaintenance: number;
  totalWorkOrders: number;
}

export interface MachinePreventiveStateFrequencyResponse {
  value?: number;
  unit?: string;
  originalLabel?: string;
  normalized: string;
}

export interface MachinePreventiveStateItemResponse {
  plan: MaintenancePlanSummaryResponse;
  module: ModuleSummaryResponse | null;
  currentOccurrence: WorkOrderResponse | null;
  currentState: string;
  lastCompletedDate: string | null;
  nextDueDate: string | null;
  frequency: MachinePreventiveStateFrequencyResponse;
}

export interface MachinePreventiveStatesResponse {
  machineId: string;
  visibilityRule: string;
  sections: {
    dueToday: MachinePreventiveStateItemResponse[];
    overdue: MachinePreventiveStateItemResponse[];
    upcoming: MachinePreventiveStateItemResponse[];
    waitingValidation: MachinePreventiveStateItemResponse[];
    returned: MachinePreventiveStateItemResponse[];
    preventivePlan: MachinePreventiveStateItemResponse[];
  };
}

export interface CalendarWidgetRowResponse {
  id: string;
  workOrderId: string;
  title: string;
  status: string;
  dueDate: string | null;
  color: 'blue' | 'green' | 'orange' | 'red' | 'purple';
}

export interface CalendarWidgetResponse {
  today: CalendarWidgetRowResponse[];
  thisWeek: CalendarWidgetRowResponse[];
  nextWeek: CalendarWidgetRowResponse[];
  nextMonth: CalendarWidgetRowResponse[];
  overdue: CalendarWidgetRowResponse[];
  waitingValidation: CalendarWidgetRowResponse[];
  counts: {
    today: number;
    thisWeek: number;
    nextWeek: number;
    nextMonth: number;
    overdue: number;
    waitingValidation: number;
  };
}

export interface NotificationCardResponse {
  key: string;
  title: string;
  count: number;
  severity: string;
}
