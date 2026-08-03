import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  WorkOrder,
  WorkOrderDocument,
  WorkOrderLifecycleAction,
} from '../../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../../schemas/intervention-report.schema';
import {
  assertTransitionAllowed,
  transitionPlan,
  validationTransitionPlan,
} from '../work-order-lifecycle.policy';

@Injectable()
export class WorkOrderLifecycleService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
  ) {}

  async applyValidationAction(input: {
    workOrderId: string;
    action: 'approve' | 'reject' | 'request_correction';
    validatorId?: string;
    session?: ClientSession;
  }) {
    const workOrderQuery = this.workOrderModel.findById(input.workOrderId);
    if (input.session) workOrderQuery.session(input.session);
    const workOrder = await workOrderQuery.exec();
    if (!workOrder) {
      return null;
    }

    const reportQuery = this.interventionReportModel
      .findOne({ ot_id: workOrder._id })
      .sort({ date_fin: -1 });
    if (input.session) reportQuery.session(input.session);
    const report = await reportQuery.exec();

    const performerId =
      report?.technician_id?.toString() ?? workOrder.technician_id?.toString();
    if (
      input.action === 'approve' &&
      input.validatorId &&
      performerId === input.validatorId
    ) {
      throw new ForbiddenException('You cannot approve your own work');
    }

    const plan = validationTransitionPlan(input.action);
    if (workOrder.status === plan.to) {
      Object.defineProperty(workOrder, '__validationAlreadyApplied', {
        value: true,
        enumerable: false,
      });
      return workOrder;
    }
    assertTransitionAllowed(workOrder.status, plan);
    const validatorObjectId =
      input.validatorId && Types.ObjectId.isValid(input.validatorId)
        ? new Types.ObjectId(input.validatorId)
        : undefined;
    const now = new Date();
    const updatedWorkOrder = await this.workOrderModel
      .findOneAndUpdate(
        { _id: workOrder._id, status: { $in: plan.from } },
        {
          $set: {
            status: plan.to,
            ...(input.action === 'approve' && validatorObjectId
              ? { validated_by: validatorObjectId, validated_at: now }
              : {}),
          },
          $push: {
            lifecycle_history: this.historyEntry({
              action: plan.historyAction!,
              from: workOrder.status,
              to: plan.to,
              actor: validatorObjectId,
              at: now,
            }),
          },
        },
        { new: true, session: input.session },
      )
      .exec();

    if (!updatedWorkOrder) {
      throw new ConflictException('Invalid work-order status transition');
    }

    if (report) {
      await this.interventionReportModel
        .findByIdAndUpdate(
          report._id,
          {
            validation_responsable: this.reportStatus(input.action),
            ...(input.validatorId
              ? { validated_by: input.validatorId, validated_at: now }
              : {}),
          },
          { new: true, session: input.session },
        )
        .exec();
    }

    return updatedWorkOrder;
  }

  async startForOperator(input: {
    operatorId: string;
    workOrderId: string;
    session?: ClientSession;
  }) {
    const plan = transitionPlan('operator_start');
    const now = new Date();
    const updated = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: this.objectId(input.workOrderId, 'work order'),
          technician_id: this.objectId(input.operatorId, 'operator'),
          status: { $in: plan.from },
        },
        { $set: { status: plan.to, date_start: now } },
        { new: true, session: input.session },
      )
      .exec();
    if (!updated) {
      throw new ConflictException('This work order cannot be started');
    }
    return updated;
  }

  async completeForOperator(input: {
    operatorId: string;
    workOrderId: string;
    executionDate?: Date | string;
    session?: ClientSession;
  }) {
    const plan = transitionPlan('operator_complete');
    const now = new Date();
    const updated = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: this.objectId(input.workOrderId, 'work order'),
          technician_id: this.objectId(input.operatorId, 'operator'),
          status: { $in: plan.from },
        },
        {
          $set: {
            status: plan.to,
            execution_date: input.executionDate || now,
            date_end: now,
          },
        },
        { new: true, session: input.session },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'This work order must be in progress before it can be completed',
      );
    }
    return updated;
  }

  async transitionForTechnician(input: {
    technicianId: string;
    workOrderId: string;
    from: string[];
    to: string;
    session?: ClientSession;
  }) {
    assertTransitionAllowed(input.from[0], { from: input.from, to: input.to });
    const updated = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: this.objectId(input.workOrderId, 'work order'),
          technician_id: this.technicianScope(input.technicianId),
          status: { $in: input.from },
        },
        { $set: { status: input.to } },
        { new: true, session: input.session },
      )
      .exec();
    if (!updated) {
      throw new ConflictException('Invalid work-order status transition');
    }
    return updated;
  }

  async startForTechnician(input: {
    technicianId: string;
    workOrderId: string;
    accessibleMachineIds: Types.ObjectId[];
    session?: ClientSession;
  }) {
    const id = this.objectId(input.workOrderId, 'work order');
    const technician = this.objectId(input.technicianId, 'technician');
    const existingQuery = this.workOrderModel.findOne({
      _id: id,
      technician_id: this.technicianScope(input.technicianId),
      status: 'in_progress',
    });
    if (input.session) existingQuery.session(input.session);
    const existing = await existingQuery.exec();
    if (existing) return existing;

    const updated = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: id,
          status: { $in: transitionPlan('technician_start').from },
          $or: [
            { technician_id: this.technicianScope(input.technicianId) },
            this.claimableUnassignedScope(input.accessibleMachineIds),
          ],
        },
        {
          $set: {
            status: 'in_progress',
            technician_id: technician,
            date_start: new Date(),
          },
        },
        { new: true, session: input.session },
      )
      .exec();
    if (!updated) throw new ConflictException('Work order cannot be started');

    const reportUpdateQuery = this.interventionReportModel.updateOne(
      { ot_id: id },
      {
        $set: {
          validation_responsable: 'validated',
        },
      },
    );
    if (input.session) reportUpdateQuery.session(input.session);
    await reportUpdateQuery.exec();
    return updated;
  }

  async closeForTechnician(input: {
    technicianId: string;
    workOrderId: string;
    report: InterventionReportDocument;
    session?: ClientSession;
  }) {
    if (
      !input.report.description_action?.trim() ||
      !input.report.etat_final?.trim()
    ) {
      throw new BadRequestException('Technical action and result are required');
    }

    const id = this.objectId(input.workOrderId, 'work order');
    const technician = this.objectId(input.technicianId, 'technician');
    const plan = transitionPlan('technician_close');
    const now = new Date();
    const updated = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: id,
          technician_id: this.technicianScope(input.technicianId),
          status: { $in: plan.from },
        },
        {
          $set: {
            status: plan.to,
            date_end: now,
            date_closed: now,
          },
          $push: {
            lifecycle_history: this.historyEntry({
              action: plan.historyAction!,
              from: 'in_progress',
              to: plan.to,
              actor: technician,
              at: now,
            }),
          },
        },
        { new: true, session: input.session },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'Work order must be in progress before closing',
      );
    }

    const reportUpdateQuery = this.interventionReportModel.updateOne(
      { _id: input.report._id },
      {
        $set: { date_fin: now, validation_responsable: 'waiting_validation' },
      },
    );
    if (input.session) reportUpdateQuery.session(input.session);
    await reportUpdateQuery.exec();

    return updated;
  }

  async requireInterventionReport(
    workOrderId: string,
    session?: ClientSession,
  ) {
    const reportQuery = this.interventionReportModel.findOne({
      ot_id: this.objectId(workOrderId, 'work order'),
    });
    if (session) reportQuery.session(session);
    const report = await reportQuery.exec();
    if (!report) {
      throw new NotFoundException('Intervention report not found');
    }
    return report;
  }

  private historyEntry(input: {
    action: WorkOrderLifecycleAction;
    from: string;
    to: string;
    actor?: Types.ObjectId;
    at: Date;
  }) {
    return {
      action: input.action,
      from_status: input.from,
      to_status: input.to,
      actor_user_id: input.actor,
      at: input.at,
    };
  }

  private reportStatus(action: 'approve' | 'reject' | 'request_correction') {
    if (action === 'approve') return 'validated';
    if (action === 'reject') return 'rejected';
    return 'request_correction';
  }

  private technicianScope(technicianId: string) {
    const id = this.objectId(technicianId, 'technician');
    return { $in: [id, technicianId] };
  }

  private claimableUnassignedScope(machineIds: Types.ObjectId[]) {
    if (!machineIds.length) return { machine_id: { $in: [] } };
    return {
      machine_id: { $in: machineIds },
      $or: [{ technician_id: { $exists: false } }, { technician_id: null }],
    };
  }

  private objectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label}`);
    }
    return new Types.ObjectId(id);
  }
}
