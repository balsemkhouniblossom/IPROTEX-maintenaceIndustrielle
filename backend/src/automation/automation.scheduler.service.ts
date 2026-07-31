/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
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

interface JobResult {
  processed: number;
  details?: Record<string, unknown>;
}

@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private readonly schedulerInstanceId = `${process.pid}-${Math.random()
    .toString(36)
    .slice(2)}`;

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
        () => this.jobGeneratePreventiveMaintenance(),
      ],
      ['job_mark_overdue_maintenance', () => this.jobMarkOverdueMaintenance()],
      ['job_refresh_kpis', () => this.jobRefreshKpis()],
      [
        'job_detect_duplicate_workorders',
        () => this.jobDetectDuplicateWorkOrders(),
      ],
      ['job_calendar_synchronization', () => this.jobCalendarSynchronization()],
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
        () => this.jobUpcomingMaintenanceReminders(),
      ],
      ['job_overdue_escalation', () => this.jobOverdueEscalation()],
      ['job_stock_monitoring', () => this.jobStockMonitoring()],
      ['job_lubrication_reminders', () => this.jobLubricationReminders()],
    ]);
  }

  @Cron('*/10 * * * *', {
    name: 'automation-10min',
    timeZone: process.env.AUTOMATION_TIMEZONE || 'UTC',
  })
  async runTenMinuteJobs() {
    await this.executeBatch('10min', [
      ['job_sensor_monitoring', () => this.jobSensorMonitoring()],
      ['job_mark_overdue_maintenance', () => this.jobMarkOverdueMaintenance()],
    ]);
  }

  private async executeBatch(
    label: string,
    jobs: Array<[string, () => Promise<JobResult>]>,
  ) {
    this.logger.log(`Scheduler batch started: ${label}`);

    for (const [name, job] of jobs) {
      await this.runJob(name, job);
    }

    this.logger.log(`Scheduler batch finished: ${label}`);
  }

  private async runJob(name: string, job: () => Promise<JobResult>) {
    const startedAt = Date.now();
    const lock = await this.acquireJobLock(name);
    if (!lock) {
      this.logger.warn(`[${name}] skipped because another scheduler owns the lock`);
      return;
    }

    this.logger.log(`[${name}] start`);

    try {
      const result = await job();
      const duration = Date.now() - startedAt;
      this.logger.log(
        `[${name}] finish duration_ms=${duration} processed=${result.processed}`,
      );
      if (result.details) {
        this.logger.debug(
          `[${name}] details=${JSON.stringify(result.details)}`,
        );
      }
    } catch (error) {
      const duration = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[${name}] failed duration_ms=${duration} error=${message}`,
      );
    } finally {
      await this.releaseJobLock(name, lock.owner);
    }
  }

  private async acquireJobLock(
    name: string,
    leaseMs = 15 * 60 * 1000,
  ): Promise<{ owner: string } | null> {
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
              expires_at: expiresAt,
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

      return lock?.owner === owner ? { owner } : null;
    } catch (error: unknown) {
      if ((error as { code?: number })?.code === 11000) {
        return null;
      }
      throw error;
    }
  }

  private async releaseJobLock(name: string, owner: string): Promise<void> {
    await this.automationJobLockModel
      .deleteOne({ name, owner })
      .exec();
  }

  private async jobGeneratePreventiveMaintenance(): Promise<JobResult> {
    const summary =
      await this.workOrdersService.triggerScheduler('cron_nightly');
    return {
      processed:
        Number(summary.createdFirstExecution || 0) +
        Number(summary.createdNextExecution || 0),
      details: summary,
    };
  }

  private async jobUpcomingMaintenanceReminders(): Promise<JobResult> {
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
      .exec();

    let notifications = 0;

    for (const row of rows) {
      const dueSource = row.due_date || row.scheduled_date || row.date_start;
      if (!dueSource) continue;
      const dueDate = this.startOfDay(new Date(dueSource));
      const days = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
      if (![1, 3, 7].includes(days)) {
        continue;
      }

      const workOrderId = this.objectIdString(row._id);
      const dedupeKey = `upcoming:${workOrderId}:${days}:${today.toISOString()}`;
      const created = await this.notificationCenterService.createIfNotExists({
        dedupeKey,
        type: NotificationType.PREVENTIVE_DUE,
        title: `Upcoming maintenance in ${days} day(s) for ${row.ot_id || workOrderId}`,
        workOrderId,
        machineId: this.objectIdString(row.machine_id) || undefined,
        ...this.resolveRecipient(this.objectIdString(row.technician_id)),
      });
      if (created) {
        notifications += 1;
      }
    }

    return { processed: notifications, details: { scanned: rows.length } };
  }

  private async jobMarkOverdueMaintenance(): Promise<JobResult> {
    const now = new Date();

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
      .limit(1000)
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
    for (const row of overdueRows) {
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
    }

    return {
      processed: Number(updateResult.modifiedCount || 0),
      details: {
        scanned: overdueRows.length,
        notifications,
      },
    };
  }

  private async jobOverdueEscalation(): Promise<JobResult> {
    const now = new Date();
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
      .limit(1000)
      .exec();

    const supervisors = await this.userModel
      .find(
        { role: { $in: ['admin', 'supervisor'] } },
        { _id: 1, nom_complet: 1 },
      )
      .lean()
      .exec();

    let notifications = 0;

    for (const row of overdueRows) {
      const dueSource = row.due_date || row.scheduled_date || row.date_start;
      if (!dueSource) continue;
      const due = new Date(dueSource);
      const overdueDays = Math.floor(
        (now.getTime() - due.getTime()) / 86400000,
      );
      const workOrderId = this.objectIdString(row._id);

      if (overdueDays >= 3) {
        const dedupeKey = `escalation:tech:${workOrderId}:${Math.floor(overdueDays / 3)}`;
        const created = await this.notificationCenterService.createIfNotExists({
          dedupeKey,
          type: NotificationType.OVERDUE_ESCALATION,
          title: `Escalation 3+ days overdue for ${row.ot_id || workOrderId}`,
          workOrderId,
          ...this.resolveRecipient(this.objectIdString(row.technician_id)),
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
          const created = await this.notificationCenterService.createIfNotExists({
            dedupeKey,
            type: NotificationType.OVERDUE_ESCALATION,
            title: `Escalation 7+ days overdue for ${row.ot_id || workOrderId}`,
            workOrderId,
            recipientUserId: supervisorId,
          });
          if (created) {
            notifications += 1;
          }
        }
      }
    }

    return {
      processed: notifications,
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
  private async jobStockMonitoring(): Promise<JobResult> {
    const { items } = await this.kpiService.computeStockAlerts();

    let alerts = 0;
    for (const item of items) {
      const created = await this.notificationCenterService.createIfNotExists({
        dedupeKey: `stock_alert:${item.stockId}:${item.available}`,
        type: NotificationType.STOCK_ALERT,
        title: `Stock alert for ${item.stockCode}: available ${item.available} <= threshold ${item.threshold}`,
        referenceId: item.partId,
        recipientRole: Role.ADMIN,
      });
      if (created) {
        alerts += 1;
      }
    }

    return { processed: alerts, details: { scanned: items.length } };
  }

  private async jobLubricationReminders(): Promise<JobResult> {
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

    for (const entry of latestLogs) {
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
        (this.startOfDay(nextDue).getTime() - today.getTime()) / 86400000,
      );

      if (![1, 3, 7].includes(dueDays) && dueDays >= 0) {
        continue;
      }

      const stage = dueDays < 0 ? 'overdue' : `due_in_${dueDays}_days`;
      const dedupeKey = `lubrication:${moduleId}:${stage}:${this.startOfDay(nextDue).toISOString()}`;

      const created = await this.notificationCenterService.createIfNotExists({
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
    }

    return {
      processed: reminders,
      details: { scannedModules: latestLogs.length, plans: plans.length },
    };
  }

  private async jobSensorMonitoring(): Promise<JobResult> {
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

    for (const capteur of capteurs) {
      const sensorId = this.objectIdString(capteur._id);
      const mesure = mesureMap.get(sensorId);
      if (!mesure) continue;

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

      if (typeof criticalThreshold === 'number' && value >= criticalThreshold) {
        level = 'critical';
      } else if (
        typeof warningThreshold === 'number' &&
        value >= warningThreshold
      ) {
        level = 'warning';
      }

      if (!level) {
        continue;
      }

      const dedupeKey = `sensor:${sensorId}:${level}:${this.startOfDay(new Date(mesure.timestamp)).toISOString()}`;
      const created = await this.notificationCenterService.createIfNotExists({
        dedupeKey,
        type: NotificationType.SENSOR_ALERT,
        title: `Sensor ${capteur.capteur_id} ${level} threshold exceeded (value=${value})`,
        referenceId: this.objectIdString(capteur.module_id) || undefined,
        recipientRole: Role.ADMIN,
      });
      if (created) {
        alerts += 1;
      }
    }

    return { processed: alerts, details: { scannedSensors: capteurs.length } };
  }

  private async jobRefreshKpis(): Promise<JobResult> {
    const machines = await this.machineModel.find({}, { _id: 1 }).lean().exec();

    let refreshed = 0;
    for (const machine of machines) {
      await this.workOrdersService.updateKpiForMachine(
        this.objectIdString(machine._id),
      );
      refreshed += 1;
    }

    return { processed: refreshed };
  }

  private async jobDetectDuplicateWorkOrders(): Promise<JobResult> {
    const duplicateGroups = await this.workOrderModel
      .aggregate([
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
      ])
      .exec();

    let notifications = 0;

    for (const group of duplicateGroups) {
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
    }

    return {
      processed: duplicateGroups.length,
      details: { notifications },
    };
  }

  private async jobCalendarSynchronization(): Promise<JobResult> {
    // Smart calendar is generated directly from WorkOrder data.
    // Synchronization means normalizing WorkOrder lifecycle fields to keep calendar views accurate.
    const now = new Date();

    const completedWithoutCloseDate = await this.workOrderModel
      .find(
        {
          status: { $in: ['completed', 'validated'] },
          date_closed: { $exists: false },
        },
        { _id: 1, date_end: 1 },
      )
      .lean()
      .limit(2000)
      .exec();

    let updated = 0;
    for (const row of completedWithoutCloseDate) {
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
  private resolveRecipient(
    candidateUserId: string,
  ): { recipientUserId?: string; recipientRole?: Role } {
    if (candidateUserId && Types.ObjectId.isValid(candidateUserId)) {
      return { recipientUserId: candidateUserId };
    }
    return { recipientRole: Role.ADMIN };
  }

  private startOfDay(value: Date) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private objectIdString(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toString();
    if (typeof value === 'object' && value !== null && '_id' in value) {
      return this.objectIdString((value as { _id?: unknown })._id);
    }
    return '';
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
