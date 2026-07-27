import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { MachineType, MachineTypeDocument } from '../schemas/machine-type.schema';
import { Panne, PanneDocument } from '../schemas/panne.schema';
import { PanneSolution, PanneSolutionDocument } from '../schemas/panne-solution.schema';
import { FaultEvent, FaultEventDocument } from '../schemas/fault-event.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { AiGroundedContext } from './ai-provider.interface';

const ACTIVE_ALARMS_LIMIT = 10;
const WORK_ORDER_HISTORY_LIMIT = 8;
const KNOWLEDGE_ARTICLES_LIMIT = 5;

export type AiContextInput = {
  machineId?: string;
  faultCode?: string;
};

/**
 * Assembles the grounded context the assistant is allowed to reason over —
 * Knowledge Base, fault catalog, machine data, maintenance history, and
 * active alarms — exactly the sources named by the feature requirement.
 * Read-only throughout: nothing here ever mutates a Machine, WorkOrder,
 * FaultEvent, or any other domain record.
 */
@Injectable()
export class AiContextBuilderService {
  constructor(
    @InjectModel(Machine.name) private readonly machineModel: Model<MachineDocument>,
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(Panne.name) private readonly panneModel: Model<PanneDocument>,
    @InjectModel(PanneSolution.name)
    private readonly panneSolutionModel: Model<PanneSolutionDocument>,
    @InjectModel(FaultEvent.name)
    private readonly faultEventModel: Model<FaultEventDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}

  async buildContext(input: AiContextInput): Promise<AiGroundedContext> {
    const machineId =
      input.machineId && Types.ObjectId.isValid(input.machineId)
        ? input.machineId
        : undefined;

    const [machine, corrective, activeAlarms, maintenanceHistory, knowledgeArticles] =
      await Promise.all([
        machineId ? this.loadMachine(machineId) : Promise.resolve(null),
        input.faultCode ? this.loadCorrectiveData(input.faultCode) : Promise.resolve(null),
        machineId ? this.loadActiveAlarms(machineId) : Promise.resolve([]),
        machineId ? this.loadMaintenanceHistory(machineId) : Promise.resolve([]),
        this.knowledgeBaseService.computeSuggestions({
          machineId,
          faultCode: input.faultCode,
          limit: KNOWLEDGE_ARTICLES_LIMIT,
        }),
      ]);

    return {
      machineName: machine?.machineName,
      machineTypeName: machine?.machineTypeName,
      faultCode: input.faultCode,
      faultDescription: corrective?.faultDescription,
      faultSeverity: undefined,
      probableCause: corrective?.probableCause,
      approvedSolution: corrective?.approvedSolution,
      activeAlarms,
      maintenanceHistory,
      knowledgeArticles: knowledgeArticles.map((article) => ({
        title: article.title,
        summary: article.summary,
        category: article.category,
      })),
    };
  }

  private async loadMachine(
    machineId: string,
  ): Promise<{ machineName: string; machineTypeName?: string } | null> {
    const machine = await this.machineModel.findById(machineId).exec();
    if (!machine) return null;

    const machineName = machine.reference
      ? `${machine.machine_id} (${machine.reference})`
      : machine.machine_id;

    const machineType = await this.machineTypeModel
      .findById(machine.type_id)
      .exec();

    return { machineName, machineTypeName: machineType?.name };
  }

  private async loadCorrectiveData(codePanne: string): Promise<{
    faultDescription?: string;
    probableCause?: string;
    approvedSolution?: string;
  } | null> {
    const panne = await this.panneModel.findOne({ code_panne: codePanne }).exec();
    if (!panne) return null;

    const solution = await this.panneSolutionModel
      .findOne({ panne_id: panne._id })
      .exec();

    return {
      faultDescription: panne.description,
      probableCause: solution?.cause_probable,
      approvedSolution: solution?.solution_recommandee,
    };
  }

  private async loadActiveAlarms(
    machineId: string,
  ): Promise<AiGroundedContext['activeAlarms']> {
    const events = await this.faultEventModel
      .find({ machine_id: machineId, resolved_at: { $exists: false } })
      .sort({ raised_at: -1 })
      .limit(ACTIVE_ALARMS_LIMIT)
      .exec();

    return events.map((event) => ({
      codePanne: event.code_panne,
      severity: event.severity,
      message: event.message,
      raisedAt: event.raised_at.toISOString(),
    }));
  }

  private async loadMaintenanceHistory(
    machineId: string,
  ): Promise<AiGroundedContext['maintenanceHistory']> {
    const workOrders = await this.workOrderModel
      .find({ machine_id: machineId })
      .sort({ date_created: -1 })
      .limit(WORK_ORDER_HISTORY_LIMIT)
      .exec();

    if (workOrders.length === 0) return [];

    const reports = await this.interventionReportModel
      .find({ ot_id: { $in: workOrders.map((wo) => wo._id) } })
      .sort({ date_debut: -1 })
      .exec();

    const reportByWorkOrderId = new Map<string, InterventionReportDocument>();
    for (const report of reports) {
      const key = report.ot_id.toString();
      if (!reportByWorkOrderId.has(key)) reportByWorkOrderId.set(key, report);
    }

    return workOrders.map((wo) => {
      const report = reportByWorkOrderId.get((wo._id as Types.ObjectId).toString());
      return {
        date: wo.date_created.toISOString(),
        type: wo.type_maintenance,
        status: wo.status,
        codePanne: wo.code_panne,
        description: wo.description,
        rootCause: report?.cause_racine,
        actionTaken: report?.description_action,
      };
    });
  }
}
