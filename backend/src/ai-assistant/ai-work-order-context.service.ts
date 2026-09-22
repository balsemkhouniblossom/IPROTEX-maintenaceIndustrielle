import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CLOSED_WORK_ORDER_STATUSES } from '../common/work-order-status';
import { DocumentAccessService } from '../documents/document-access.service';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { OTPieces, OTPiecesDocument } from '../schemas/ot-pieces.schema';
import {
  PreventiveTask,
  PreventiveTaskDocument,
} from '../schemas/preventive-task.schema';
import { Role, User, UserDocument } from '../schemas/user.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import { AiGroundedContext } from './ai-provider.interface';
import { SensitiveDataFilterService } from './sensitive-data-filter.service';

type AiActor = { userId: string; role: string };

export type AuthorizedWorkOrderContext = {
  workOrderId: string;
  machineId: string;
  context: NonNullable<AiGroundedContext['workOrder']>;
};

/**
 * Resolves one work order into the deliberately small, business-readable
 * projection that the AI assistant may use. Authorization happens before
 * any related report, checklist, user, or part data is loaded.
 */
@Injectable()
export class AiWorkOrderContextService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(OTPieces.name)
    private readonly otPiecesModel: Model<OTPiecesDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(PreventiveTask.name)
    private readonly preventiveTaskModel: Model<PreventiveTaskDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly documentAccessService: DocumentAccessService,
    private readonly sensitiveDataFilter: SensitiveDataFilterService,
  ) {}

  async resolve(
    actor: AiActor,
    workOrderId: string,
    requestedMachineId?: string,
  ): Promise<AuthorizedWorkOrderContext> {
    if (!Types.ObjectId.isValid(workOrderId)) {
      throw new BadRequestException('Invalid work_order_id');
    }

    const workOrder = await this.workOrderModel
      .findById(workOrderId)
      .select({
        ot_id: 1,
        machine_id: 1,
        technician_id: 1,
        plan_id: 1,
        description: 1,
        type_maintenance: 1,
        status: 1,
        priorite: 1,
        code_panne: 1,
        date_created: 1,
        date_start: 1,
        scheduled_date: 1,
        due_date: 1,
        execution_date: 1,
        date_end: 1,
        date_closed: 1,
        reschedule_reason: 1,
      })
      .exec();
    if (!workOrder) throw new NotFoundException('Work order not found');

    const machineId = this.objectIdString(workOrder.machine_id);
    if (!machineId) throw new NotFoundException('Machine not found');

    if (requestedMachineId && requestedMachineId !== machineId) {
      throw new BadRequestException(
        'Work order does not belong to the selected machine',
      );
    }

    await this.documentAccessService.assertCanAccessMachine(actor, machineId);
    this.assertCanAccessWorkOrder(actor, workOrder);

    const [reports, parts, checklist, technician] = await Promise.all([
      this.interventionReportModel
        .find({ ot_id: workOrder._id })
        .select({
          report_id: 1,
          technician_id: 1,
          date_debut: 1,
          date_fin: 1,
          cause_racine: 1,
          description_action: 1,
          etat_final: 1,
        })
        .sort({ date_fin: -1 })
        .exec(),
      this.otPiecesModel
        .find({ ot_id: workOrder._id })
        .select({ part_id: 1, quantite: 1 })
        .exec(),
      workOrder.plan_id
        ? this.preventiveTaskModel
            .find({
              plan_id: workOrder.plan_id,
              deleted_at: { $exists: false },
            })
            .select({
              task_id: 1,
              instruction: 1,
              responsable: 1,
              status: 1,
              notes: 1,
              completed_at: 1,
            })
            .sort({ task_id: 1 })
            .exec()
        : Promise.resolve([]),
      workOrder.technician_id
        ? this.userModel
            .findById(workOrder.technician_id)
            .select({ nom_complet: 1, user_id: 1 })
            .exec()
        : Promise.resolve(null),
    ]);

    const reportTechnicianIds = [
      ...new Set(
        reports
          .map((report) => this.objectIdString(report.technician_id))
          .filter(Boolean),
      ),
    ];
    const reportTechnicians = reportTechnicianIds.length
      ? await this.userModel
          .find({ _id: { $in: reportTechnicianIds } })
          .select({ nom_complet: 1, user_id: 1 })
          .exec()
      : [];
    const technicianById = new Map(
      reportTechnicians.map((user) => [
        user._id.toString(),
        this.clean(user.nom_complet || user.user_id),
      ]),
    );

    const partIds = [
      ...new Set(
        parts.map((part) => this.objectIdString(part.part_id)).filter(Boolean),
      ),
    ];
    const catalogues = partIds.length
      ? await this.catalogueModel
          .find({ _id: { $in: partIds } })
          .select({
            part_id: 1,
            nom_piece: 1,
            ref_constructeur: 1,
            fabricant: 1,
          })
          .exec()
      : [];
    const catalogueById = new Map(
      catalogues.map((part) => [part._id.toString(), part]),
    );

    return {
      workOrderId: workOrder._id.toString(),
      machineId,
      context: {
        reference: this.clean(workOrder.ot_id),
        maintenanceType: this.cleanOptional(workOrder.type_maintenance),
        status: this.clean(workOrder.status),
        priority: this.cleanOptional(workOrder.priorite),
        description: this.cleanOptional(workOrder.description),
        faultCode: this.cleanOptional(workOrder.code_panne),
        assignedTechnician: technician
          ? this.cleanOptional(technician.nom_complet || technician.user_id)
          : undefined,
        createdAt: workOrder.date_created.toISOString(),
        startedAt: workOrder.date_start?.toISOString(),
        scheduledAt: workOrder.scheduled_date?.toISOString(),
        dueAt: workOrder.due_date?.toISOString(),
        executedAt: workOrder.execution_date?.toISOString(),
        completedAt: workOrder.date_end?.toISOString(),
        closedAt: workOrder.date_closed?.toISOString(),
        rescheduleReason: this.cleanOptional(workOrder.reschedule_reason),
        checklist: checklist.map((task) => ({
          reference: this.clean(task.task_id),
          instruction: this.clean(task.instruction),
          responsible: this.cleanOptional(task.responsable),
          status: this.clean(task.status),
          notes: this.cleanOptional(task.notes),
          completedAt: task.completed_at?.toISOString(),
        })),
        interventions: reports.map((report) => ({
          reference: this.clean(report.report_id),
          startedAt: report.date_debut.toISOString(),
          completedAt: report.date_fin.toISOString(),
          technician: technicianById.get(
            this.objectIdString(report.technician_id),
          ),
          rootCause: this.cleanOptional(report.cause_racine),
          actionTaken: this.cleanOptional(report.description_action),
          finalState: this.cleanOptional(report.etat_final),
        })),
        partsUsed: parts.flatMap((usage) => {
          const part = catalogueById.get(this.objectIdString(usage.part_id));
          if (!part) return [];
          return [
            {
              reference: this.clean(part.part_id),
              name: this.clean(part.nom_piece),
              manufacturerReference: this.clean(part.ref_constructeur),
              manufacturer: this.cleanOptional(part.fabricant),
              quantity: usage.quantite,
            },
          ];
        }),
      },
    };
  }

  private assertCanAccessWorkOrder(
    actor: AiActor,
    workOrder: WorkOrderDocument,
  ): void {
    const role = actor.role as Role;
    if (role === Role.ADMIN) return;

    const assignedUserId = this.objectIdString(workOrder.technician_id);
    if (assignedUserId === actor.userId) return;

    if (
      role === Role.TECHNICIAN &&
      !assignedUserId &&
      !CLOSED_WORK_ORDER_STATUSES.includes(workOrder.status)
    ) {
      return;
    }

    throw new ForbiddenException('Work order access denied');
  }

  private objectIdString(value: unknown): string {
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      return new Types.ObjectId(value).toHexString();
    }
    if (value && typeof value === 'object' && '_id' in value) {
      return this.objectIdString((value as { _id?: unknown })._id);
    }
    return '';
  }

  private clean(value: string): string {
    return this.sensitiveDataFilter.redact(value).redacted.trim();
  }

  private cleanOptional(value?: string): string | undefined {
    if (!value) return undefined;
    const cleaned = this.clean(value);
    return cleaned || undefined;
  }
}
