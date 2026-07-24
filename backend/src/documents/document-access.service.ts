import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentEntity, DocumentDocument } from '../schemas/document.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { User, UserDocument, Role } from '../schemas/user.schema';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';

export type DocumentActor = {
  userId?: string;
  role?: string;
};

const CLOSED_WORK_ORDER_STATUSES = [
  'completed',
  'validated',
  'cancelled',
  'canceled',
  'CLOTURE',
  'ANNULE',
];

@Injectable()
export class DocumentAccessService {
  constructor(
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
  ) {}

  async resolveAccessibleDocument(
    actor: DocumentActor,
    documentId: string,
  ): Promise<DocumentDocument> {
    this.assertObjectId(documentId, 'document_id');
    const document = await this.documentModel.findById(documentId).exec();
    if (!document) throw new NotFoundException('Document not found');

    await this.assertCanAccessMachine(
      actor,
      this.toIdString(document.machine_id),
    );
    return document;
  }

  async assertCanAccessMachine(
    actor: DocumentActor,
    machineId: string,
  ): Promise<void> {
    const role = actor.role as Role | undefined;
    const userId = actor.userId;

    this.assertObjectId(machineId, 'machine_id');

    const machineExists = await this.machineModel
      .exists({ _id: machineId })
      .exec();
    if (!machineExists) throw new NotFoundException('Machine not found');

    if (role === Role.ADMIN) return;

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new ForbiddenException('Document access denied');
    }

    if (role === Role.OPERATOR) {
      if (await this.operatorCanAccessMachine(userId, machineId)) return;
      throw new ForbiddenException('Operator is not assigned to this machine');
    }

    if (role === Role.TECHNICIAN) {
      if (await this.technicianCanAccessMachine(userId, machineId)) return;
      throw new ForbiddenException('Technician is not authorized for this machine');
    }

    throw new ForbiddenException('Document access denied');
  }

  async listAccessibleMachineIds(
    actor: DocumentActor,
  ): Promise<Types.ObjectId[] | null> {
    const role = actor.role as Role | undefined;
    const userId = actor.userId;

    if (role === Role.ADMIN) return null;
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new ForbiddenException('Document access denied');
    }

    if (role === Role.OPERATOR) {
      return this.getOperatorMachineIds(userId);
    }

    if (role === Role.TECHNICIAN) {
      return this.getTechnicianMachineIds(userId);
    }

    throw new ForbiddenException('Document access denied');
  }

  private async operatorCanAccessMachine(
    userId: string,
    machineId: string,
  ): Promise<boolean> {
    const machineIds = await this.getOperatorMachineIds(userId);
    return machineIds.some((id) => id.equals(machineId));
  }

  private async getOperatorMachineIds(userId: string): Promise<Types.ObjectId[]> {
    const operator = await this.userModel
      .findById(userId)
      .select({ assigned_machine_ids: 1 })
      .exec();
    const explicitIds = (operator?.assigned_machine_ids ?? [])
      .map((id) => this.toObjectId(id))
      .filter((id): id is Types.ObjectId => Boolean(id));
    const workOrderMachineIds = await this.workOrderModel
      .distinct('machine_id', {
        technician_id: this.userReferenceFilter(userId),
      })
      .exec();

    return this.uniqueObjectIds([...explicitIds, ...workOrderMachineIds]);
  }

  private async technicianCanAccessMachine(
    userId: string,
    machineId: string,
  ): Promise<boolean> {
    const match = await this.workOrderModel
      .exists({
        machine_id: new Types.ObjectId(machineId),
        $or: [
          { technician_id: this.userReferenceFilter(userId) },
          {
            status: { $nin: CLOSED_WORK_ORDER_STATUSES },
            machine_id: { $in: await this.getAssignedMachineIds(userId) },
            $or: [
              { technician_id: { $exists: false } },
              { technician_id: null },
            ],
          },
        ],
      })
      .exec();

    return Boolean(match);
  }

  private async getTechnicianMachineIds(userId: string): Promise<Types.ObjectId[]> {
    const assignedMachineIds = await this.getAssignedMachineIds(userId);
    const ownMachineIds = await this.workOrderModel
      .distinct('machine_id', {
        technician_id: this.userReferenceFilter(userId),
      })
      .exec();
    const claimableMachineIds = assignedMachineIds.length
      ? await this.workOrderModel
          .distinct('machine_id', {
            machine_id: { $in: assignedMachineIds },
            status: { $nin: CLOSED_WORK_ORDER_STATUSES },
            $or: [
              { technician_id: { $exists: false } },
              { technician_id: null },
            ],
          })
          .exec()
      : [];

    return this.uniqueObjectIds([...ownMachineIds, ...claimableMachineIds]);
  }

  private async getAssignedMachineIds(userId: string): Promise<Types.ObjectId[]> {
    const technician = await this.userModel
      .findById(userId)
      .select({ assigned_machine_ids: 1 })
      .exec();

    return (technician?.assigned_machine_ids ?? [])
      .map((id) => this.toObjectId(id))
      .filter((id): id is Types.ObjectId => Boolean(id));
  }

  private userReferenceFilter(
    userId: string,
  ): { $in: Array<string | Types.ObjectId> } {
    return { $in: [userId, new Types.ObjectId(userId)] };
  }

  private uniqueObjectIds(values: unknown[]): Types.ObjectId[] {
    const ids = new Map<string, Types.ObjectId>();
    for (const value of values) {
      const objectId = this.toObjectId(value);
      if (objectId) ids.set(objectId.toHexString(), objectId);
    }
    return [...ids.values()];
  }

  private toIdString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (value && typeof value === 'object' && '_id' in value) {
      return this.toIdString((value as { _id?: unknown })._id);
    }
    return '';
  }

  private toObjectId(value: unknown): Types.ObjectId | null {
    const id = this.toIdString(value);
    return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
  }

  private assertObjectId(value: string, field: string): void {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ${field}`);
    }
  }
}
