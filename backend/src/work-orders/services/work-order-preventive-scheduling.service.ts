/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import {
  isSchedulableMaintenanceType,
  NOT_CORRECTIVE_TYPE_FILTER,
} from '../../common/maintenance-type';
import { CounterService } from '../../counters/counter.service';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
  MaintenancePlanStatus,
} from '../../schemas/maintenance-plan.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../../schemas/module.schema';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import {
  SchedulerConfigService,
  SchedulerRuntimeSettings,
  defaultSchedulerSettings,
} from '../../scheduler/scheduler.config';
import { SchedulerLockService } from '../../scheduler/scheduler-lock.service';
import { SchedulerJobContext } from '../../scheduler/scheduler.types';
import {
  createInstanceId,
  createRunId,
  createSchedulerContext,
  mapWithConcurrency,
} from '../../scheduler/scheduler-utils';
import { MaintenanceSchedulingService } from '../maintenance-scheduling.service';
import {
  buildPreventiveOccurrenceKey,
  isDuplicatePreventiveOccurrenceKeyError,
} from '../preventive-occurrence-key';

export interface SchedulerRunSummary {
  plansEvaluated: number;
  createdFirstExecution: number;
  createdNextExecution: number;
  skippedDuplicates: number;
  plansDue?: number;
  targetsScanned?: number;
  occurrencesEvaluated?: number;
  alreadyExisting?: number;
  batches?: number;
  failed?: number;
  timedOut?: boolean;
}

export interface PreventiveScheduleInput {
  machineId: string;
  planId: string;
  scheduledDate: string;
  operatorId: string;
}

export interface RescheduleInput {
  workOrderId: string;
  newDueDate: string;
  reason: string;
  userId: string;
  role?: string;
}

type WorkOrderPayload = {
  _id?: string | { toString(): string };
  machine_id?: string | { toString(): string };
  module_id?: string | { toString(): string };
  plan_id?: string | { toString(): string };
  technician_id?: string | { toString(): string };
  type_maintenance?: string | null;
  execution_date?: string | number | Date;
  date_closed?: string | number | Date;
  date_end?: string | number | Date;
  date_start?: string | number | Date;
  original_due_date?: string | number | Date;
  description?: string;
  priorite?: string;
  status?: string;
};

@Injectable()
export class WorkOrderPreventiveSchedulingService {
  private readonly logger = new Logger(
    WorkOrderPreventiveSchedulingService.name,
  );
  private readonly schedulerInstanceId = createInstanceId(
    'preventive-scheduler',
  );

  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    private readonly counterService: CounterService,
    private readonly schedulingService: MaintenanceSchedulingService,
    @Optional()
    private readonly schedulerConfigService?: SchedulerConfigService,
    @Optional()
    private readonly schedulerLockService?: SchedulerLockService,
  ) {}

  async triggerScheduler(source = 'manual', context?: SchedulerJobContext) {
    const summary = context
      ? await this.seedMissingPreventiveWorkOrders(context)
      : await this.runManualPreventiveScheduler();
    this.logger.log(
      `Scheduler run (${source}) created_first=${summary.createdFirstExecution} created_next=${summary.createdNextExecution} skipped=${summary.skippedDuplicates}`,
    );
    return {
      source,
      executedAt: new Date().toISOString(),
      ...summary,
    };
  }

  async scheduleFirstPreventiveOccurrence(input: PreventiveScheduleInput) {
    const { machine, plan, moduleEntity } =
      await this.resolvePreventivePlanForMachine(input.machineId, input.planId);
    if (!this.isPlanSchedulable(plan)) {
      throw new ConflictException(
        `This maintenance plan is "${plan.status}" and cannot be scheduled`,
      );
    }
    const scheduledDate = this.schedulingService.parseBusinessDateInput(
      input.scheduledDate,
    );
    if (Number.isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Invalid scheduled_date');
    }

    await this.assertNoDuplicatePreventiveOccurrence({
      machineId: machine._id.toString(),
      planId: plan._id.toString(),
      dueDate: scheduledDate.toISOString(),
    });

    const otId = await this.generateWorkOrderCode(plan.type_maintenance);
    const created = await this.workOrderModel.create({
      ot_id: otId,
      machine_id: machine._id,
      module_id: moduleEntity._id,
      technician_id: new Types.ObjectId(input.operatorId),
      plan_id: plan._id,
      description: plan.instruction || 'Preventive maintenance task',
      type_maintenance: plan.type_maintenance,
      status: 'scheduled',
      priorite: 'medium',
      date_created: new Date(),
      date_start: scheduledDate,
      scheduled_date: scheduledDate,
      due_date: scheduledDate,
    });

    return {
      occurrence: created,
      schedulingState: this.schedulingService.calculateOperationalStatus({
        status: created.status,
        dueDate: created.due_date,
        intervalUnit: plan.unite_frequence || plan.frequence_label,
      }),
    };
  }

  async createInitialOccurrenceForPlan(
    planId: string,
  ): Promise<WorkOrderDocument | null> {
    if (!Types.ObjectId.isValid(planId)) {
      return null;
    }

    const plan = await this.maintenancePlanModel.findById(planId).exec();
    if (!plan || !isSchedulableMaintenanceType(plan.type_maintenance)) {
      return null;
    }

    const alreadyExists = await this.workOrderModel
      .exists({ plan_id: plan._id })
      .exec();
    if (alreadyExists) {
      return null;
    }

    const moduleEntity = await this.moduleModel.findById(plan.module_id).exec();
    if (!moduleEntity) {
      return null;
    }

    const now = new Date();
    const otId = await this.generateWorkOrderCode(plan.type_maintenance);
    return this.workOrderModel.create({
      ot_id: otId,
      machine_id: this.toPersistedObjectId(moduleEntity.machine_id),
      module_id: moduleEntity._id,
      plan_id: plan._id,
      description: plan.instruction || 'Preventive maintenance task',
      type_maintenance: plan.type_maintenance,
      status: 'scheduled',
      priorite: 'medium',
      date_created: now,
      date_start: now,
      scheduled_date: now,
      due_date: now,
    });
  }

  async reschedulePreventiveOccurrence(input: RescheduleInput) {
    if (!Types.ObjectId.isValid(input.workOrderId)) {
      throw new BadRequestException('Invalid work order id');
    }
    if (
      !['operator', 'technician', 'admin'].includes(
        (input.role || '').toLowerCase(),
      )
    ) {
      throw new ForbiddenException('User is not authorized to reschedule');
    }

    const workOrder = await this.workOrderModel
      .findById(input.workOrderId)
      .exec();
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    if (!isSchedulableMaintenanceType(workOrder.type_maintenance)) {
      throw new BadRequestException(
        'Only preventive, lubrication, or inspection occurrences can be rescheduled',
      );
    }
    if (this.isCompletedStatus(workOrder.status)) {
      throw new ConflictException('Completed occurrence cannot be rescheduled');
    }

    const nextDue = this.schedulingService.parseBusinessDateInput(
      input.newDueDate,
    );
    if (Number.isNaN(nextDue.getTime())) {
      throw new BadRequestException('Invalid new_due_date');
    }

    await this.assertNoDuplicatePreventiveOccurrence({
      machineId: this.objectIdString(workOrder.machine_id),
      planId: this.objectIdString(workOrder.plan_id),
      dueDate: nextDue.toISOString(),
      excludeId: workOrder._id.toString(),
    });

    const previousDue =
      workOrder.due_date || workOrder.scheduled_date || workOrder.date_start;
    const updated = await this.workOrderModel
      .findByIdAndUpdate(
        workOrder._id,
        {
          $set: {
            scheduled_date: nextDue,
            due_date: nextDue,
            date_start: nextDue,
            status: 'scheduled',
            original_due_date: workOrder.original_due_date || previousDue,
            reschedule_reason: input.reason,
            rescheduled_by: new Types.ObjectId(input.userId),
            rescheduled_at: new Date(),
          },
        },
        { new: true },
      )
      .exec();

    return {
      occurrence: updated,
      schedulingState: this.schedulingService.calculateOperationalStatus({
        status: updated?.status,
        dueDate: updated?.due_date,
      }),
    };
  }

  async assertNoDuplicatePreventiveOccurrence(input: {
    machineId?: string;
    planId?: string;
    dueDate?: string;
    excludeId?: string;
  }) {
    if (!input.machineId || !input.planId || !input.dueDate) {
      return;
    }
    if (
      !Types.ObjectId.isValid(input.machineId) ||
      !Types.ObjectId.isValid(input.planId)
    ) {
      return;
    }
    const dueDate = new Date(input.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      return;
    }

    const dayStart = this.schedulingService.startOfLocalDay(dueDate);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const query: Record<string, unknown> = {
      machine_id: new Types.ObjectId(input.machineId),
      plan_id: new Types.ObjectId(input.planId),
      ...NOT_CORRECTIVE_TYPE_FILTER,
      status: {
        $nin: ['completed', 'validated', 'cancelled', 'canceled', 'rejected'],
      },
      $or: [
        { due_date: { $gte: dayStart, $lt: dayEnd } },
        { scheduled_date: { $gte: dayStart, $lt: dayEnd } },
        { execution_date: { $gte: dayStart, $lt: dayEnd } },
        { date_start: { $gte: dayStart, $lt: dayEnd } },
      ],
    };

    if (input.excludeId && Types.ObjectId.isValid(input.excludeId)) {
      query._id = { $ne: new Types.ObjectId(input.excludeId) };
    }

    const duplicate = await this.workOrderModel.findOne(query).exec();
    if (duplicate) {
      throw new ConflictException(
        'Duplicate preventive occurrence already exists',
      );
    }
  }

  async ensureNextPreventiveWorkOrder(
    workOrder: WorkOrderPayload,
    dueKeySet?: Set<string>,
    latestOrderByPlanKey?: Map<string, WorkOrderPayload>,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!isSchedulableMaintenanceType(workOrder.type_maintenance)) {
      return false;
    }

    const planId = this.objectIdString(workOrder.plan_id);
    if (!planId) {
      return false;
    }

    const plan = await this.maintenancePlanModel
      .findById(planId)
      .session(session ?? null)
      .exec();
    if (!plan) {
      return false;
    }
    if (!this.isPlanSchedulable(plan)) {
      return false;
    }

    return this.createNextPreventiveWorkOrderAtomically(
      workOrder,
      plan,
      dueKeySet,
      latestOrderByPlanKey,
      session,
    );
  }

  async seedMissingPreventiveWorkOrders(
    context?: SchedulerJobContext,
  ): Promise<SchedulerRunSummary> {
    const summary: SchedulerRunSummary = {
      plansEvaluated: 0,
      createdFirstExecution: 0,
      createdNextExecution: 0,
      skippedDuplicates: 0,
      plansDue: 0,
      targetsScanned: 0,
      occurrencesEvaluated: 0,
      alreadyExisting: 0,
      batches: 0,
      failed: 0,
      timedOut: false,
    };

    const settings = this.getSchedulerSettings();
    let lastId: Types.ObjectId | undefined;
    const dueKeySet = new Set<string>();

    while (
      (!context || context.shouldContinue()) &&
      summary.plansEvaluated < settings.maxItemsPerRun
    ) {
      const remaining = settings.maxItemsPerRun - summary.plansEvaluated;
      const filter: FilterQuery<MaintenancePlanDocument> = {
        ...NOT_CORRECTIVE_TYPE_FILTER,
        $and: [
          {
            $or: [
              { status: MaintenancePlanStatus.ACTIVE },
              { status: { $exists: false } },
              { status: null },
            ],
          },
          ...(lastId ? [{ _id: { $gt: lastId } }] : []),
        ],
      };

      const plans = await this.maintenancePlanModel
        .find(filter, {
          _id: 1,
          plan_id: 1,
          module_id: 1,
          type_maintenance: 1,
          frequence: 1,
          unite_frequence: 1,
          frequence_label: 1,
          instruction: 1,
          status: 1,
        })
        .lean()
        .sort({ _id: 1 })
        .limit(Math.min(settings.batchSize, remaining))
        .exec();

      if (!plans.length) {
        break;
      }

      summary.batches! += 1;
      summary.plansEvaluated += plans.length;
      lastId = plans.at(-1)!._id;

      const moduleIds = plans
        .map((plan) => this.objectIdString(plan.module_id))
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));

      const modules = moduleIds.length
        ? await this.moduleModel
            .find(
              { _id: { $in: moduleIds } },
              { _id: 1, machine_id: 1, module_id: 1 },
            )
            .lean()
            .exec()
        : [];
      const moduleById = new Map<string, any>();
      for (const moduleEntity of modules) {
        moduleById.set(this.objectIdString(moduleEntity._id), moduleEntity);
      }

      const machineIds = modules
        .map((moduleEntity) => this.objectIdString(moduleEntity.machine_id))
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      const machines = machineIds.length
        ? await this.machineModel
            .find(
              { _id: { $in: machineIds } },
              { _id: 1, machine_id: 1, installation_date: 1 },
            )
            .lean()
            .exec()
        : [];
      const machineById = new Map<string, any>();
      for (const machine of machines) {
        machineById.set(this.objectIdString(machine._id), machine);
      }

      const latestOrderByPlanKey =
        await this.findLatestPreventiveOrdersForPlans(
          plans.map((plan) => plan._id),
        );

      const duePlans: Array<{
        plan: any;
        latest: WorkOrderPayload;
      }> = [];

      for (const plan of plans) {
        if (!this.isPlanSchedulable(plan)) {
          continue;
        }
        const moduleEntity = moduleById.get(
          this.objectIdString(plan.module_id),
        );
        if (!moduleEntity) {
          summary.skippedDuplicates += 1;
          continue;
        }
        const machine = machineById.get(
          this.objectIdString(moduleEntity.machine_id),
        );
        if (!machine) {
          summary.skippedDuplicates += 1;
          continue;
        }
        summary.targetsScanned! += 1;

        const key = this.buildPlanKey(machine, moduleEntity, plan);
        const latest = latestOrderByPlanKey.get(key);
        if (!latest) {
          summary.skippedDuplicates += 1;
          continue;
        }
        if (!this.isCompletedStatus(latest.status)) {
          summary.alreadyExisting! += 1;
          summary.skippedDuplicates += 1;
          continue;
        }
        duePlans.push({ plan, latest });
      }

      summary.plansDue! += duePlans.length;
      await mapWithConcurrency(
        duePlans,
        settings.concurrency,
        async ({ plan, latest }) => {
          if (context && !context.shouldContinue()) return;
          summary.occurrencesEvaluated! += 1;
          try {
            const created = await this.createNextPreventiveWorkOrderAtomically(
              latest,
              plan,
              dueKeySet,
              latestOrderByPlanKey,
            );
            if (created) {
              summary.createdNextExecution += 1;
            } else {
              summary.alreadyExisting! += 1;
              summary.skippedDuplicates += 1;
            }
          } catch (error) {
            summary.failed! += 1;
            this.logger.warn(
              `[job_generate_preventive_maintenance] item failed: ${this.sanitizedError(error)}`,
            );
          }
        },
      );

      if (plans.length < settings.batchSize) {
        break;
      }
      if (context && !(await context.heartbeat())) {
        break;
      }
    }

    summary.timedOut = Boolean(context && !context.shouldContinue());

    return summary;
  }

  private async runManualPreventiveScheduler(): Promise<SchedulerRunSummary> {
    const settings = this.getSchedulerSettings();

    if (!this.schedulerLockService) {
      const context = createSchedulerContext(
        'job_generate_preventive_maintenance',
        createRunId(),
        this.schedulerInstanceId,
        settings.jobTimeoutMs,
        () => Promise.resolve(true),
      );
      return this.seedMissingPreventiveWorkOrders(context);
    }

    const runId = createRunId();
    const lock = await this.schedulerLockService.acquire(
      'job_generate_preventive_maintenance',
      runId,
      settings.lockTtlMs,
    );
    if (!lock) {
      return {
        plansEvaluated: 0,
        createdFirstExecution: 0,
        createdNextExecution: 0,
        skippedDuplicates: 0,
        alreadyExisting: 0,
        batches: 0,
      };
    }

    const heartbeatTimer = setInterval(() => {
      void this.schedulerLockService
        ?.heartbeat(lock, settings.lockTtlMs)
        .catch((error) => {
          this.logger.warn(
            `[job_generate_preventive_maintenance] heartbeat failed: ${this.sanitizedError(error)}`,
          );
        });
    }, settings.lockHeartbeatMs);
    heartbeatTimer.unref?.();

    const context = createSchedulerContext(
      'job_generate_preventive_maintenance',
      runId,
      this.schedulerInstanceId,
      settings.jobTimeoutMs,
      () => this.schedulerLockService!.heartbeat(lock, settings.lockTtlMs),
    );

    try {
      return await this.seedMissingPreventiveWorkOrders(context);
    } finally {
      clearInterval(heartbeatTimer);
      await this.schedulerLockService.release(
        lock,
        context.shouldContinue() ? 'completed' : 'timed_out',
      );
    }
  }

  private async createNextPreventiveWorkOrderAtomically(
    workOrder: WorkOrderPayload,
    plan: any,
    dueKeySet?: Set<string>,
    latestOrderByPlanKey?: Map<string, WorkOrderPayload>,
    session?: ClientSession,
  ): Promise<boolean> {
    const baseDate =
      workOrder.execution_date ||
      workOrder.date_closed ||
      workOrder.date_end ||
      workOrder.date_start;

    if (!baseDate) {
      return false;
    }

    const nextDue = this.schedulingService.calculateNextDueDate({
      performedAt: new Date(baseDate),
      frequency: plan.frequence,
      intervalUnit: plan.unite_frequence || plan.frequence_label,
      timezone: process.env.BUSINESS_TIMEZONE || 'Africa/Tunis',
    });

    const key = this.buildPlanKey(
      workOrder.machine_id,
      workOrder.module_id,
      workOrder.plan_id,
    );
    const dueKey = `${key}|${nextDue.getTime()}`;
    const occurrenceKey = buildPreventiveOccurrenceKey({
      maintenanceType: workOrder.type_maintenance,
      machineId: workOrder.machine_id,
      moduleId: workOrder.module_id,
      planId: workOrder.plan_id,
      dueDate: nextDue,
    });
    if (dueKeySet?.has(dueKey)) {
      return false;
    }

    const duplicate = await this.workOrderModel
      .findOne({
        machine_id: workOrder.machine_id,
        plan_id: workOrder.plan_id,
        type_maintenance: workOrder.type_maintenance,
        status: { $nin: ['completed', 'validated', 'cancelled', 'canceled'] },
        due_date: nextDue,
      })
      .session(session ?? null)
      .exec();
    if (duplicate) {
      return false;
    }

    const nextOtId = await this.generateWorkOrderCode(
      workOrder.type_maintenance ?? undefined,
    );
    const createdPayload = {
      ot_id: nextOtId,
      machine_id: workOrder.machine_id,
      module_id: workOrder.module_id,
      technician_id: workOrder.technician_id,
      plan_id: workOrder.plan_id,
      preventive_occurrence_key: occurrenceKey,
      description: workOrder.description,
      type_maintenance: workOrder.type_maintenance,
      status: 'pending',
      priorite: workOrder.priorite || 'medium',
      date_created: new Date(),
      date_start: nextDue,
      scheduled_date: nextDue,
      due_date: nextDue,
      recurrence_source_occurrence_id: new Types.ObjectId(
        this.objectIdString(workOrder),
      ),
    };

    let created = false;
    try {
      const result = await this.workOrderModel
        .updateOne(
          { preventive_occurrence_key: occurrenceKey },
          { $setOnInsert: createdPayload },
          { upsert: true, session },
        )
        .exec();
      created = Boolean(
        (result as { upsertedCount?: number; upsertedId?: unknown })
          .upsertedCount ||
        (result as { upsertedCount?: number; upsertedId?: unknown }).upsertedId,
      );
    } catch (error: unknown) {
      if (isDuplicatePreventiveOccurrenceKeyError(error, occurrenceKey)) {
        created = false;
      } else {
        throw error;
      }
    }

    if (!created) {
      return false;
    }

    dueKeySet?.add(dueKey);
    latestOrderByPlanKey?.set(key, createdPayload);

    return true;
  }

  private async resolvePreventivePlanForMachine(
    machineId: string,
    planId: string,
  ) {
    if (!Types.ObjectId.isValid(machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }
    if (!Types.ObjectId.isValid(planId)) {
      throw new BadRequestException('Invalid plan_id');
    }

    const [machine, plan] = await Promise.all([
      this.machineModel.findById(machineId).exec(),
      this.maintenancePlanModel.findById(planId).exec(),
    ]);
    if (!machine) {
      throw new NotFoundException('Machine not found');
    }
    if (!plan) {
      throw new NotFoundException('Maintenance plan not found');
    }
    if (!isSchedulableMaintenanceType(plan.type_maintenance)) {
      throw new BadRequestException(
        'Maintenance plan is not schedulable (corrective plans cannot be scheduled this way)',
      );
    }

    const moduleEntity = await this.moduleModel
      .findOne({
        _id: plan.module_id,
        ...this.moduleMachineFilter(machine._id.toString()),
      })
      .exec();
    if (!moduleEntity) {
      throw new BadRequestException(
        'Maintenance plan does not apply to machine',
      );
    }

    return { machine, plan, moduleEntity };
  }

  private async findLatestPreventiveOrdersForPlans(
    planIds: Types.ObjectId[],
  ): Promise<Map<string, WorkOrderPayload>> {
    const latestOrderByPlanKey = new Map<string, WorkOrderPayload>();
    if (!planIds.length) {
      return latestOrderByPlanKey;
    }

    const rows = await this.workOrderModel
      .aggregate([
        {
          $match: {
            ...NOT_CORRECTIVE_TYPE_FILTER,
            plan_id: { $in: planIds },
          },
        },
        {
          $sort: {
            plan_id: 1,
            machine_id: 1,
            module_id: 1,
            date_start: -1,
            date_created: -1,
            _id: -1,
          },
        },
        {
          $group: {
            _id: {
              machine_id: '$machine_id',
              module_id: '$module_id',
              plan_id: '$plan_id',
            },
            order: { $first: '$$ROOT' },
          },
        },
      ])
      .exec();

    for (const row of rows as Array<{ order?: WorkOrderPayload }>) {
      const order = row.order;
      if (!order) {
        continue;
      }
      latestOrderByPlanKey.set(
        this.buildPlanKey(order.machine_id, order.module_id, order.plan_id),
        order,
      );
    }

    return latestOrderByPlanKey;
  }

  private isCompletedStatus(status?: string) {
    return status === 'completed' || status === 'validated';
  }

  private isPlanSchedulable(plan: { status?: MaintenancePlanStatus }): boolean {
    return !plan.status || plan.status === MaintenancePlanStatus.ACTIVE;
  }

  private objectIdString(value: unknown): string {
    if (!value) return '';

    if (typeof value === 'string') {
      return value;
    }

    if (value instanceof Types.ObjectId) {
      return value.toString();
    }

    if (typeof value === 'object' && value !== null && '_id' in value) {
      const maybeId = (value as { _id?: unknown })._id;
      return this.objectIdString(maybeId);
    }

    return '';
  }

  private moduleMachineFilter(machineId: string): Record<string, unknown> {
    return {
      $expr: {
        $eq: [{ $toString: '$machine_id' }, machineId],
      },
    };
  }

  private toPersistedObjectId(value: unknown): unknown {
    const id = this.objectIdString(value);
    return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : value;
  }

  private buildPlanKey(
    machine: unknown,
    moduleEntity: unknown,
    plan: unknown,
  ): string {
    return [
      this.objectIdString(machine),
      this.objectIdString(moduleEntity),
      this.objectIdString(plan),
    ].join('|');
  }

  private getSchedulerSettings(): SchedulerRuntimeSettings {
    return (
      this.schedulerConfigService?.getSettings() ?? defaultSchedulerSettings()
    );
  }

  private sanitizedError(error: unknown): string {
    if (error instanceof Error) return error.message.slice(0, 300);
    return String(error).slice(0, 300);
  }

  private async generateWorkOrderCode(type?: string) {
    const sequence = await this.counterService.getNextSequence('work_order');
    const prefix = (type || 'maintenance').toLowerCase().startsWith('correct')
      ? 'WO-COR'
      : 'WO-PREV';
    return `${prefix}-${sequence.toString().padStart(6, '0')}`;
  }
}
