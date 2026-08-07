import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../../schemas/intervention-report.schema';
import {
  Lubrifiant,
  LubrifiantDocument,
} from '../../schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../../schemas/lubrification-log.schema';
import { Panne, PanneDocument } from '../../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../../schemas/panne-solution.schema';
import { isSchedulableMaintenanceType } from '../../common/maintenance-type';
import { CounterService } from '../../counters/counter.service';
import { WorkOrderNotificationService } from './work-order-notification.service';
import { WorkOrderLifecycleService } from './work-order-lifecycle.service';
import { WorkOrderPreventiveSchedulingService } from './work-order-preventive-scheduling.service';

export type ValidationAction = 'approve' | 'reject' | 'request_correction';

export interface CorrectiveReportForOperatorInput {
  operatorId: string;
  machineId: string;
  codePanne: string;
  faultDescription?: string;
  actions: string[];
  priority?: string;
}

export interface SubmitPreventiveMaintenanceInput {
  operatorId: string;
  workOrderId: string;
  tasksCompleted: string[];
  condition: string;
  comments?: string;
  lubrication?: { lubrifiantId: string; quantity: number };
}

export interface WorkOrderForAutoInterventionReport {
  _id?: Types.ObjectId | string;
  execution_date?: Date;
  date_start?: Date;
  date_created?: Date;
  date_end?: Date;
  date_closed?: Date;
  code_panne?: string;
  technician_id?: Types.ObjectId;
  description?: string;
  status?: string;
}

export interface ApplyValidationDecisionInput {
  workOrderId: string;
  action: ValidationAction;
  validatorId?: string;
}

const SUBMITTABLE_PREVENTIVE_STATUSES = ['scheduled', 'overdue'];

/**
 * Owns Work Order-linked intervention report creation and validation
 * orchestration: Operator corrective/preventive submissions, the
 * auto-generated report created when a Work Order lands directly in a
 * completed status, and the report-adjacent side effects of a validation
 * decision (preventive recurrence, notification). The actual Work Order
 * status transition and its coupled report `validation_responsable` write
 * always go through `WorkOrderLifecycleService` — this service never
 * duplicates that transition logic, it only decides *when* to call it and
 * what to do with the result. KPI recomputation stays the calling facade's
 * responsibility, since it is not a report concern.
 */
@Injectable()
export class WorkOrderReportService {
  private static readonly CORRECTIVE_REPORT_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(Lubrifiant.name)
    private readonly lubrifiantModel: Model<LubrifiantDocument>,
    @InjectModel(LubrificationLog.name)
    private readonly lubrificationLogModel: Model<LubrificationLogDocument>,
    @InjectModel(Panne.name)
    private readonly panneModel: Model<PanneDocument>,
    @InjectModel(PanneSolution.name)
    private readonly panneSolutionModel: Model<PanneSolutionDocument>,
    private readonly counterService: CounterService,
    private readonly notificationService: WorkOrderNotificationService,
    private readonly lifecycleService: WorkOrderLifecycleService,
    private readonly preventiveSchedulingService: WorkOrderPreventiveSchedulingService,
  ) {}

  /**
   * Creates a corrective work order and its initial intervention report as a
   * single, reliable operation for an Operator. Both documents are created
   * inside one Mongo transaction: if either write fails, the whole operation
   * rolls back so a corrective report can never exist without its work order
   * (or vice versa). The caller (OperatorService) has already verified the
   * machine is assigned to this operator before this method runs; identity
   * always comes from `input.operatorId` (derived from the authenticated
   * request), never from client-supplied data.
   */
  async createCorrectiveReportForOperator(
    input: CorrectiveReportForOperatorInput,
  ): Promise<{
    workOrder: WorkOrderDocument;
    report: InterventionReportDocument;
    duplicate: boolean;
  }> {
    if (!Types.ObjectId.isValid(input.machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }

    const machine = await this.machineModel.findById(input.machineId).exec();
    if (!machine) {
      throw new NotFoundException('Machine not found');
    }

    const codePanne = input.codePanne?.trim();
    if (!codePanne) {
      throw new BadRequestException('code_panne is required');
    }

    const actions = (input.actions || [])
      .map((action) => action.trim())
      .filter(Boolean);
    if (!actions.length) {
      throw new BadRequestException(
        'At least one action performed is required',
      );
    }

    const operatorObjectId = new Types.ObjectId(input.operatorId);
    const description = `${codePanne} | ${actions.join(' | ')}`;
    const descriptionAction = actions.join(' | ');

    // Idempotency guard: a double-click or a client retry that resubmits the
    // same fault for the same machine moments later returns the record that
    // already exists instead of creating a second, duplicate report.
    const dedupeWindowStart = new Date(
      Date.now() - WorkOrderReportService.CORRECTIVE_REPORT_DEDUPE_WINDOW_MS,
    );
    const recentDuplicate = await this.workOrderModel
      .findOne({
        machine_id: machine._id,
        technician_id: operatorObjectId,
        type_maintenance: 'corrective',
        code_panne: codePanne,
        date_created: { $gte: dedupeWindowStart },
      })
      .sort({ date_created: -1 })
      .exec();

    if (recentDuplicate) {
      const existingReport = await this.interventionReportModel
        .findOne({ ot_id: recentDuplicate._id })
        .exec();
      if (existingReport) {
        return {
          workOrder: recentDuplicate,
          report: existingReport,
          duplicate: true,
        };
      }
    }

    const session = await this.workOrderModel.db.startSession();
    let result: {
      workOrder: WorkOrderDocument;
      report: InterventionReportDocument;
      duplicate: boolean;
    };
    try {
      result = await session.withTransaction(async () => {
        const otId = await this.generateCorrectiveWorkOrderCode();
        const now = new Date();

        const [workOrder] = await this.workOrderModel.create(
          [
            {
              ot_id: otId,
              machine_id: machine._id,
              technician_id: operatorObjectId,
              description,
              type_maintenance: 'corrective',
              status: 'waiting_validation',
              priorite: input.priority?.trim() || 'high',
              code_panne: codePanne,
              date_created: now,
              date_start: now,
            },
          ],
          { session },
        );

        const reportId = await this.generateReportCode();
        const [report] = await this.interventionReportModel.create(
          [
            {
              report_id: reportId,
              ot_id: workOrder._id,
              technician_id: operatorObjectId,
              date_debut: now,
              date_fin: now,
              cause_racine: input.faultDescription?.trim() || codePanne,
              description_action: descriptionAction,
              etat_final: 'waiting_validation',
              validation_responsable: 'waiting_validation',
            },
          ],
          { session },
        );

        return { workOrder, report, duplicate: false };
      });
    } finally {
      await session.endSession();
    }

    await this.notificationService.notifyCorrectiveAwaitingValidation({
      workOrderId: result.workOrder._id.toString(),
      otId: result.workOrder.ot_id,
      machineId: machine._id.toString(),
      reportId: result.report._id.toString(),
    });

    return result;
  }

  /**
   * Submits a preventive maintenance round for an already-assigned occurrence
   * as a single, reliable operation for an Operator: the existing preventive
   * WorkOrder is updated (never re-created), its intervention report is
   * created, and a lubrication log is recorded only when lubrication input
   * was supplied. All three writes share one Mongo transaction, so a failure
   * anywhere rolls the whole submission back — the work order is never left
   * pointing at a status with no matching report.
   *
   * Identity and the execution date/time always come from `input` as derived
   * by the caller (OperatorService, from the authenticated request) and from
   * this method's own server clock — never from anything resembling a
   * client-supplied status or timestamp. The atomic, status-guarded update
   * below is also what makes a duplicate/double submission fail safely: once
   * the first call moves the work order out of the submittable-status set,
   * a second call targeting the same work order finds no matching document
   * and is rejected as a conflict rather than creating a second report.
   *
   * Creating the next recurrence stays the sole responsibility of the
   * existing validation lifecycle (`applyValidationDecision('approve')`):
   * this method only ever moves the occurrence to `waiting_validation`,
   * never to a completed status, so `ensureNextPreventiveWorkOrder` is not
   * invoked here. It does record `execution_date` as the real moment of
   * submission so that, once approved, the next occurrence is scheduled
   * from when the work was actually performed rather than from the
   * original due date.
   */
  async submitPreventiveMaintenanceForOperator(
    input: SubmitPreventiveMaintenanceInput,
  ): Promise<{
    workOrder: WorkOrderDocument;
    report: InterventionReportDocument;
    lubricationLog: LubrificationLogDocument | null;
  }> {
    if (!Types.ObjectId.isValid(input.workOrderId)) {
      throw new BadRequestException('Invalid work_order_id');
    }

    const workOrderObjectId = new Types.ObjectId(input.workOrderId);
    const operatorObjectId = new Types.ObjectId(input.operatorId);

    const existing = await this.workOrderModel
      .findById(workOrderObjectId)
      .exec();
    if (!existing) {
      throw new NotFoundException('Work order not found');
    }
    if (!isSchedulableMaintenanceType(existing.type_maintenance)) {
      throw new BadRequestException(
        'Only preventive, lubrication, or inspection occurrences can be submitted through this endpoint',
      );
    }
    if (
      !existing.technician_id ||
      existing.technician_id.toString() !== input.operatorId
    ) {
      throw new ForbiddenException(
        'This preventive occurrence is not assigned to you',
      );
    }
    if (!SUBMITTABLE_PREVENTIVE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        'This preventive occurrence has already been submitted or is not in a submittable state',
      );
    }

    const tasksCompleted = (input.tasksCompleted || [])
      .map((task) => task.trim())
      .filter(Boolean);
    if (!tasksCompleted.length) {
      throw new BadRequestException('At least one completed task is required');
    }

    const condition = input.condition?.trim();
    if (!condition) {
      throw new BadRequestException('condition is required');
    }

    let lubrifiant: LubrifiantDocument | null = null;
    if (input.lubrication) {
      if (!Types.ObjectId.isValid(input.lubrication.lubrifiantId)) {
        throw new BadRequestException('Invalid lubrication.lubrifiant_id');
      }
      if (
        !Number.isFinite(input.lubrication.quantity) ||
        input.lubrication.quantity <= 0
      ) {
        throw new BadRequestException(
          'lubrication.quantity must be a positive number',
        );
      }
      lubrifiant = await this.lubrifiantModel
        .findById(input.lubrication.lubrifiantId)
        .exec();
      if (!lubrifiant) {
        throw new NotFoundException('Lubrifiant not found');
      }
    }

    const taskSummary = tasksCompleted.join(' | ');

    const session = await this.workOrderModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const now = new Date();

        const workOrder = await this.workOrderModel
          .findOneAndUpdate(
            {
              _id: workOrderObjectId,
              technician_id: operatorObjectId,
              status: { $in: SUBMITTABLE_PREVENTIVE_STATUSES },
            },
            {
              $set: {
                status: 'waiting_validation',
                description: taskSummary,
                execution_date: now,
                date_end: now,
              },
            },
            { session, new: true },
          )
          .exec();

        if (!workOrder) {
          // Lost the race with a concurrent/duplicate submission for the
          // same occurrence between the pre-check above and this guarded
          // update — fail safe rather than create a second report.
          throw new ConflictException(
            'This preventive occurrence has already been submitted or is not in a submittable state',
          );
        }

        const reportId = await this.generateReportCode();
        const [report] = await this.interventionReportModel.create(
          [
            {
              report_id: reportId,
              ot_id: workOrder._id,
              technician_id: operatorObjectId,
              date_debut: now,
              date_fin: now,
              cause_racine: input.comments?.trim() || undefined,
              description_action: taskSummary,
              etat_final: condition,
              validation_responsable: 'waiting_validation',
            },
          ],
          { session },
        );

        let lubricationLog: LubrificationLogDocument | null = null;
        if (input.lubrication && lubrifiant) {
          const logId = await this.generateLubrificationLogCode();
          const [createdLog] = await this.lubrificationLogModel.create(
            [
              {
                log_id: logId,
                module_id: workOrder.module_id,
                lubrifiant_id: lubrifiant._id,
                date_application: now,
                quantite: input.lubrication.quantity,
                technician_id: operatorObjectId,
              },
            ],
            { session },
          );
          lubricationLog = createdLog;
        }

        return { workOrder, report, lubricationLog };
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Applies a validation decision (approve/reject/request_correction) and
   * its report-adjacent side effects. The status transition itself — and
   * the coupled report `validation_responsable` write — is entirely owned
   * by `WorkOrderLifecycleService.applyValidationAction`; this method never
   * touches Work Order status or report validation fields directly. On a
   * successful, not-already-applied approval it also triggers the next
   * preventive occurrence (existing behavior, delegated to
   * `WorkOrderPreventiveSchedulingService`) and, on any not-already-applied
   * approve/reject with an assigned technician, sends the validation
   * decision notification. KPI recomputation is intentionally not done
   * here — it is not a report concern and stays the caller's responsibility.
   */
  async applyValidationDecision(
    input: ApplyValidationDecisionInput,
  ): Promise<WorkOrderDocument | null> {
    const updatedWorkOrder = await this.lifecycleService.applyValidationAction({
      workOrderId: input.workOrderId,
      action: input.action,
      validatorId: input.validatorId,
    });
    const validationAlreadyApplied = Boolean(
      (updatedWorkOrder as { __validationAlreadyApplied?: boolean } | null)
        ?.__validationAlreadyApplied,
    );

    if (
      input.action === 'approve' &&
      updatedWorkOrder &&
      !validationAlreadyApplied
    ) {
      await this.preventiveSchedulingService.ensureNextPreventiveWorkOrder(
        updatedWorkOrder,
      );
    }

    if (
      updatedWorkOrder?.technician_id &&
      !validationAlreadyApplied &&
      (input.action === 'approve' || input.action === 'reject')
    ) {
      await this.notificationService.notifyValidationDecision({
        workOrderId: updatedWorkOrder._id.toString(),
        action: input.action,
        technicianId: updatedWorkOrder.technician_id.toString(),
        otId: updatedWorkOrder.ot_id,
        machineId: updatedWorkOrder.machine_id?.toString(),
      });
    }

    return updatedWorkOrder;
  }

  /**
   * Backfills a matching intervention report when a Work Order lands
   * directly in a completed status without ever going through the normal
   * corrective/preventive submission flow (e.g. an Admin creates or edits a
   * Work Order that is already `completed`/`validated`). A no-op whenever a
   * report already exists for this Work Order, so it is safe to call on
   * every create/update of an already-completed Work Order.
   */
  async ensureAutoInterventionReport(
    workOrder: WorkOrderForAutoInterventionReport,
    session?: ClientSession,
  ): Promise<void> {
    const existing = await this.interventionReportModel
      .findOne({ ot_id: this.objectIdString(workOrder) })
      .session(session ?? null)
      .exec();
    if (existing) {
      return;
    }

    const reportId = await this.generateReportCode();
    const now = new Date();
    const dateDebut =
      workOrder.execution_date ||
      workOrder.date_start ||
      workOrder.date_created ||
      now;
    const dateFin = workOrder.date_end || workOrder.date_closed || now;

    const codePanne = workOrder.code_panne;
    const correctiveInfo = codePanne
      ? await this.resolveCorrectiveData(codePanne)
      : null;

    await this.interventionReportModel.create(
      [
        {
          report_id: reportId,
          ot_id: this.objectIdString(workOrder),
          technician_id: workOrder.technician_id,
          date_debut: dateDebut,
          date_fin: dateFin,
          cause_racine:
            correctiveInfo?.faultDescription || workOrder.code_panne,
          description_action:
            correctiveInfo?.recommendedSolution || workOrder.description,
          etat_final: this.isCompletedStatus(workOrder.status)
            ? 'completed'
            : 'in_progress',
          validation_responsable:
            workOrder.status === 'validated'
              ? 'validated'
              : 'waiting_validation',
        },
      ],
      { session },
    );
  }

  /**
   * Resolves the known fault (code/description) and its recommended
   * solution for a corrective `code_panne`, used to enrich auto-generated
   * report content. Also reused by the facade's calendar event detail view,
   * which is why this stays a public method rather than a private helper.
   */
  async resolveCorrectiveData(codePanne?: string) {
    if (!codePanne) {
      return null;
    }

    const panne = await this.panneModel
      .findOne({ code_panne: codePanne })
      .exec();
    if (!panne) {
      return null;
    }

    const solution = await this.panneSolutionModel
      .findOne({ panne_id: panne._id })
      .exec();

    return {
      faultCode: panne.code_panne,
      faultDescription: panne.description,
      probableCause: solution?.cause_probable,
      recommendedSolution: solution?.solution_recommandee,
    };
  }

  private async generateReportCode() {
    const sequence = await this.counterService.getNextSequence(
      'intervention_report',
    );
    return `REP-${sequence.toString().padStart(6, '0')}`;
  }

  private async generateLubrificationLogCode() {
    const sequence =
      await this.counterService.getNextSequence('lubrification_log');
    return `LUB-${sequence.toString().padStart(6, '0')}`;
  }

  private async generateCorrectiveWorkOrderCode() {
    const sequence = await this.counterService.getNextSequence('work_order');
    return `WO-COR-${sequence.toString().padStart(6, '0')}`;
  }

  private isCompletedStatus(status?: string) {
    return status === 'completed' || status === 'validated';
  }

  private objectIdString(value: unknown): string {
    if (!value) return '';
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && '_id' in value) {
      const id = (value as { _id?: unknown })._id;
      if (id instanceof Types.ObjectId) return id.toHexString();
      if (typeof id === 'string') return id;
    }
    return '';
  }
}
