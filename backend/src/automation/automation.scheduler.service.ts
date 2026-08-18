/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../schemas/lubrification-log.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { Capteur, CapteurDocument } from '../schemas/capteur.schema';
import { Mesure, MesureDocument } from '../schemas/mesure.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import { User, UserDocument, Role } from '../schemas/user.schema';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import { KpiService } from '../kpi/kpi.service';
import {
  AutomationJobLock,
  AutomationJobLockDocument,
} from '../schemas/automation-job-lock.schema';
import {
  SchedulerConfigService,
  SchedulerRuntimeSettings,
  defaultSchedulerSettings,
} from '../scheduler/scheduler.config';
import { SchedulerLockService } from '../scheduler/scheduler-lock.service';
import {
  SchedulerJobContext,
  SchedulerJobResult,
  SchedulerLockHandle,
} from '../scheduler/scheduler.types';
import {
  buildSchedulerJobResult,
  createRunId,
  createSchedulerContext,
  mapWithConcurrency,
} from '../scheduler/scheduler-utils';

interface JobWorkResult {
  processed: number;
  scanned?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  batches?: number;
  retries?: number;
  details?: Record<string, unknown>;
}

@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private readonly schedulerInstanceId = `${process.pid}-${randomUUID()}`;

  constructor(
    private readonly workOrdersService: WorkOrdersService,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(LubrificationLog.name)
    private readonly lubrificationLogModel: Model<LubrificationLogDocument>,
    @InjectModel(Stock.name)
    private readonly stockModel: Model<StockDocument>,
    @InjectModel(Capteur.name)
    private readonly capteurModel: Model<CapteurDocument>,
    @InjectModel(Mesure.name)
    private readonly mesureModel: Model<MesureDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AutomationJobLock.name)
    private readonly automationJobLockModel: Model<AutomationJobLockDocument>,
    private readonly notificationCenterService: NotificationCenterService,
    private readonly kpiService: KpiService,
    @Optional()
    private readonly schedulerConfigService?: SchedulerConfigService,
    @Optional()
    private readonly schedulerLockService?: SchedulerLockService,
  ) {
    this.logger.log('Background scheduler initialized (automatic mode).');
  }

  @Cron('5 0 * * *', {
    name: 'automation-nightly',
    timeZone: process.env.AUTOMATION_TIMEZONE || 'UTC',
  })
  async runNightlyJobs() {
    await this.executeBatch('nightly', [
      [
        'job_generate_preventive_maintenance',
        (context) => this.jobGeneratePreventiveMaintenance(context),
      ],
      [
        'job_mark_overdue_maintenance',
        (context) => this.jobMarkOverdueMaintenance(context),
      ],
      ['job_refresh_kpis', (context) => this.jobRefreshKpis(context)],
      [
        'job_detect_duplicate_workorders',
        (context) => this.jobDetectDuplicateWorkOrders(context),
      ],
      [
        'job_calendar_synchronization',
        (context) => this.jobCalendarSynchronization(context),
      ],
    ]);
  }

  @Cron('0 * * * *', {
    name: 'automation-hourly',
    timeZone: process.env.AUTOMATION_TIMEZONE || 'UTC',
  })
  async runHourlyJobs() {
    await this.executeBatch('hourly', [
      [
        'job_upcoming_maintenance_reminders',
        (context) => this.jobUpcomingMaintenanceReminders(context),
      ],
      [
        'job_overdue_escalation',
        (context) => this.jobOverdueEscalation(context),
      ],
      ['job_stock_monitoring', (context) => this.jobStockMonitoring(context)],
      [
        'job_lubrication_reminders',
        (context) => this.jobLubricationReminders(context),
      ],
    ]);
  }

  @Cron('*/10 * * * *', {
    name: 'automation-10min',
    timeZone: process.env.AUTOMATION_TIMEZONE || 'UTC',
  })
  async runTenMinuteJobs() {
    await this.executeBatch('10min', [
      ['job_sensor_monitoring', (context) => this.jobSensorMonitoring(context)],
      [
        'job_mark_overdue_maintenance',
        (context) => this.jobMarkOverdueMaintenance(context),
      ],
    ]);
  }

  private async executeBatch(
    label: string,
    jobs: Array<
      [string, (context: SchedulerJobContext) => Promise<JobWorkResult>]
    >,
  ) {
    if (!this.getSchedulerSettings().enabled) {
      this.logger.log(`Scheduler batch skipped: ${label} disabled=true`);
      return;
    }

    this.logger.log(`Scheduler batch started: ${label}`);

    for (const [name, job] of jobs) {
      await this.runJob(name, job);
    }

    this.logger.log(`Scheduler batch finished: ${label}`);
  }

  private async runJob(
    name: string,
    job: (context: SchedulerJobContext) => Promise<JobWorkResult>,
  ): Promise<SchedulerJobResult> {
    const settings = this.getSchedulerSettings();
    const triggerTime = new Date();
    const runId = createRunId();
    const instanceId =
      this.schedulerLockService?.getInstanceId() ?? this.schedulerInstanceId;
    const startedAt = new Date();
    const lock = await this.acquireJobLock(name, runId, settings.lockTtlMs);
    if (!lock) {
      this.logger.warn(
        JSON.stringify({
          jobName: name,
          runId,
          instanceId,
          status: 'skipped',
          lockAcquired: false,
          reason: 'lock_not_acquired',
        }),
      );
      return buildSchedulerJobResult({
        jobName: name,
        runId,
        instanceId,
        triggerTime,
        startTime: startedAt,
        status: 'skipped',
        lockAcquired: false,
      });
    }

    let finalStatus: SchedulerJobResult['status'] = 'completed';
    const context = createSchedulerContext(
      name,
      runId,
      instanceId,
      settings.jobTimeoutMs,
      () => this.heartbeatJobLock(lock, settings.lockTtlMs),
    );

    try {
      this.logger.log(
        JSON.stringify({
          jobName: name,
          runId,
          instanceId,
          status: 'started',
          triggerTime: triggerTime.toISOString(),
        }),
      );
      const heartbeatTimer = setInterval(() => {
        void context.heartbeat().catch((error) => {
          this.logger.warn(
            `[${name}] heartbeat failed: ${this.sanitizedError(error)}`,
          );
        });
      }, settings.lockHeartbeatMs);
      heartbeatTimer.unref?.();

      let result: JobWorkResult;
      try {
        result = await job(context);
      } finally {
        clearInterval(heartbeatTimer);
      }
      finalStatus = this.resolveJobFinalStatus(result, context);
      const jobResult = buildSchedulerJobResult({
        jobName: name,
        runId,
        instanceId,
        triggerTime,
        startTime: startedAt,
        status: finalStatus,
        lockAcquired: true,
        counters: {
          scanned:
            result.scanned ??
            (typeof result.details?.scanned === 'number'
              ? result.details.scanned
              : 0),
          processed: result.processed,
          succeeded: result.succeeded ?? result.processed,
          failed: result.failed ?? 0,
          skipped: result.skipped ?? 0,
          batches: result.batches ?? 0,
          retries: result.retries ?? 0,
        },
        details: result.details,
      });
      this.logger.log(JSON.stringify(jobResult));
      return jobResult;
    } catch (error) {
      finalStatus = context.shouldContinue() ? 'failed' : 'timed_out';
      const jobResult = buildSchedulerJobResult({
        jobName: name,
        runId,
        instanceId,
        triggerTime,
        startTime: startedAt,
        status: finalStatus,
        lockAcquired: true,
        counters: { failed: 1 },
        details: { error: this.sanitizedError(error) },
      });
      this.logger.error(JSON.stringify(jobResult));
      return jobResult;
    } finally {
      await this.releaseJobLock(lock, finalStatus);
    }
  }

  private async acquireJobLock(
    name: string,
    runId: string,
    leaseMs: number,
  ): Promise<SchedulerLockHandle | null> {
    if (this.schedulerLockService) {
      return this.schedulerLockService.acquire(name, runId, leaseMs);
    }

    const now = new Date();
    const owner = `${this.schedulerInstanceId}-${Date.now()}`;
    const expiresAt = new Date(now.getTime() + leaseMs);

    try {
      const lock = await this.automationJobLockModel
        .findOneAndUpdate(
          {
            name,
            $or: [
              { expires_at: { $lte: now } },
              { expires_at: { $exists: false } },
            ],
          },
          {
            $set: {
              name,
              owner,
              owner_id: owner,
              run_id: runId,
              acquired_at: now,
              heartbeat_at: now,
              expires_at: expiresAt,
              status: 'running',
            },
          },
          {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true,
          },
        )
        .lean()
        .exec();

      return lock?.owner === owner
        ? { jobName: name, ownerId: owner, runId, expiresAt }
        : null;
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11_000) {
        return null;
      }
      throw error;
    }
  }

  private async heartbeatJobLock(
    lock: SchedulerLockHandle,
    leaseMs: number,
  ): Promise<boolean> {
    if (this.schedulerLockService) {
      return this.schedulerLockService.heartbeat(lock, leaseMs);
    }
    const now = new Date();
    const result = await this.automationJobLockModel
      .findOneAndUpdate(
        {
          name: lock.jobName,
          owner_id: lock.ownerId,
          run_id: lock.runId,
          expires_at: { $gt: now },
        },
        {
          $set: {
            heartbeat_at: now,
            expires_at: new Date(now.getTime() + leaseMs),
          },
        },
      )
      .lean()
      .exec();
    return Boolean(result);
  }

  private async releaseJobLock(
    lock: SchedulerLockHandle,
    status: string,
  ): Promise<void> {
    if (this.schedulerLockService) {
      await this.schedulerLockService.release(lock, status);
      return;
    }
    await this.automationJobLockModel
      .deleteOne({
        name: lock.jobName,
        owner_id: lock.ownerId,
        run_id: lock.runId,
      })
      .exec();
  }

  private async jobGeneratePreventiveMaintenance(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const summary = await this.workOrdersService.triggerScheduler(
      'cron_nightly',
      context,
    );
    return {
      processed:
        Number(summary.createdFirstExecution || 0) +
        Number(summary.createdNextExecution || 0),
      scanned: Number(summary.plansEvaluated || 0),
      succeeded:
        Number(summary.createdFirstExecution || 0) +
        Number(summary.createdNextExecution || 0),
      failed: Number(summary.failed || 0),
      skipped: Number(summary.skippedDuplicates || 0),
      batches: Number(summary.batches || 0),
      details: summary,
    };
  }

  private async jobUpcomingMaintenanceReminders(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const settings = this.getSchedulerSettings();
    const now = new Date();
    const today = this.startOfDay(now);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const eightDays = new Date(today);
    eightDays.setDate(eightDays.getDate() + 8);

    const rows = await this.workOrderModel
      .find(
        {
          status: { $nin: ['completed', 'validated', 'cancelled'] },
          $or: [
            { due_date: { $gte: tomorrow, $lt: eightDays } },
            { scheduled_date: { $gte: tomorrow, $lt: eightDays } },
            { date_start: { $gte: tomorrow, $lt: eightDays } },
          ],
        },
        {
          _id: 1,
          ot_id: 1,
          technician_id: 1,
          due_date: 1,
          scheduled_date: 1,
          date_start: 1,
          machine_id: 1,
        },
      )
      .lean()
      .sort({ _id: 1 })
      .limit(Math.min(settings.batchSize, settings.maxItemsPerRun))
      .exec();

    let notifications = 0;
    let failed = 0;

    await mapWithConcurrency(
      rows,
      settings.externalConcurrency,
      async (row) => {
        if (context && !context.shouldContinue()) return;
        try {
          const dueSource =
            row.due_date || row.scheduled_date || row.date_start;
          if (!dueSource) return;
          const dueDate = this.startOfDay(new Date(dueSource));
          const days = Math.round(
            (dueDate.getTime() - today.getTime()) / 86_400_000,
          );
          if (![1, 3, 7].includes(days)) {
            return;
          }

          const workOrderId = this.objectIdString(row._id);
          const dedupeKey = `upcoming:${workOrderId}:${days}:${today.toISOString()}`;
          const created =
            await this.notificationCenterService.createIfNotExists({
              dedupeKey,
              type: NotificationType.PREVENTIVE_DUE,
              title: `Upcoming maintenance in ${days} day(s) for ${
                row.ot_id || workOrderId
              }`,
              workOrderId,
              machineId: this.objectIdString(row.machine_id) || undefined,
              ...this.resolveRecipient(this.objectIdString(row.technician_id)),
            });
          if (created) {
            notifications += 1;
          }
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `[job_upcoming_maintenance_reminders] item failed: ${this.sanitizedError(error)}`,
          );
        }
      },
    );

    return {
      processed: notifications,
      scanned: rows.length,
      succeeded: notifications,
      failed,
      batches: rows.length ? 1 : 0,
      details: { scanned: rows.length },
    };
  }

  private async jobMarkOverdueMaintenance(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const now = new Date();
    const settings = this.getSchedulerSettings();

    const overdueRows = await this.workOrderModel
      .find(
        {
          status: {
            $nin: [
              'completed',
              'validated',
              'cancelled',
              'overdue',
              'waiting_validation',
              'returned',
            ],
          },
          $or: [
            { due_date: { $lt: now } },
            { scheduled_date: { $lt: now } },
            { date_start: { $lt: now } },
          ],
        },
        {
          _id: 1,
          ot_id: 1,
          technician_id: 1,
          machine_id: 1,
          due_date: 1,
          scheduled_date: 1,
          date_start: 1,
        },
      )
      .lean()
      .sort({ _id: 1 })
      .limit(Math.min(settings.batchSize, settings.maxItemsPerRun))
      .exec();

    if (!overdueRows.length) {
      return { processed: 0 };
    }

    const ids = overdueRows.map((row) => row._id);
    const updateResult = await this.workOrderModel
      .updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            status: 'overdue',
          },
        },
      )
      .exec();

    let notifications = 0;
    await mapWithConcurrency(
      overdueRows,
      settings.externalConcurrency,
      async (row) => {
        if (context && !context.shouldContinue()) {
          return;
        }
        const workOrderId = this.objectIdString(row._id);
        const dedupeKey = `overdue:${workOrderId}:${this.startOfDay(now).toISOString()}`;
        const created = await this.notificationCenterService.createIfNotExists({
          dedupeKey,
          type: NotificationType.PREVENTIVE_OVERDUE,
          title: `Work order ${row.ot_id || workOrderId} is overdue`,
          workOrderId,
          machineId: this.objectIdString(row.machine_id) || undefined,
          ...this.resolveRecipient(this.objectIdString(row.technician_id)),
        });
        if (created) {
          notifications += 1;
        }
      },
    );

    return {
      processed: Number(updateResult.modifiedCount || 0),
      scanned: overdueRows.length,
      succeeded: Number(updateResult.modifiedCount || 0),
      batches: overdueRows.length ? 1 : 0,
      details: {
        scanned: overdueRows.length,
        notifications,
      },
    };
  }

  private async jobOverdueEscalation(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const now = new Date();
    const settings = this.getSchedulerSettings();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const overdueRows = await this.workOrderModel
      .find(
        {
          status: 'overdue',
          $or: [
            { due_date: { $lte: threeDaysAgo, $ne: null } },
            {
              due_date: null,
              scheduled_date: { $lte: threeDaysAgo, $ne: null },
            },
            {
              due_date: null,
              scheduled_date: null,
              date_start: { $lte: threeDaysAgo, $ne: null },
            },
          ],
        },
        {
          _id: 1,
          ot_id: 1,
          technician_id: 1,
          due_date: 1,
          scheduled_date: 1,
          date_start: 1,
        },
      )
      .lean()
      .sort({ due_date: 1, scheduled_date: 1, date_start: 1, _id: 1 })
      .limit(Math.min(settings.batchSize, settings.maxItemsPerRun))
      .exec();

    const supervisors = await this.userModel
      .find(
        { role: { $in: ['admin', 'supervisor'] } },
        { _id: 1, nom_complet: 1 },
      )
      .lean()
      .exec();

    let notifications = 0;

    let failed = 0;
    await mapWithConcurrency(
      overdueRows,
      settings.externalConcurrency,
      async (row) => {
        if (context && !context.shouldContinue()) return;
        try {
          const dueSource =
            row.due_date || row.scheduled_date || row.date_start;
          if (!dueSource) return;
          const due = new Date(dueSource);
          const overdueDays = Math.floor(
            (now.getTime() - due.getTime()) / 86_400_000,
          );
          const workOrderId = this.objectIdString(row._id);

          if (overdueDays >= 3) {
            const dedupeKey = `escalation:tech:${workOrderId}:${Math.floor(overdueDays / 3)}`;
            const created =
              await this.notificationCenterService.createIfNotExists({
                dedupeKey,
                type: NotificationType.OVERDUE_ESCALATION,
                title: `Escalation 3+ days overdue for ${
                  row.ot_id || workOrderId
                }`,
                workOrderId,
                ...this.resolveRecipient(
                  this.objectIdString(row.technician_id),
                ),
              });
            if (created) {
              notifications += 1;
            }
          }

          if (overdueDays >= 7) {
            for (const supervisor of supervisors) {
              const supervisorId = this.objectIdString(supervisor._id);
              const dedupeKey = `escalation:supervisor:${workOrderId}:${supervisorId}:${Math.floor(
                overdueDays / 7,
              )}`;
              const created =
                await this.notificationCenterService.createIfNotExists({
                  dedupeKey,
                  type: NotificationType.OVERDUE_ESCALATION,
                  title: `Escalation 7+ days overdue for ${
                    row.ot_id || workOrderId
                  }`,
                  workOrderId,
                  recipientUserId: supervisorId,
                });
              if (created) {
                notifications += 1;
              }
            }
          }
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `[job_overdue_escalation] item failed: ${this.sanitizedError(error)}`,
          );
        }
      },
    );

    return {
      processed: notifications,
      scanned: overdueRows.length,
      succeeded: notifications,
      failed,
      batches: overdueRows.length ? 1 : 0,
      details: { scanned: overdueRows.length, supervisors: supervisors.length },
    };
  }

  /**
   * Uses `KpiService.computeStockAlerts()` — the same reservation-aware
   * "available = on-hand minus reserved" formula the Admin dashboard's
   * stock-alert card shows — instead of its own copy of the threshold
   * comparison, so a stock never alerts here but not on the dashboard (or
   * vice versa).
   */
  private async jobStockMonitoring(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const { items } = await this.kpiService.computeStockAlerts();
    const settings = this.getSchedulerSettings();

    let alerts = 0;
    let failed = 0;
    await mapWithConcurrency(
      items.slice(0, settings.maxItemsPerRun),
      settings.externalConcurrency,
      async (item) => {
        if (context && !context.shouldContinue()) return;
        try {
          const created =
            await this.notificationCenterService.createIfNotExists({
              dedupeKey: `stock_alert:${item.stockId}:${item.available}`,
              type: NotificationType.STOCK_ALERT,
              title: `Stock alert for ${item.stockCode}: available ${item.available} <= threshold ${item.threshold}`,
              referenceId: item.partId,
              recipientRole: Role.ADMIN,
            });
          if (created) {
            alerts += 1;
          }
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `[job_stock_monitoring] item failed: ${this.sanitizedError(error)}`,
          );
        }
      },
    );

    return {
      processed: alerts,
      scanned: items.length,
      succeeded: alerts,
      failed,
      batches: items.length ? 1 : 0,
      details: { scanned: items.length },
    };
  }

  private async jobLubricationReminders(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const settings = this.getSchedulerSettings();
    const latestLogs = await this.lubrificationLogModel
      .aggregate([
        { $sort: { date_application: -1 } },
        {
          $group: {
            _id: '$module_id',
            lastDate: { $first: '$date_application' },
            lastTechnician: { $first: '$technician_id' },
          },
        },
        { $limit: settings.maxItemsPerRun },
      ])
      .exec();

    const moduleIds = latestLogs
      .map((item: { _id: Types.ObjectId }) => item._id)
      .filter(
        (id: unknown): id is Types.ObjectId => id instanceof Types.ObjectId,
      );

    const modules = await this.moduleModel
      .find(
        { _id: { $in: moduleIds } },
        { _id: 1, machine_id: 1, module_id: 1 },
      )
      .lean()
      .exec();
    const moduleMap = new Map<string, (typeof modules)[number]>();
    for (const moduleEntity of modules) {
      moduleMap.set(this.objectIdString(moduleEntity._id), moduleEntity);
    }

    const plans = await this.maintenancePlanModel
      .find(
        { type_maintenance: { $regex: /(lubr|graiss|huile)/i } },
        { _id: 1, module_id: 1, frequence: 1, unite_frequence: 1 },
      )
      .lean()
      .exec();

    const planByModule = new Map<string, (typeof plans)[number]>();
    for (const plan of plans) {
      const moduleId = this.objectIdString(plan.module_id);
      if (!planByModule.has(moduleId)) {
        planByModule.set(moduleId, plan);
      }
    }

    const today = this.startOfDay(new Date());
    let reminders = 0;

    let failed = 0;
    await mapWithConcurrency(
      latestLogs,
      settings.externalConcurrency,
      async (entry) => {
        if (context && !context.shouldContinue()) return;
        try {
          const moduleId = this.objectIdString(entry._id);
          const moduleEntity = moduleMap.get(moduleId);
          const plan = planByModule.get(moduleId);

          const frequency = plan?.frequence ?? 1;
          const unit = plan?.unite_frequence ?? 'month';
          const nextDue = this.computeNextDueDate(
            new Date(entry.lastDate),
            frequency,
            unit,
          );
          const dueDays = Math.floor(
            (this.startOfDay(nextDue).getTime() - today.getTime()) / 86_400_000,
          );

          if (![1, 3, 7].includes(dueDays) && dueDays >= 0) {
            return;
          }

          const stage = dueDays < 0 ? 'overdue' : `due_in_${dueDays}_days`;
          const dedupeKey = `lubrication:${moduleId}:${stage}:${this.startOfDay(nextDue).toISOString()}`;

          const created =
            await this.notificationCenterService.createIfNotExists({
              dedupeKey,
              type: NotificationType.LUBRICATION_DUE,
              title: `Lubrication reminder for module ${moduleEntity?.module_id || moduleId} (${stage})`,
              machineId: moduleEntity
                ? this.objectIdString(moduleEntity.machine_id) || undefined
                : undefined,
              recipientRole: Role.ADMIN,
            });
          if (created) {
            reminders += 1;
          }
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `[job_lubrication_reminders] item failed: ${this.sanitizedError(error)}`,
          );
        }
      },
    );

    return {
      processed: reminders,
      scanned: latestLogs.length,
      succeeded: reminders,
      failed,
      batches: latestLogs.length ? 1 : 0,
      details: { scannedModules: latestLogs.length, plans: plans.length },
    };
  }

  private async jobSensorMonitoring(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const settings = this.getSchedulerSettings();
    const capteurs = await this.capteurModel
      .find(
        { is_active: true },
        {
          _id: 1,
          capteur_id: 1,
          seuil_avertissement: 1,
          seuil_critique: 1,
          module_id: 1,
        },
      )
      .lean()
      .sort({ _id: 1 })
      .limit(Math.min(settings.batchSize, settings.maxItemsPerRun))
      .exec();

    if (!capteurs.length) {
      return { processed: 0 };
    }

    const capteurObjectIds = capteurs.map((sensor) => sensor._id);

    const latestMeasures = await this.mesureModel
      .aggregate([
        { $match: { capteur_id: { $in: capteurObjectIds } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$capteur_id',
            valeur: { $first: '$valeur' },
            timestamp: { $first: '$timestamp' },
            status: { $first: '$status' },
          },
        },
      ])
      .exec();

    const mesureMap = new Map<string, (typeof latestMeasures)[number]>();
    for (const mesure of latestMeasures) {
      mesureMap.set(this.objectIdString(mesure._id), mesure);
    }

    let alerts = 0;

    let failed = 0;
    await mapWithConcurrency(
      capteurs,
      settings.externalConcurrency,
      async (capteur) => {
        if (context && !context.shouldContinue()) return;
        try {
          const sensorId = this.objectIdString(capteur._id);
          const mesure = mesureMap.get(sensorId);
          if (!mesure) return;

          const warningThreshold =
            typeof capteur.seuil_avertissement === 'number'
              ? capteur.seuil_avertissement
              : undefined;
          const criticalThreshold =
            typeof capteur.seuil_critique === 'number'
              ? capteur.seuil_critique
              : undefined;

          const value = Number(mesure.valeur);
          let level: 'warning' | 'critical' | null = null;

          if (
            typeof criticalThreshold === 'number' &&
            value >= criticalThreshold
          ) {
            level = 'critical';
          } else if (
            typeof warningThreshold === 'number' &&
            value >= warningThreshold
          ) {
            level = 'warning';
          }

          if (!level) {
            return;
          }

          const dedupeKey = `sensor:${sensorId}:${level}:${this.startOfDay(new Date(mesure.timestamp)).toISOString()}`;
          const created =
            await this.notificationCenterService.createIfNotExists({
              dedupeKey,
              type: NotificationType.SENSOR_ALERT,
              title: `Sensor ${capteur.capteur_id} ${level} threshold exceeded (value=${this.telemetryValueLabel(value)})`,
              referenceId: this.objectIdString(capteur.module_id) || undefined,
              recipientRole: Role.ADMIN,
            });
          if (created) {
            alerts += 1;
          }
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `[job_sensor_monitoring] item failed: ${this.sanitizedError(error)}`,
          );
        }
      },
    );

    return {
      processed: alerts,
      scanned: capteurs.length,
      succeeded: alerts,
      failed,
      batches: capteurs.length ? 1 : 0,
      details: { scannedSensors: capteurs.length },
    };
  }

  private async jobRefreshKpis(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const settings = this.getSchedulerSettings();
    let lastId: Types.ObjectId | undefined;
    let refreshed = 0;
    let scanned = 0;
    let failed = 0;
    let batches = 0;

    while (
      (!context || context.shouldContinue()) &&
      scanned < settings.maxItemsPerRun
    ) {
      const remaining = settings.maxItemsPerRun - scanned;
      const filter = lastId ? { _id: { $gt: lastId } } : {};
      const machines = await this.machineModel
        .find(filter, { _id: 1, is_active: 1 })
        .lean()
        .sort({ _id: 1 })
        .limit(Math.min(settings.batchSize, remaining))
        .exec();

      if (!machines.length) break;
      batches += 1;
      scanned += machines.length;
      await mapWithConcurrency(
        machines,
        settings.concurrency,
        async (machine) => {
          if (context && !context.shouldContinue()) return;
          try {
            await this.workOrdersService.updateKpiForMachine(
              this.objectIdString(machine._id),
            );
            refreshed += 1;
          } catch (error) {
            failed += 1;
            this.logger.warn(
              `[job_refresh_kpis] item failed: ${this.sanitizedError(error)}`,
            );
          }
        },
      );
      lastId = machines.at(-1)!._id;
      if (machines.length < settings.batchSize) break;
      if (context && !(await context.heartbeat())) break;
    }

    return {
      processed: refreshed,
      scanned,
      succeeded: refreshed,
      failed,
      batches,
    };
  }

  private async jobDetectDuplicateWorkOrders(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    const settings = this.getSchedulerSettings();
    const aggregation = this.workOrderModel.aggregate([
      {
        $match: {
          status: { $nin: ['completed', 'validated', 'cancelled'] },
          date_start: { $ne: null },
        },
      },
      {
        $project: {
          machine_id: 1,
          module_id: 1,
          plan_id: 1,
          type_maintenance: 1,
          date_key: {
            $dateToString: { format: '%Y-%m-%d', date: '$date_start' },
          },
        },
      },
      {
        $group: {
          _id: {
            machine_id: '$machine_id',
            module_id: '$module_id',
            plan_id: '$plan_id',
            type_maintenance: '$type_maintenance',
            date_key: '$date_key',
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { '_id.date_key': 1 } },
      { $limit: settings.maxItemsPerRun },
    ]);

    let notifications = 0;
    let scanned = 0;
    let failed = 0;

    const cursor = aggregation.cursor({ batchSize: settings.batchSize });
    for await (const group of cursor as AsyncIterable<{
      _id?: Record<string, unknown>;
      count: number;
    }>) {
      if (context && !context.shouldContinue()) break;
      scanned += 1;
      try {
        const dedupeKey = `duplicate:${JSON.stringify(group._id)}`;
        const created = await this.notificationCenterService.createIfNotExists({
          dedupeKey,
          type: NotificationType.DUPLICATE_WORK_ORDER,
          title: `Duplicate work order pattern detected (${group.count} matches)`,
          machineId: this.objectIdString(group._id?.machine_id) || undefined,
          recipientRole: Role.ADMIN,
        });
        if (created) {
          notifications += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `[job_detect_duplicate_workorders] item failed: ${this.sanitizedError(error)}`,
        );
      }
    }

    return {
      processed: scanned,
      scanned,
      succeeded: scanned - failed,
      failed,
      batches: Math.ceil(scanned / settings.batchSize),
      details: { notifications },
    };
  }

  private async jobCalendarSynchronization(
    context?: SchedulerJobContext,
  ): Promise<JobWorkResult> {
    // Smart calendar is generated directly from WorkOrder data.
    // Synchronization means normalizing WorkOrder lifecycle fields to keep calendar views accurate.
    const now = new Date();

    const settings = this.getSchedulerSettings();
    const completedWithoutCloseDate = await this.workOrderModel
      .find(
        {
          status: { $in: ['completed', 'validated'] },
          date_closed: { $exists: false },
        },
        { _id: 1, date_end: 1 },
      )
      .lean()
      .sort({ _id: 1 })
      .limit(Math.min(settings.batchSize, settings.maxItemsPerRun))
      .exec();

    let updated = 0;
    for (const row of completedWithoutCloseDate) {
      if (context && !context.shouldContinue()) break;
      await this.workOrderModel
        .findByIdAndUpdate(row._id, {
          date_closed: row.date_end || now,
        })
        .exec();
      updated += 1;
    }

    const duplicateSummary = await this.jobDetectDuplicateWorkOrders();

    return {
      processed: updated,
      scanned: completedWithoutCloseDate.length,
      succeeded: updated,
      failed: duplicateSummary.failed,
      batches: completedWithoutCloseDate.length ? 1 : 0,
      details: {
        completedRowsPatched: updated,
        duplicateGroups: duplicateSummary.processed,
      },
    };
  }

  /**
   * Resolves who a scheduler-detected event should notify: a concrete user
   * when one can be identified (e.g. the work order's assigned technician),
   * falling back to a broadcast to every Admin when no specific individual
   * is resolvable (e.g. stock/sensor alerts with no assignee).
   */
  private resolveRecipient(candidateUserId: string): {
    recipientUserId?: string;
    recipientRole?: Role;
  } {
    if (candidateUserId && Types.ObjectId.isValid(candidateUserId)) {
      return { recipientUserId: candidateUserId };
    }
    return { recipientRole: Role.ADMIN };
  }

  private resolveJobFinalStatus(
    result: JobWorkResult,
    context: SchedulerJobContext,
  ): SchedulerJobResult['status'] {
    if (!context.shouldContinue()) {
      return 'timed_out';
    }
    if (result.failed && result.succeeded) {
      return 'partial';
    }
    if (result.failed && !result.succeeded) {
      return 'failed';
    }
    return 'completed';
  }

  private startOfDay(value: Date) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private telemetryValueLabel(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return JSON.stringify(value) ?? '';
  }

  private objectIdString(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'object' && value !== null && '_id' in value) {
      return this.objectIdString((value as { _id?: unknown })._id);
    }
    return '';
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

  private normalizeFrequencyUnit(value?: string): string {
    const unit = (value || '').toLowerCase().replace(/\s+/g, '_');

    if (!unit) return 'monthly';
    if (unit.includes('jour') || unit.includes('day') || unit === 'd')
      return 'daily';
    if (
      unit.includes('week') ||
      unit.includes('semaine') ||
      unit.includes('w')
    ) {
      return 'weekly';
    }
    if (unit.includes('3') && unit.includes('month')) return 'quarterly';
    if (unit.includes('6') && unit.includes('month')) return 'semiannual';
    if (unit.includes('year') || unit.includes('an') || unit.includes('ann'))
      return 'yearly';
    if (unit.includes('month') || unit.includes('mois') || unit === 'm')
      return 'monthly';
    return 'monthly';
  }

  private computeNextDueDate(
    fromDate: Date,
    frequency?: number,
    unit?: string,
  ): Date {
    const base = new Date(fromDate);
    const value = frequency && frequency > 0 ? frequency : 1;
    const normalized = this.normalizeFrequencyUnit(unit);

    if (normalized === 'daily') {
      base.setDate(base.getDate() + value);
      return base;
    }
    if (normalized === 'weekly') {
      base.setDate(base.getDate() + value * 7);
      return base;
    }
    if (normalized === 'monthly') {
      base.setMonth(base.getMonth() + value);
      return base;
    }
    if (normalized === 'quarterly') {
      base.setMonth(base.getMonth() + 3 * value);
      return base;
    }
    if (normalized === 'semiannual') {
      base.setMonth(base.getMonth() + 6 * value);
      return base;
    }

    base.setFullYear(base.getFullYear() + value);
    return base;
  }
}
