import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import { PredictiveMaintenanceService } from '../../predictive-maintenance/predictive-maintenance.service';
import {
  ReportActor,
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

/** One row per accessible machine: its latest predictive health summary, reusing `PredictiveMaintenanceService.getFleetSummary` verbatim — the exact same role-scoped read the machine dashboards' health badges already call, exported to a document instead of rendered as a badge. */
@Injectable()
export class PredictiveRiskReportProvider implements ReportDataProvider {
  readonly type = ReportType.PREDICTIVE_RISK;

  constructor(
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    private readonly predictiveMaintenanceService: PredictiveMaintenanceService,
  ) {}

  async buildDataset(
    params: ReportParams,
    actor: ReportActor,
  ): Promise<ReportDataset> {
    const summaries =
      await this.predictiveMaintenanceService.getFleetSummary(actor);
    const scoped = params.machineId
      ? summaries.filter((s) => s.machineId === params.machineId)
      : summaries;

    const machines = await this.machineModel
      .find({ _id: { $in: scoped.map((s) => s.machineId) } })
      .select({ machine_id: 1, reference: 1 })
      .exec();
    const machineLabelById = new Map(
      machines.map((m) => [
        m._id.toString(),
        m.reference ? `${m.machine_id} (${m.reference})` : m.machine_id,
      ]),
    );

    const rows = scoped
      .map((summary) => ({
        machine: machineLabelById.get(summary.machineId) ?? summary.machineId,
        health_score: Math.round(summary.healthScore * 10) / 10,
        risk_level: summary.riskLevel,
        confidence_percent: Math.round(summary.confidence * 100),
        model_count: summary.modelCount,
        generated_at: summary.generatedAt
          ? new Date(summary.generatedAt).toISOString()
          : '',
      }))
      .sort((a, b) => a.health_score - b.health_score);

    return {
      title: 'Predictive Maintenance Risk Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'machine', label: 'Machine' },
        { key: 'health_score', label: 'Health Score' },
        { key: 'risk_level', label: 'Risk Level' },
        { key: 'confidence_percent', label: 'Confidence %' },
        { key: 'model_count', label: 'Models' },
        { key: 'generated_at', label: 'Last Prediction' },
      ],
      rows,
      summary: [
        { label: 'Machines covered', value: rows.length },
        {
          label: 'Critical/High risk machines',
          value: rows.filter(
            (r) => r.risk_level === 'critical' || r.risk_level === 'high',
          ).length,
        },
      ],
    };
  }
}
