import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Telemetry, TelemetryDocument } from '../schemas/telemetry.schema';
import {
  FaultEvent,
  FaultEventDocument,
  FaultEventSeverity,
} from '../schemas/fault-event.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
  MaintenancePlanStatus,
} from '../schemas/maintenance-plan.schema';
import { FEATURE_NAMES } from './prediction-model.interface';

const TELEMETRY_WINDOW_DAYS = 7;
const FAULT_WINDOW_DAYS = 30;
const WORK_ORDER_WINDOW_DAYS = 90;
const INTERVENTION_WINDOW_DAYS = 180;
const NO_RECENT_INTERVENTION_SENTINEL_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FeatureExtractionResult = {
  features: number[];
  measuredFacts: string[];
  /**
   * True when literally none of the underlying sources (telemetry, alarms,
   * work orders, maintenance plans, interventions) had any data as of this
   * checkpoint — i.e. every feature is 0 except `days_since_last_intervention`
   * sitting at its "unknown" sentinel, which is never 0 by design (0 would
   * wrongly claim an intervention happened right at `asOfDate`). Callers
   * building a training set should drop these: a vector that's really just
   * "no data was available" would otherwise get pooled in as if it were a
   * genuine "everything nominal" observation.
   */
  isEmpty: boolean;
};

function daysBefore(date: Date, days: number): Date {
  return new Date(date.getTime() - days * DAY_MS);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Turns a machine's raw operational history — telemetry, fault events,
 * work orders, intervention reports, and maintenance plans — into the
 * fixed-length numeric vector every prediction model trains and scores
 * against (`FEATURE_NAMES` in `prediction-model.interface.ts`), plus a
 * list of plain-language measured facts for the explanation returned
 * alongside a prediction. `asOfDate` makes this replayable for training:
 * calling it with a past date computes the vector using only data that
 * existed up to that point, which is how `TrainingSampleService` builds a
 * historical training set out of a single machine's timeline.
 *
 * Caveat inherent to the `asOfDate` replay: `overdue_work_order_count`
 * reflects each WorkOrder's *current* stored `status`, not necessarily
 * what it was at `asOfDate` (status isn't versioned) — for live inference
 * (`asOfDate = now`) this is exact; for historical training checkpoints
 * it's an approximation, which is why every model's `confidence` also
 * factors in `training_sample_count` rather than trusting any single
 * sample fully.
 */
@Injectable()
export class FeatureExtractionService {
  constructor(
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
    @InjectModel(FaultEvent.name)
    private readonly faultEventModel: Model<FaultEventDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
  ) {}

  async buildFeatureVector(
    machineId: string,
    asOfDate: Date,
  ): Promise<FeatureExtractionResult> {
    const machineObjectId = new Types.ObjectId(machineId);

    const [
      telemetryFeatures,
      alarmFeatures,
      workOrderFeatures,
      planCount,
      interventionFeatures,
    ] = await Promise.all([
      this.extractTelemetryFeatures(machineObjectId, asOfDate),
      this.extractAlarmFeatures(machineObjectId, asOfDate),
      this.extractWorkOrderFeatures(machineObjectId, asOfDate),
      this.extractActiveMaintenancePlanCount(machineObjectId),
      this.extractInterventionFeatures(machineObjectId, asOfDate),
    ]);

    const featureMap: Record<(typeof FEATURE_NAMES)[number], number> = {
      telemetry_sample_count: telemetryFeatures.sampleCount,
      telemetry_metric_key_count: telemetryFeatures.metricKeyCount,
      telemetry_avg_volatility: telemetryFeatures.avgVolatility,
      telemetry_max_zscore: telemetryFeatures.maxZScore,
      active_alarm_count: alarmFeatures.activeAlarmCount,
      critical_alarm_count: alarmFeatures.criticalAlarmCount,
      recent_fault_event_count: alarmFeatures.recentFaultEventCount,
      corrective_work_order_count: workOrderFeatures.correctiveCount,
      preventive_work_order_count: workOrderFeatures.preventiveCount,
      overdue_work_order_count: workOrderFeatures.overdueCount,
      active_maintenance_plan_count: planCount,
      avg_resolution_days: interventionFeatures.avgResolutionDays,
      days_since_last_intervention:
        interventionFeatures.daysSinceLastIntervention,
    };

    const features = FEATURE_NAMES.map((name) => featureMap[name]);

    const measuredFacts = [
      `${telemetryFeatures.sampleCount} telemetry readings in the last ${TELEMETRY_WINDOW_DAYS} days.`,
      `${alarmFeatures.activeAlarmCount} active alarm(s), ${alarmFeatures.criticalAlarmCount} of which critical.`,
      `${alarmFeatures.recentFaultEventCount} fault event(s) raised in the last ${FAULT_WINDOW_DAYS} days.`,
      `${workOrderFeatures.correctiveCount} corrective and ${workOrderFeatures.preventiveCount} preventive work order(s) in the last ${WORK_ORDER_WINDOW_DAYS} days.`,
      `${workOrderFeatures.overdueCount} work order(s) currently overdue.`,
      `${planCount} active maintenance plan(s) apply to this machine.`,
      interventionFeatures.daysSinceLastIntervention >=
      NO_RECENT_INTERVENTION_SENTINEL_DAYS
        ? `No completed intervention on record in the last ${INTERVENTION_WINDOW_DAYS} days.`
        : `${interventionFeatures.daysSinceLastIntervention.toFixed(0)} day(s) since the last completed intervention.`,
    ];

    const isEmpty =
      telemetryFeatures.sampleCount === 0 &&
      alarmFeatures.activeAlarmCount === 0 &&
      alarmFeatures.recentFaultEventCount === 0 &&
      workOrderFeatures.correctiveCount === 0 &&
      workOrderFeatures.preventiveCount === 0 &&
      workOrderFeatures.overdueCount === 0 &&
      planCount === 0 &&
      interventionFeatures.daysSinceLastIntervention >=
        NO_RECENT_INTERVENTION_SENTINEL_DAYS;

    return { features, measuredFacts, isEmpty };
  }

  private async extractTelemetryFeatures(
    machineId: Types.ObjectId,
    asOfDate: Date,
  ) {
    const docs = await this.telemetryModel
      .find({
        machine_id: machineId,
        recorded_at: {
          $lte: asOfDate,
          $gte: daysBefore(asOfDate, TELEMETRY_WINDOW_DAYS),
        },
      })
      .exec();

    const valuesByKey = new Map<string, number[]>();
    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc.metrics ?? {})) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const values = valuesByKey.get(key) ?? [];
        values.push(value);
        valuesByKey.set(key, values);
      }
    }

    let volatilitySum = 0;
    let volatilityCount = 0;
    let maxZScore = 0;
    for (const values of valuesByKey.values()) {
      const sd = stddev(values);
      volatilitySum += sd;
      volatilityCount += 1;
      if (sd <= 0) continue;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      for (const value of values) {
        maxZScore = Math.max(maxZScore, Math.abs(value - mean) / sd);
      }
    }

    return {
      sampleCount: docs.length,
      metricKeyCount: valuesByKey.size,
      avgVolatility: volatilityCount > 0 ? volatilitySum / volatilityCount : 0,
      maxZScore,
    };
  }

  private async extractAlarmFeatures(
    machineId: Types.ObjectId,
    asOfDate: Date,
  ) {
    const [activeAlarms, recentFaultEventCount] = await Promise.all([
      this.faultEventModel
        .find({
          machine_id: machineId,
          raised_at: { $lte: asOfDate },
          $or: [
            { resolved_at: { $exists: false } },
            { resolved_at: { $gt: asOfDate } },
          ],
        })
        .exec(),
      this.faultEventModel
        .countDocuments({
          machine_id: machineId,
          raised_at: {
            $lte: asOfDate,
            $gte: daysBefore(asOfDate, FAULT_WINDOW_DAYS),
          },
        })
        .exec(),
    ]);

    return {
      activeAlarmCount: activeAlarms.length,
      criticalAlarmCount: activeAlarms.filter(
        (a) => a.severity === FaultEventSeverity.CRITICAL,
      ).length,
      recentFaultEventCount,
    };
  }

  private async extractWorkOrderFeatures(
    machineId: Types.ObjectId,
    asOfDate: Date,
  ) {
    const windowFilter = {
      machine_id: machineId,
      date_created: {
        $lte: asOfDate,
        $gte: daysBefore(asOfDate, WORK_ORDER_WINDOW_DAYS),
      },
    };

    const [correctiveCount, preventiveCount, overdueCount] = await Promise.all([
      this.workOrderModel
        .countDocuments({ ...windowFilter, type_maintenance: 'corrective' })
        .exec(),
      this.workOrderModel
        .countDocuments({ ...windowFilter, type_maintenance: 'preventive' })
        .exec(),
      this.workOrderModel
        .countDocuments({
          machine_id: machineId,
          status: 'overdue',
          date_created: { $lte: asOfDate },
        })
        .exec(),
    ]);

    return { correctiveCount, preventiveCount, overdueCount };
  }

  private async extractActiveMaintenancePlanCount(
    machineId: Types.ObjectId,
  ): Promise<number> {
    const moduleIds = await this.moduleModel
      .distinct('_id', { machine_id: machineId })
      .exec();
    if (moduleIds.length === 0) return 0;

    return this.maintenancePlanModel
      .countDocuments({
        module_id: { $in: moduleIds },
        status: {
          $nin: [MaintenancePlanStatus.ARCHIVED, MaintenancePlanStatus.DRAFT],
        },
      })
      .exec();
  }

  private async extractInterventionFeatures(
    machineId: Types.ObjectId,
    asOfDate: Date,
  ) {
    const workOrderIds = await this.workOrderModel
      .distinct('_id', {
        machine_id: machineId,
        date_created: { $lte: asOfDate },
      })
      .exec();

    if (workOrderIds.length === 0) {
      return {
        avgResolutionDays: 0,
        daysSinceLastIntervention: NO_RECENT_INTERVENTION_SENTINEL_DAYS,
      };
    }

    const reports = await this.interventionReportModel
      .find({
        ot_id: { $in: workOrderIds },
        date_debut: {
          $lte: asOfDate,
          $gte: daysBefore(asOfDate, INTERVENTION_WINDOW_DAYS),
        },
      })
      .sort({ date_debut: -1 })
      .exec();

    if (reports.length === 0) {
      return {
        avgResolutionDays: 0,
        daysSinceLastIntervention: NO_RECENT_INTERVENTION_SENTINEL_DAYS,
      };
    }

    const resolutionDays = reports
      .filter((r) => r.date_debut && r.date_fin)
      .map((r) =>
        Math.max(0, (r.date_fin.getTime() - r.date_debut.getTime()) / DAY_MS),
      );
    const avgResolutionDays =
      resolutionDays.length > 0
        ? resolutionDays.reduce((sum, d) => sum + d, 0) / resolutionDays.length
        : 0;

    const lastInterventionDate = reports[0].date_fin ?? reports[0].date_debut;
    const daysSinceLastIntervention = Math.min(
      NO_RECENT_INTERVENTION_SENTINEL_DAYS,
      Math.max(
        0,
        (asOfDate.getTime() - lastInterventionDate.getTime()) / DAY_MS,
      ),
    );

    return { avgResolutionDays, daysSinceLastIntervention };
  }
}
