import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { User, UserDocument } from '../schemas/user.schema';
import {
  CLOSED_WORK_ORDER_STATUSES,
  COMPLETED_WORK_ORDER_STATUSES,
  WAITING_VALIDATION_STATUS,
} from '../common/work-order-status';
import { NOT_CORRECTIVE_TYPE_FILTER } from '../common/maintenance-type';
import * as businessTime from '../common/business-time';

export interface WorkOrderStatusCounts {
  overdueCount: number;
  dueTodayCount: number;
  waitingValidationCount: number;
  completedTodayCount: number;
  totalCount: number;
}

export interface StockAlertItem {
  stockId: string;
  stockCode: string;
  partId?: string;
  partLabel?: string;
  quantiteEnStock: number;
  quantiteReservee: number;
  available: number;
  threshold: number;
}

export interface StockAlertsResult {
  count: number;
  items: StockAlertItem[];
}

export interface PreventiveComplianceResult {
  ratePercent: number;
  onTimeCount: number;
  evaluableCount: number;
}

export interface CorrectiveResponseTimeResult {
  averageResponseHours: number;
  sampleSize: number;
}

export interface MttrMtbfResult {
  mttrHours: number;
  mtbfHours: number;
  availabilityPercent: number;
  sampleSize: number;
}

export interface WorkloadEntry {
  technicianId: string;
  name: string;
  openCount: number;
}

export interface WorkOrderScopeFilter {
  technicianId?: string;
  machineIds?: string[];
  /**
   * Bounds every scoped computation to work orders *created* within
   * [dateFrom, dateTo) — added for the Reports module's date-ranged
   * exports (e.g. "MTTR/MTBF trends" buckets one month at a time) without
   * duplicating any of this file's math elsewhere. Deliberately keyed off
   * `date_created` uniformly rather than each method's own "relevant"
   * date (completion for compliance/MTTR, response for corrective time)
   * — simpler to reason about as "work orders opened in this period",
   * consistent across every metric, at the cost of a closed/MTTR event
   * that happened just after the window not counting toward it.
   */
  dateFrom?: Date;
  dateTo?: Date;
}

interface FacetCountRow {
  count: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toObjectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}

function extractFacetCount(rows: FacetCountRow[] | undefined): number {
  return rows?.[0]?.count ?? 0;
}

/**
 * The single place every dashboard/KPI number in the app is computed —
 * Admin, Technician, and Operator dashboards all call into this service
 * rather than each re-deriving their own counts from raw `countDocuments`
 * calls or client-side list filtering. Every date boundary here goes
 * through `common/business-time.ts`, so "today"/"this month"/overdue mean
 * exactly the same instant everywhere they're shown, regardless of which
 * role's dashboard is asking or what timezone the server host happens to
 * be running in.
 */
const ADMIN_DASHBOARD_CACHE_KEY = 'kpi:admin-dashboard';
const ADMIN_DASHBOARD_CACHE_TTL_MS = 30_000;

@Injectable()
export class KpiService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Stock.name)
    private readonly stockModel: Model<StockDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private toMongoFilter(
    scope: WorkOrderScopeFilter = {},
  ): FilterQuery<WorkOrderDocument> {
    const filter: FilterQuery<WorkOrderDocument> = {};
    if (scope.technicianId) {
      filter.technician_id = toObjectId(scope.technicianId);
    }
    if (scope.machineIds) {
      filter.machine_id = { $in: scope.machineIds.map(toObjectId) };
    }
    if (scope.dateFrom || scope.dateTo) {
      filter.date_created = {
        ...(scope.dateFrom ? { $gte: scope.dateFrom } : {}),
        ...(scope.dateTo ? { $lt: scope.dateTo } : {}),
      };
    }
    return filter;
  }

  /**
   * The four status-derived counters named across every dashboard —
   * overdue, due today, waiting validation, and completed today — computed
   * in a single aggregation so all four numbers reflect the exact same
   * database snapshot, rather than four sequential queries that could each
   * see a slightly different state if data changes mid-request.
   */
  async computeWorkOrderStatusCounts(
    scope: WorkOrderScopeFilter = {},
  ): Promise<WorkOrderStatusCounts> {
    const now = new Date();
    const todayStart = businessTime.startOfBusinessDay(now);
    const todayEnd = businessTime.addBusinessDays(todayStart, 1);

    const dueDateExpr = {
      $ifNull: [
        '$due_date',
        {
          $ifNull: [
            '$scheduled_date',
            { $ifNull: ['$execution_date', '$date_start'] },
          ],
        },
      ],
    };
    const closedAtExpr = { $ifNull: ['$date_closed', '$date_end'] };

    const match = this.toMongoFilter(scope);

    const [result] = await this.workOrderModel
      .aggregate<{
        overdue: FacetCountRow[];
        dueToday: FacetCountRow[];
        waitingValidation: FacetCountRow[];
        completedToday: FacetCountRow[];
        total: FacetCountRow[];
      }>([
        { $match: match },
        {
          $facet: {
            overdue: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $ne: [dueDateExpr, null] },
                      { $lt: [dueDateExpr, todayStart] },
                      {
                        $not: { $in: ['$status', CLOSED_WORK_ORDER_STATUSES] },
                      },
                      { $ne: ['$status', WAITING_VALIDATION_STATUS] },
                    ],
                  },
                },
              },
              { $count: 'count' },
            ],
            dueToday: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $ne: [dueDateExpr, null] },
                      { $gte: [dueDateExpr, todayStart] },
                      { $lt: [dueDateExpr, todayEnd] },
                      {
                        $not: { $in: ['$status', CLOSED_WORK_ORDER_STATUSES] },
                      },
                      { $ne: ['$status', WAITING_VALIDATION_STATUS] },
                    ],
                  },
                },
              },
              { $count: 'count' },
            ],
            waitingValidation: [
              { $match: { status: WAITING_VALIDATION_STATUS } },
              { $count: 'count' },
            ],
            completedToday: [
              {
                $match: {
                  status: { $in: COMPLETED_WORK_ORDER_STATUSES },
                  $expr: {
                    $and: [
                      { $ne: [closedAtExpr, null] },
                      { $gte: [closedAtExpr, todayStart] },
                      { $lt: [closedAtExpr, todayEnd] },
                    ],
                  },
                },
              },
              { $count: 'count' },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    return {
      overdueCount: extractFacetCount(result?.overdue),
      dueTodayCount: extractFacetCount(result?.dueToday),
      waitingValidationCount: extractFacetCount(result?.waitingValidation),
      completedTodayCount: extractFacetCount(result?.completedToday),
      totalCount: extractFacetCount(result?.total),
    };
  }

  /**
   * A stock is alerting when what's actually free to use — stock on hand
   * minus whatever is already held against approved part requests — falls
   * to or below its configured threshold. Neither of the two ad hoc
   * implementations this replaced (`WorkOrdersService.stockAlertCount`,
   * the automation scheduler's stock-monitoring job) accounted for
   * reservations; both alerted (or failed to alert) purely on raw
   * on-hand quantity.
   */
  async computeStockAlerts(): Promise<StockAlertsResult> {
    const stocks = await this.stockModel
      .find()
      .populate('part_id')
      .lean()
      .exec();

    const items: StockAlertItem[] = [];
    for (const stock of stocks) {
      const threshold =
        typeof stock.seuil_alerte_stock === 'number'
          ? stock.seuil_alerte_stock
          : stock.quantite_minimale;
      if (typeof threshold !== 'number') continue;

      const quantiteReservee = stock.quantite_reservee ?? 0;
      const available = (stock.quantite_en_stock ?? 0) - quantiteReservee;
      if (available > threshold) continue;

      const part = stock.part_id as unknown as
        | { _id?: Types.ObjectId; nom_piece?: string; part_id?: string }
        | Types.ObjectId
        | undefined;
      const partIsPopulated = Boolean(
        part && typeof part === 'object' && 'nom_piece' in part,
      );
      const populatedPart = partIsPopulated
        ? (part as {
            _id?: Types.ObjectId;
            nom_piece?: string;
            part_id?: string;
          })
        : null;

      items.push({
        stockId: String(stock._id),
        stockCode: stock.stock_id,
        partId: stockPartId(part, populatedPart),
        partLabel: populatedPart
          ? (populatedPart.nom_piece ?? populatedPart.part_id)
          : undefined,
        quantiteEnStock: stock.quantite_en_stock ?? 0,
        quantiteReservee,
        available,
        threshold,
      });
    }

    return { count: items.length, items };
  }

  /**
   * Fraction of completed/validated preventive, lubrication, or inspection
   * work orders (any non-corrective, scheduled-maintenance type) whose
   * completion timestamp (`date_closed`/`date_end`) was at or before their
   * own due date — i.e. maintenance that actually happened on schedule.
   * Orders with no resolvable due date or completion timestamp are
   * excluded from both the numerator and denominator (not counted as
   * either compliant or non-compliant), since there's nothing to compare.
   */
  async computePreventiveCompliance(
    scope: WorkOrderScopeFilter = {},
  ): Promise<PreventiveComplianceResult> {
    const match: FilterQuery<WorkOrderDocument> = {
      ...this.toMongoFilter(scope),
      ...NOT_CORRECTIVE_TYPE_FILTER,
      status: { $in: COMPLETED_WORK_ORDER_STATUSES },
    };

    const orders = await this.workOrderModel
      .find(match, {
        due_date: 1,
        scheduled_date: 1,
        execution_date: 1,
        date_start: 1,
        date_closed: 1,
        date_end: 1,
      })
      .lean()
      .exec();

    let onTimeCount = 0;
    let evaluableCount = 0;
    for (const order of orders) {
      const due =
        order.due_date ||
        order.scheduled_date ||
        order.execution_date ||
        order.date_start;
      const closed = order.date_closed || order.date_end;
      if (!due || !closed) continue;
      evaluableCount += 1;
      if (new Date(closed).getTime() <= new Date(due).getTime()) {
        onTimeCount += 1;
      }
    }

    const ratePercent =
      evaluableCount > 0 ? round2((onTimeCount / evaluableCount) * 100) : 0;
    return { ratePercent, onTimeCount, evaluableCount };
  }

  /**
   * Average time between a corrective work order being raised
   * (`date_created`) and work actually starting on it (`date_start`) — the
   * "time to first response", distinct from MTTR (which measures total
   * repair duration through to completion).
   */
  async computeCorrectiveResponseTime(
    scope: WorkOrderScopeFilter = {},
  ): Promise<CorrectiveResponseTimeResult> {
    const match: FilterQuery<WorkOrderDocument> = {
      ...this.toMongoFilter(scope),
      type_maintenance: { $regex: /correct/i },
      date_start: { $exists: true, $ne: null },
    };

    const orders = await this.workOrderModel
      .find(match, { date_created: 1, date_start: 1 })
      .lean()
      .exec();

    const hours = orders
      .map((order) => {
        if (!order.date_start || !order.date_created) return null;
        const diff =
          new Date(order.date_start).getTime() -
          new Date(order.date_created).getTime();
        return diff / 3_600_000;
      })
      .filter((value): value is number => value !== null && value >= 0);

    const averageResponseHours =
      hours.length > 0
        ? round2(hours.reduce((sum, value) => sum + value, 0) / hours.length)
        : 0;

    return { averageResponseHours, sampleSize: hours.length };
  }

  /**
   * MTTR (mean time to repair) is the average duration, in hours, that
   * completed work orders were open (`date_start`/`date_created` through
   * `date_end`/`date_closed`). MTBF (mean time between failures) is the
   * average gap between consecutive *corrective* closures — it needs at
   * least two corrective closures to mean anything, and is 0 otherwise.
   * Availability follows the standard `MTBF / (MTBF + MTTR)` formula,
   * defaulting to 100% when there's no failure history yet to measure.
   * This mirrors the formula `WorkOrdersService.updateKpiForMachine` wrote
   * into the legacy per-machine `KPI` snapshot collection, but computed
   * fresh from the current WorkOrder collection at request time instead of
   * from a stale, write-triggered snapshot.
   */
  async computeMttrMtbf(
    scope: WorkOrderScopeFilter = {},
  ): Promise<MttrMtbfResult> {
    const match: FilterQuery<WorkOrderDocument> = {
      ...this.toMongoFilter(scope),
      status: { $in: COMPLETED_WORK_ORDER_STATUSES },
    };

    const orders = await this.workOrderModel
      .find(match, {
        date_created: 1,
        date_start: 1,
        date_end: 1,
        date_closed: 1,
        type_maintenance: 1,
      })
      .sort({ date_closed: 1, date_end: 1 })
      .lean()
      .exec();

    const repairDurations = orders
      .map((order) => {
        const start = order.date_start || order.date_created;
        const end = order.date_end || order.date_closed;
        if (!start || !end) return null;
        const diff = new Date(end).getTime() - new Date(start).getTime();
        return diff / 3_600_000;
      })
      .filter((value): value is number => value !== null && value >= 0);
    const mttrHours =
      repairDurations.length > 0
        ? repairDurations.reduce((sum, value) => sum + value, 0) /
          repairDurations.length
        : 0;

    const correctiveClosures = orders
      .filter((order) => /correct/i.test(order.type_maintenance || ''))
      .map((order) => {
        const closed = order.date_closed || order.date_end;
        return closed ? new Date(closed).getTime() : null;
      })
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    let mtbfHours = 0;
    if (correctiveClosures.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < correctiveClosures.length; i += 1) {
        gaps.push(
          (correctiveClosures[i] - correctiveClosures[i - 1]) / 3_600_000,
        );
      }
      mtbfHours = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    }

    // Availability is only meaningful once MTBF itself is: with fewer than
    // two corrective closures there is no failure-frequency signal yet, so
    // defaulting to 100% (rather than treating "no MTBF data" the same as
    // "instantaneous repeat failures") avoids reporting a misleadingly low
    // number off a single data point.
    const availabilityPercent =
      mtbfHours > 0 ? (mtbfHours / (mtbfHours + mttrHours)) * 100 : 100;

    return {
      mttrHours: round2(mttrHours),
      mtbfHours: round2(mtbfHours),
      availabilityPercent: round2(availabilityPercent),
      sampleSize: repairDurations.length,
    };
  }

  /**
   * Current open-order load per technician, for fleet-wide balancing on
   * the Admin dashboard — this metric is inherently fleet-wide (there is
   * no per-technician or per-operator "workload distribution across
   * everyone else" view for those roles).
   */
  async computeWorkload(): Promise<WorkloadEntry[]> {
    const rows = await this.workOrderModel
      .aggregate<{ _id: string; openCount: number }>([
        {
          $match: {
            status: { $nin: CLOSED_WORK_ORDER_STATUSES },
            technician_id: { $exists: true, $ne: null },
          },
        },
        // Grouping on the raw field would split one technician across two
        // buckets if any of their work orders have technician_id stored as
        // a string instead of an ObjectId (legacy data) — $toString
        // normalizes both representations onto the same group key so the
        // dashboard never renders two rows (and two React keys) for the
        // same technician.
        {
          $group: {
            _id: { $toString: '$technician_id' },
            openCount: { $sum: 1 },
          },
        },
        { $sort: { openCount: -1 } },
      ])
      .exec();

    if (rows.length === 0) return [];

    const users = await this.userModel
      .find(
        { _id: { $in: rows.map((row) => toObjectId(row._id)) } },
        { nom_complet: 1, user_id: 1 },
      )
      .lean()
      .exec();
    const userById = new Map(users.map((user) => [String(user._id), user]));

    return rows.map((row) => {
      const user = userById.get(row._id);
      return {
        technicianId: row._id,
        name: user?.nom_complet || user?.user_id || 'Unknown',
        openCount: row.openCount,
      };
    });
  }

  /**
   * `computeAdminDashboard()` below runs ten queries/aggregations across
   * four collections on every call, with no per-caller variance (same
   * result for every Admin) — so a short TTL cache here turns N concurrent
   * dashboard loads into one real computation instead of N. This is the
   * audit's flagged hot path; `WorkOrderDashboardQueryService` also calls
   * this directly, so caching here benefits that call site too, not just
   * this controller.
   */
  async getAdminDashboard() {
    const cached = await this.cache.get<
      Awaited<ReturnType<KpiService['computeAdminDashboard']>>
    >(ADMIN_DASHBOARD_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const result = await this.computeAdminDashboard();
    await this.cache.set(
      ADMIN_DASHBOARD_CACHE_KEY,
      result,
      ADMIN_DASHBOARD_CACHE_TTL_MS,
    );
    return result;
  }

  /**
   * Everything the Admin dashboard shows: fleet-wide work order status
   * counts and month-over-month volume, stock alerts, preventive
   * compliance, corrective response time, MTTR/MTBF/availability,
   * per-technician workload, and machine/user totals — all computed
   * fresh, all in parallel.
   */
  private async computeAdminDashboard() {
    const now = new Date();
    const monthStart = businessTime.startOfBusinessMonth(now);
    const lastMonthStart = businessTime.addBusinessMonths(monthStart, -1);
    const nextMonthStart = businessTime.addBusinessMonths(monthStart, 1);

    const [
      statusCounts,
      currentMonthCount,
      lastMonthCount,
      stockAlerts,
      preventiveCompliance,
      correctiveResponseTime,
      mttrMtbf,
      workload,
      totalMachines,
      totalUsers,
    ] = await Promise.all([
      this.computeWorkOrderStatusCounts(),
      this.workOrderModel
        .countDocuments({
          date_created: { $gte: monthStart, $lt: nextMonthStart },
        })
        .exec(),
      this.workOrderModel
        .countDocuments({
          date_created: { $gte: lastMonthStart, $lt: monthStart },
        })
        .exec(),
      this.computeStockAlerts(),
      this.computePreventiveCompliance(),
      this.computeCorrectiveResponseTime(),
      this.computeMttrMtbf(),
      this.computeWorkload(),
      this.machineModel.countDocuments().exec(),
      this.userModel.countDocuments().exec(),
    ]);

    const percentageChange =
      lastMonthCount > 0
        ? round2(((currentMonthCount - lastMonthCount) / lastMonthCount) * 100)
        : 0;

    return {
      workOrders: {
        ...statusCounts,
        currentMonthCount,
        lastMonthCount,
        percentageChange,
      },
      stockAlerts,
      preventiveCompliance,
      correctiveResponseTime,
      mttrMtbf,
      workload,
      totals: { machines: totalMachines, users: totalUsers },
      businessTimezone: businessTime.getBusinessTimezone(),
      generatedAt: now.toISOString(),
    };
  }

  /**
   * The Technician dashboard's KPI-card portion (status counts scoped to
   * their own assigned work orders) — `TechnicianService.dashboard()`
   * merges this into its richer response (which also includes task lists
   * and manuals, outside this service's concern).
   */
  async getTechnicianDashboardCounts(
    technicianId: string,
  ): Promise<WorkOrderStatusCounts> {
    return this.computeWorkOrderStatusCounts({ technicianId });
  }

  /**
   * Everything the Operator dashboard shows: status counts scoped to the
   * operator's own work orders (self-reported corrective issues use the
   * same `technician_id` assignment field operators are scoped by
   * elsewhere in the app), plus simple in-progress/completed counters for
   * the summary cards. No stock/MTTR/workload here — those are
   * fleet-management concerns outside an Operator's permissions.
   */
  async getOperatorDashboard(operatorId: string) {
    const scope = { technicianId: operatorId };
    const filter = this.toMongoFilter(scope);

    const [statusCounts, assignedCount, inProgressCount, completedCount] =
      await Promise.all([
        this.computeWorkOrderStatusCounts(scope),
        this.workOrderModel
          .countDocuments({
            ...filter,
            status: { $nin: CLOSED_WORK_ORDER_STATUSES },
          })
          .exec(),
        this.workOrderModel
          .countDocuments({ ...filter, status: 'in_progress' })
          .exec(),
        this.workOrderModel
          .countDocuments({
            ...filter,
            status: { $in: COMPLETED_WORK_ORDER_STATUSES },
          })
          .exec(),
      ]);

    return {
      ...statusCounts,
      assignedCount,
      inProgressCount,
      completedCount,
      generatedAt: new Date().toISOString(),
    };
  }
}

function stockPartId(
  part:
    | { _id?: Types.ObjectId; nom_piece?: string; part_id?: string }
    | Types.ObjectId
    | undefined,
  populatedPart: { _id?: Types.ObjectId } | null,
): string | undefined {
  if (populatedPart) return populatedPart._id?.toHexString();
  if (part instanceof Types.ObjectId) return part.toHexString();
  return undefined;
}
