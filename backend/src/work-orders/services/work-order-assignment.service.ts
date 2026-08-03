import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { CLOSED_WORK_ORDER_STATUSES } from '../../common/work-order-status';

@Injectable()
export class WorkOrderAssignmentService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
  ) {}

  async claimForTechnician(input: {
    technicianId: string;
    workOrderId: string;
    accessibleMachineIds: Types.ObjectId[];
    session?: ClientSession;
  }) {
    const technician = this.objectId(input.technicianId, 'technician');
    const workOrderId = this.objectId(input.workOrderId, 'work order');

    const alreadyMineQuery = this.workOrderModel.findOne({
      _id: workOrderId,
      technician_id: this.technicianScope(input.technicianId),
    });
    if (input.session) alreadyMineQuery.session(input.session);
    const alreadyMine = await alreadyMineQuery.exec();
    if (alreadyMine) return alreadyMine;

    const claimed = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: workOrderId,
          ...this.claimableUnassignedScope(input.accessibleMachineIds),
        },
        {
          $set: { technician_id: technician, status: 'assigned' },
        },
        { new: true, session: input.session },
      )
      .exec();

    if (!claimed) {
      throw new ConflictException('Work order is closed or already assigned');
    }

    return claimed;
  }

  claimableUnassignedScope(
    machineIds: Types.ObjectId[],
  ): FilterQuery<WorkOrderDocument> {
    if (!machineIds.length) return { machine_id: { $in: [] } };
    return {
      machine_id: { $in: machineIds },
      status: { $nin: CLOSED_WORK_ORDER_STATUSES },
      $or: [{ technician_id: { $exists: false } }, { technician_id: null }],
    };
  }

  technicianScope(technicianId: string) {
    const id = this.objectId(technicianId, 'technician');
    return { $in: [id, technicianId] };
  }

  private objectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label}`);
    }
    return new Types.ObjectId(id);
  }
}
