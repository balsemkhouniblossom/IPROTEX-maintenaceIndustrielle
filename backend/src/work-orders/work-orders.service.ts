import { Injectable } from '@nestjs/common';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { WorkOrdersQueryDto } from './dto/work-orders-query.dto';
import { PaginatedResponse } from '../common/pagination';
import { InterventionReportDocument } from '../schemas/intervention-report.schema';
import { LubrificationLogDocument } from '../schemas/lubrification-log.schema';
import { PartRequestDocument } from '../schemas/part-request.schema';
import { SchedulerJobContext } from '../scheduler/scheduler.types';
import { WorkOrderQueryService } from './services/work-order-query.service';
import {
  PreventiveScheduleInput,
  RescheduleInput,
  WorkOrderPreventiveSchedulingService,
} from './services/work-order-preventive-scheduling.service';
import {
  DecidePartRequestInput,
  PartRequestForOperatorInput,
  WorkOrderPartsService,
} from './services/work-order-parts.service';
import {
  CorrectiveReportForOperatorInput,
  SubmitPreventiveMaintenanceInput,
  ValidationAction,
  WorkOrderReportService,
} from './services/work-order-report.service';
import {
  CalendarEventRow,
  CalendarFilters,
  CalendarView,
  WorkOrderCalendarQueryService,
} from './services/work-order-calendar-query.service';
import { WorkOrderDashboardQueryService } from './services/work-order-dashboard-query.service';
import { WorkOrderAssistantContextService } from './services/work-order-assistant-context.service';
import { WorkOrderCommandService } from './services/work-order-command.service';
import {
  OperatorCalendarScope,
  WorkOrderOperatorCommandService,
} from './services/work-order-operator-command.service';
import { WorkOrderKpiService } from './services/work-order-kpi.service';

export type { CalendarEventRow };

/**
 * Compatibility facade for every Work Order use case. Every method here is
 * a thin delegation to its canonical owner — this class implements no
 * business logic of its own, so it is safe for existing callers
 * (`WorkOrdersController`, `OperatorService`, `TechnicianService`,
 * `AutomationSchedulerService`, `MaintenancePlansService`) to keep calling
 * it unchanged while the real behavior lives in the extracted services
 * below.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly queryService: WorkOrderQueryService,
    private readonly preventiveSchedulingService: WorkOrderPreventiveSchedulingService,
    private readonly partsService: WorkOrderPartsService,
    private readonly reportService: WorkOrderReportService,
    private readonly calendarQueryService: WorkOrderCalendarQueryService,
    private readonly dashboardQueryService: WorkOrderDashboardQueryService,
    private readonly assistantContextService: WorkOrderAssistantContextService,
    private readonly commandService: WorkOrderCommandService,
    private readonly operatorCommandService: WorkOrderOperatorCommandService,
    private readonly kpiService: WorkOrderKpiService,
  ) {}

  async create(createWorkOrderDto: CreateWorkOrderDto): Promise<WorkOrder> {
    return this.commandService.create(createWorkOrderDto);
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    query: WorkOrdersQueryDto = {},
  ): Promise<PaginatedResponse<WorkOrder>> {
    return this.queryService.findAll(page, limit, skip, query);
  }

  async findOne(id: string): Promise<any> {
    return this.queryService.findOne(id);
  }

  async update(
    id: string,
    updateWorkOrderDto: UpdateWorkOrderDto,
  ): Promise<any> {
    return this.commandService.update(id, updateWorkOrderDto);
  }

  async remove(id: string): Promise<any> {
    return this.commandService.remove(id);
  }

  /**
   * The Admin dashboard's legacy statistics endpoint. Delegates to
   * `WorkOrderDashboardQueryService`, the canonical owner of Work Order
   * dashboard/statistics read projections.
   */
  async getStatistics() {
    return this.dashboardQueryService.getStatistics();
  }

  async triggerScheduler(source = 'manual', context?: SchedulerJobContext) {
    return this.preventiveSchedulingService.triggerScheduler(source, context);
  }

  /**
   * Applies a validation decision and its report-adjacent side effects
   * (delegated to `WorkOrderReportService`, which reuses
   * `WorkOrderLifecycleService` for the actual transition and
   * `WorkOrderPreventiveSchedulingService`/`WorkOrderNotificationService`
   * for recurrence/notification). KPI recomputation stays a facade-level
   * concern composed from two canonical owners: it is not a report concern,
   * so it is triggered here under the exact same "successful, not-already-
   * applied approval" condition as before.
   */
  async applyValidationAction(
    workOrderId: string,
    action: ValidationAction,
    validatorId?: string,
  ) {
    const updatedWorkOrder = await this.reportService.applyValidationDecision({
      workOrderId,
      action,
      validatorId,
    });
    const validationAlreadyApplied = Boolean(
      (updatedWorkOrder as { __validationAlreadyApplied?: boolean } | null)
        ?.__validationAlreadyApplied,
    );
    if (action === 'approve' && updatedWorkOrder && !validationAlreadyApplied) {
      await this.kpiService.updateKpiForMachine(
        updatedWorkOrder.machine_id?.toString(),
      );
    }

    return updatedWorkOrder;
  }

  /**
   * Per-machine preventive plan state summary. Delegates to
   * `WorkOrderDashboardQueryService`, the canonical owner of Work Order
   * dashboard/statistics read projections.
   */
  async getMachinePreventiveStates(machineId: string) {
    return this.dashboardQueryService.getMachinePreventiveStates(machineId);
  }

  async scheduleFirstPreventiveOccurrence(input: PreventiveScheduleInput) {
    return this.preventiveSchedulingService.scheduleFirstPreventiveOccurrence(
      input,
    );
  }

  /**
   * Creates the one-and-only first occurrence for a plan that has just
   * been activated, when appropriate — appropriate meaning: the plan is
   * actually schedulable (any non-corrective type: preventive, lubrication,
   * inspection, or a custom scheduled-maintenance label), and it does not
   * already have any occurrence at all (idempotent: re-activating, e.g.
   * Draft->Active after the very first activation somehow raced, never
   * creates a second). Unlike the Operator-driven
   * `scheduleFirstPreventiveOccurrence` (which takes an explicit chosen
   * date), this is Admin-triggered with no date input, so the occurrence is
   * due immediately — the plan just went live, so its first maintenance is
   * due now. Returns `null` (not an error) whenever creation is skipped,
   * since skipping is the normal, expected outcome for a corrective plan or
   * one that already has an occurrence.
   */
  async createInitialOccurrenceForPlan(
    planId: string,
  ): Promise<WorkOrderDocument | null> {
    return this.preventiveSchedulingService.createInitialOccurrenceForPlan(
      planId,
    );
  }

  async reschedulePreventiveOccurrence(input: RescheduleInput) {
    return this.preventiveSchedulingService.reschedulePreventiveOccurrence(
      input,
    );
  }

  /**
   * Creates a corrective work order and its initial intervention report as a
   * single, reliable operation for an Operator. Delegates to
   * `WorkOrderReportService`, the canonical owner of Work Order report
   * creation and submission.
   */
  async createCorrectiveReportForOperator(
    input: CorrectiveReportForOperatorInput,
  ): Promise<{
    workOrder: WorkOrderDocument;
    report: InterventionReportDocument;
    duplicate: boolean;
  }> {
    return this.reportService.createCorrectiveReportForOperator(input);
  }

  /**
   * Submits a preventive maintenance round for an already-assigned
   * occurrence. Delegates to `WorkOrderReportService`, the canonical owner
   * of Work Order report creation and submission.
   */
  async submitPreventiveMaintenanceForOperator(
    input: SubmitPreventiveMaintenanceInput,
  ): Promise<{
    workOrder: WorkOrderDocument;
    report: InterventionReportDocument;
    lubricationLog: LubrificationLogDocument | null;
  }> {
    return this.reportService.submitPreventiveMaintenanceForOperator(input);
  }

  /**
   * Records an Operator's request for spare parts against an existing
   * corrective work order they own. Delegates to `WorkOrderPartsService`,
   * the canonical owner of the Work Order parts-request lifecycle.
   */
  async requestPartsForOperator(
    input: PartRequestForOperatorInput,
  ): Promise<PartRequestDocument> {
    return this.partsService.requestPartsForOperator(input);
  }

  /**
   * Decides a part request (approve/reject/cancel). Delegates to
   * `WorkOrderPartsService`, the canonical owner of the Work Order
   * parts-request lifecycle and its Stock reservation side effects.
   */
  async decidePartRequest(
    input: DecidePartRequestInput,
  ): Promise<PartRequestDocument> {
    return this.partsService.decidePartRequest(input);
  }

  /**
   * Operator-scoped calendar event list. Delegates to
   * `WorkOrderCalendarQueryService`, the canonical owner of Work Order
   * calendar/timeline read projections.
   */
  async getCalendarEventsForOperator(
    view: CalendarView,
    date: Date,
    operatorId: string,
    filters: CalendarFilters,
  ) {
    return this.calendarQueryService.getCalendarEventsForOperator(
      view,
      date,
      operatorId,
      filters,
    );
  }

  async getCalendarEventDetailsForOperator(
    workOrderId: string,
    operatorId: string,
  ) {
    return this.calendarQueryService.getCalendarEventDetailsForOperator(
      workOrderId,
      operatorId,
    );
  }

  /** Personal dashboard widget, scoped to work orders assigned to this Operator. */
  async getCalendarWidgetForOperator(operatorId: string) {
    return this.dashboardQueryService.getCalendarWidgetForOperator(operatorId);
  }

  /** Personal notification cards, scoped to work orders assigned to this Operator. */
  async getNotificationCardsForOperator(operatorId: string) {
    return this.dashboardQueryService.getNotificationCardsForOperator(
      operatorId,
    );
  }

  /** Personal timeline, scoped to work orders assigned to this Operator. */
  async getTimelineForOperator(
    date: Date,
    operatorId: string,
    machineId?: string,
  ) {
    return this.calendarQueryService.getTimelineForOperator(
      date,
      operatorId,
      machineId,
    );
  }

  /**
   * Marks that the Operator has begun work on an assigned occurrence.
   * Delegates to `WorkOrderOperatorCommandService`, the canonical owner of
   * Operator mutation orchestration.
   */
  async startWorkOrderForOperator(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    return this.operatorCommandService.startWorkOrderForOperator(scope);
  }

  /**
   * Marks that the Operator has finished active work on an assigned
   * corrective occurrence. Delegates to `WorkOrderOperatorCommandService`,
   * the canonical owner of Operator mutation orchestration.
   */
  async completeWorkOrderForOperator(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    return this.operatorCommandService.completeWorkOrderForOperator(scope);
  }

  /**
   * Reschedules a preventive occurrence assigned to this Operator.
   * Delegates to `WorkOrderOperatorCommandService`, the canonical owner of
   * Operator mutation orchestration.
   */
  async rescheduleWorkOrderForOperator(input: {
    operatorId: string;
    workOrderId: string;
    newDueDate: string;
    reason: string;
  }) {
    return this.operatorCommandService.rescheduleWorkOrderForOperator(input);
  }

  /**
   * Admin-facing (unscoped) calendar event list. Delegates to
   * `WorkOrderCalendarQueryService`, the canonical owner of Work Order
   * calendar/timeline read projections.
   */
  async getCalendarEvents(
    view: CalendarView,
    date: Date,
    filters: CalendarFilters,
  ) {
    return this.calendarQueryService.getCalendarEvents(view, date, filters);
  }

  async getCalendarEventDetails(workOrderId: string) {
    return this.calendarQueryService.getCalendarEventDetails(workOrderId);
  }

  async getTimeline(date: Date, machineId?: string, technicianId?: string) {
    return this.calendarQueryService.getTimeline(date, machineId, technicianId);
  }

  /**
   * Admin-facing (unscoped) or technician-scoped calendar dashboard widget.
   * Delegates to `WorkOrderDashboardQueryService`, the canonical owner of
   * Work Order dashboard/statistics read projections.
   */
  async getDashboardCalendarWidget(scope?: { technicianId?: string }) {
    return this.dashboardQueryService.getDashboardCalendarWidget(scope);
  }

  async getNotificationCards(scope?: { technicianId?: string }) {
    return this.dashboardQueryService.getNotificationCards(scope);
  }

  /**
   * Sanitized corrective-troubleshooting context (known faults, their
   * recommended solutions, and machine manuals). Delegates to
   * `WorkOrderAssistantContextService` — never calls an external AI
   * provider.
   */
  async getCorrectiveAssistant(machineId?: string) {
    return this.assistantContextService.getCorrectiveAssistant(machineId);
  }

  /**
   * Recomputes and persists the current KPI snapshot for a machine.
   * Delegates to `WorkOrderKpiService`, the canonical owner of Work
   * Order-triggered KPI writes.
   */
  async updateKpiForMachine(machineId?: string) {
    return this.kpiService.updateKpiForMachine(machineId);
  }
}
