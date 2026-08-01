import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MachineHealthPrediction,
  MachineHealthPredictionDocument,
  PredictionRiskLevel,
} from '../schemas/machine-health-prediction.schema';
import {
  PredictionModelVersion,
  PredictionModelVersionDocument,
  PredictionModelVersionStatus,
} from '../schemas/prediction-model-version.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
  MaintenancePlanStatus,
} from '../schemas/maintenance-plan.schema';
import { DocumentAccessService } from '../documents/document-access.service';
import { FeatureExtractionService } from './feature-extraction.service';
import {
  FEATURE_NAMES,
  ModelArtifact,
  PREDICTION_MODELS,
  PredictionModel,
} from './prediction-model.interface';

export type PredictiveActor = { userId: string; role: string };

export type FleetHealthSummary = {
  machineId: string;
  healthScore: number;
  riskLevel: PredictionRiskLevel;
  confidence: number;
  modelCount: number;
  generatedAt: Date | null;
};

const RISK_ORDER: PredictionRiskLevel[] = [
  PredictionRiskLevel.LOW,
  PredictionRiskLevel.MEDIUM,
  PredictionRiskLevel.HIGH,
  PredictionRiskLevel.CRITICAL,
  // Dominant/worst-case in aggregation: if any model type's latest reading
  // for a machine is insufficient-data, the whole machine's summary shows
  // that rather than silently reporting a stale or partial "healthy" figure.
  PredictionRiskLevel.INSUFFICIENT_DATA,
];

function clampHealthScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function worstRisk(levels: PredictionRiskLevel[]): PredictionRiskLevel {
  return levels.reduce(
    (worst, level) =>
      RISK_ORDER.indexOf(level) > RISK_ORDER.indexOf(worst) ? level : worst,
    PredictionRiskLevel.LOW,
  );
}

/**
 * The read/inference side of predictive maintenance. Every public method
 * either scopes to a caller-accessible machine via `DocumentAccessService`
 * (mirroring the same access-control primitive already used by Documents,
 * Knowledge Base, Live Monitoring, and the AI assistant) or filters by the
 * caller's accessible machine set — there is no method here that returns
 * data for a machine the caller couldn't otherwise see. Nothing in this
 * service writes to WorkOrder, Stock, or Machine; the only writes are its
 * own `MachineHealthPrediction` audit rows.
 */
@Injectable()
export class PredictiveMaintenanceService {
  constructor(
    @InjectModel(MachineHealthPrediction.name)
    private readonly predictionModel: Model<MachineHealthPredictionDocument>,
    @InjectModel(PredictionModelVersion.name)
    private readonly modelVersionModel: Model<PredictionModelVersionDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @Inject(PREDICTION_MODELS) private readonly models: PredictionModel[],
    private readonly featureExtractionService: FeatureExtractionService,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

  /** Runs every active model against a machine's current data and persists one prediction row per model type. Called by the scheduler, and on-demand by an Admin/Technician who wants a fresh read. */
  async runPredictionForMachine(
    machineId: string,
    asOfDate: Date = new Date(),
  ): Promise<MachineHealthPredictionDocument[]> {
    const { features, measuredFacts, isEmpty } =
      await this.featureExtractionService.buildFeatureVector(
        machineId,
        asOfDate,
      );
    const activeVersions = await this.modelVersionModel
      .find({ status: PredictionModelVersionStatus.ACTIVE })
      .exec();

    const results: MachineHealthPredictionDocument[] = [];
    for (const version of activeVersions) {
      const model = this.models.find((m) => m.type === version.model_type);
      if (!model) continue;

      const inference = model.score(
        features,
        version.artifact as ModelArtifact,
      );
      const healthScore = clampHealthScore(100 * (1 - inference.anomalyScore));
      const riskLevel = isEmpty
        ? PredictionRiskLevel.INSUFFICIENT_DATA
        : this.deriveRiskLevel(inference.anomalyScore, features);

      const created = await this.predictionModel.create({
        machine_id: new Types.ObjectId(machineId),
        model_version_id: version._id,
        model_type: version.model_type,
        health_score: healthScore,
        anomaly_score: inference.anomalyScore,
        risk_level: riskLevel,
        confidence: inference.confidence,
        feature_snapshot: features,
        generated_at: asOfDate,
        explanation: {
          measuredFacts,
          modelOutputNotes: [
            `Anomaly score ${inference.anomalyScore.toFixed(2)} (0 = matches the trained baseline, 1 = maximally anomalous) from the ${model.displayName} model, version ${version.version}.`,
            ...inference.modelNotes,
          ],
          uncertaintyNotes: this.buildUncertaintyNotes(
            inference.confidence,
            version,
            isEmpty,
          ),
        },
      });
      results.push(created);
    }

    return results;
  }

  async predictForMachine(
    machineId: string,
    actor: PredictiveActor,
  ): Promise<MachineHealthPredictionDocument[]> {
    await this.documentAccessService.assertCanAccessMachine(
      { userId: actor.userId, role: actor.role },
      machineId,
    );
    return this.runPredictionForMachine(machineId);
  }

  async getLatestPredictions(
    machineId: string,
    actor: PredictiveActor,
  ): Promise<MachineHealthPredictionDocument[]> {
    await this.documentAccessService.assertCanAccessMachine(
      { userId: actor.userId, role: actor.role },
      machineId,
    );
    return this.fetchLatestPerModelType(machineId);
  }

  async getHistory(
    machineId: string,
    actor: PredictiveActor,
    limit = 50,
  ): Promise<MachineHealthPredictionDocument[]> {
    await this.documentAccessService.assertCanAccessMachine(
      { userId: actor.userId, role: actor.role },
      machineId,
    );
    return this.predictionModel
      .find({ machine_id: new Types.ObjectId(machineId) })
      .sort({ generated_at: -1 })
      .limit(limit)
      .exec();
  }

  async getFleetSummary(actor: PredictiveActor): Promise<FleetHealthSummary[]> {
    const accessibleIds =
      await this.documentAccessService.listAccessibleMachineIds({
        userId: actor.userId,
        role: actor.role,
      });

    const machines = await this.machineModel
      .find(accessibleIds ? { _id: { $in: accessibleIds } } : {})
      .select({ _id: 1 })
      .exec();

    const summaries: FleetHealthSummary[] = [];
    for (const machine of machines) {
      const summary = await this.summarizeMachine(machine._id.toString());
      if (summary) summaries.push(summary);
    }
    return summaries;
  }

  /** Resolves every accessible maintenance plan to its machine (Plan -> Module -> Machine) and attaches that machine's latest health summary, so the plans page can show risk without needing to know about machines at all. */
  async getPlanHealthSummaries(
    actor: PredictiveActor,
  ): Promise<Record<string, FleetHealthSummary & { machineId: string }>> {
    const accessibleIds =
      await this.documentAccessService.listAccessibleMachineIds({
        userId: actor.userId,
        role: actor.role,
      });

    const modules = await this.moduleModel
      .find(accessibleIds ? { machine_id: { $in: accessibleIds } } : {})
      .select({ _id: 1, machine_id: 1 })
      .exec();
    const machineIdByModuleId = new Map(
      modules.map((m) => [m._id.toString(), m.machine_id.toString()]),
    );
    if (machineIdByModuleId.size === 0) return {};

    const plans = await this.maintenancePlanModel
      .find({
        // Explicit ObjectId cast rather than trusting Mongoose to cast the
        // strings inside `$in` automatically — see the identical fix in
        // AiAssistantService.listOwnHistory for why that trust doesn't hold.
        module_id: {
          $in: [...machineIdByModuleId.keys()].map(
            (id) => new Types.ObjectId(id),
          ),
        },
        status: { $ne: MaintenancePlanStatus.ARCHIVED },
      })
      .select({ _id: 1, module_id: 1 })
      .exec();

    const summaryByMachineId = new Map<string, FleetHealthSummary | null>();
    const result: Record<string, FleetHealthSummary & { machineId: string }> =
      {};

    for (const plan of plans) {
      const machineId = machineIdByModuleId.get(plan.module_id.toString());
      if (!machineId) continue;

      if (!summaryByMachineId.has(machineId)) {
        summaryByMachineId.set(
          machineId,
          await this.summarizeMachine(machineId),
        );
      }
      const summary = summaryByMachineId.get(machineId);
      if (summary) result[plan._id.toString()] = { ...summary, machineId };
    }

    return result;
  }

  private async summarizeMachine(
    machineId: string,
  ): Promise<FleetHealthSummary | null> {
    const latest = await this.fetchLatestPerModelType(machineId);
    if (latest.length === 0) return null;

    const healthScore =
      latest.reduce((sum, p) => sum + p.health_score, 0) / latest.length;
    const confidence =
      latest.reduce((sum, p) => sum + p.confidence, 0) / latest.length;

    return {
      machineId,
      healthScore: clampHealthScore(healthScore),
      riskLevel: worstRisk(latest.map((p) => p.risk_level)),
      confidence,
      modelCount: latest.length,
      generatedAt: latest.reduce<Date | null>(
        (max, p) => (!max || p.generated_at > max ? p.generated_at : max),
        null,
      ),
    };
  }

  private async fetchLatestPerModelType(
    machineId: string,
  ): Promise<MachineHealthPredictionDocument[]> {
    const machineObjectId = new Types.ObjectId(machineId);
    const results: MachineHealthPredictionDocument[] = [];

    for (const modelType of new Set(this.models.map((m) => m.type))) {
      const latest = await this.predictionModel
        .findOne({ machine_id: machineObjectId, model_type: modelType })
        .sort({ generated_at: -1 })
        .exec();
      if (latest) results.push(latest);
    }

    return results;
  }

  private deriveRiskLevel(
    anomalyScore: number,
    features: number[],
  ): PredictionRiskLevel {
    const activeAlarmCount =
      features[FEATURE_NAMES.indexOf('active_alarm_count')] ?? 0;
    const criticalAlarmCount =
      features[FEATURE_NAMES.indexOf('critical_alarm_count')] ?? 0;
    const overdueCount =
      features[FEATURE_NAMES.indexOf('overdue_work_order_count')] ?? 0;

    if (anomalyScore >= 0.75 || criticalAlarmCount > 0)
      return PredictionRiskLevel.CRITICAL;
    if (anomalyScore >= 0.5 || overdueCount >= 2 || activeAlarmCount >= 2)
      return PredictionRiskLevel.HIGH;
    if (anomalyScore >= 0.25 || overdueCount >= 1 || activeAlarmCount >= 1)
      return PredictionRiskLevel.MEDIUM;
    return PredictionRiskLevel.LOW;
  }

  private buildUncertaintyNotes(
    confidence: number,
    version: PredictionModelVersionDocument,
    isEmpty: boolean,
  ): string[] {
    const notes: string[] = [];
    if (isEmpty) {
      notes.push(
        'No telemetry, alarms, work orders, maintenance plans, or interventions were recorded for this machine as of this checkpoint — this reflects an absence of data, not a health assessment. Disregard the health/anomaly score above until real operational data exists for this machine.',
      );
    }
    if (confidence < 0.5) {
      notes.push(
        `Confidence is low (${Math.round(confidence * 100)}%) because this model version was trained on only ${version.training_sample_count} historical sample(s) — treat this prediction as a rough signal, not a verified diagnosis.`,
      );
    }
    notes.push(
      'This is an advisory estimate only. It never changes any work order, stock level, or machine status automatically — verify with a technician before acting on it.',
    );
    return notes;
  }
}
