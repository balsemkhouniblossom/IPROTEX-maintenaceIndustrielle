import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { Catalogue, CatalogueDocument } from '../../schemas/catalogue.schema';
import { Stock, StockDocument } from '../../schemas/stock.schema';
import {
  PartRequest,
  PartRequestDocument,
  PartRequestStatus,
} from '../../schemas/part-request.schema';
import { CounterService } from '../../counters/counter.service';
import { StockMovementsService } from '../../stock-movements/stock-movements.service';
import { WorkOrderNotificationService } from './work-order-notification.service';

export interface PartRequestForOperatorInput {
  operatorId: string;
  workOrderId: string;
  partId: string;
  quantity: number;
}

export interface DecidePartRequestInput {
  requestId: string;
  decision: 'approve' | 'reject' | 'cancel';
  deciderId: string;
  reason?: string;
}

const PART_REQUEST_BLOCKED_STATUSES = new Set([
  'completed',
  'validated',
  'rejected',
  'cancelled',
  'canceled',
  'CLOTURE',
  'ANNULE',
]);

const PART_REQUEST_DECISION_RULES: Record<
  'approve' | 'reject' | 'cancel',
  { from: PartRequestStatus; to: PartRequestStatus }
> = {
  approve: { from: PartRequestStatus.PENDING, to: PartRequestStatus.RESERVED },
  reject: { from: PartRequestStatus.PENDING, to: PartRequestStatus.CANCELLED },
  cancel: { from: PartRequestStatus.RESERVED, to: PartRequestStatus.CANCELLED },
};

/**
 * Owns the Work Order-side spare-parts request lifecycle: raising a
 * request, and deciding it (approve/reject/cancel). Stock is only ever
 * mutated through `StockMovementsService` (reserve/cancelReservation),
 * which is also the sole owner of stock movement ledger writes and the
 * atomic, race-safe stock counter updates — this service never touches
 * `quantite_en_stock`/`quantite_reservee` directly. Actual consumption of a
 * reserved request happens later via the Technician's own transactional
 * flow (`TechnicianService.setPartQuantity` -> `StockMovementsService.
 * recordUsageChange`), which is out of scope here.
 */
@Injectable()
export class WorkOrderPartsService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(PartRequest.name)
    private readonly partRequestModel: Model<PartRequestDocument>,
    @InjectModel(Stock.name)
    private readonly stockModel: Model<StockDocument>,
    private readonly counterService: CounterService,
    private readonly stockMovementsService: StockMovementsService,
    private readonly notificationService: WorkOrderNotificationService,
  ) {}

  /**
   * Records an Operator's request for spare parts against an existing
   * corrective work order they own. This never touches Stock — it only
   * stores a pending signal. Stock is only ever mutated later by the
   * Technician's own transactional consumption flow
   * (TechnicianService.setPartQuantity), once the part is actually approved
   * or used; this method has no code path that writes to the Stock
   * collection at all.
   */
  async requestPartsForOperator(
    input: PartRequestForOperatorInput,
  ): Promise<PartRequestDocument> {
    if (!Types.ObjectId.isValid(input.workOrderId)) {
      throw new BadRequestException('Invalid work_order_id');
    }
    if (!Types.ObjectId.isValid(input.partId)) {
      throw new BadRequestException('Invalid part_id');
    }
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }

    const workOrderObjectId = new Types.ObjectId(input.workOrderId);
    const operatorObjectId = new Types.ObjectId(input.operatorId);
    const partObjectId = new Types.ObjectId(input.partId);

    const workOrder = await this.workOrderModel
      .findById(workOrderObjectId)
      .exec();
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    if (!(workOrder.type_maintenance || '').toLowerCase().includes('correct')) {
      throw new BadRequestException(
        'Only corrective work orders can receive part requests through this endpoint',
      );
    }
    if (workOrder.technician_id?.toString() !== input.operatorId) {
      throw new ForbiddenException('This work order is not assigned to you');
    }
    if (PART_REQUEST_BLOCKED_STATUSES.has(workOrder.status)) {
      throw new ConflictException(
        'Parts cannot be requested for a work order in this status',
      );
    }

    const part = await this.catalogueModel.findById(partObjectId).exec();
    if (!part) {
      throw new NotFoundException('Part not found');
    }

    const existingActive = await this.partRequestModel
      .findOne({
        ot_id: workOrder._id,
        part_id: part._id,
        status: {
          $in: [PartRequestStatus.PENDING, PartRequestStatus.RESERVED],
        },
      })
      .exec();
    if (existingActive) {
      throw new ConflictException(
        'There is already an active parts request for this part on this work order',
      );
    }

    try {
      const [request] = await this.partRequestModel.create([
        {
          request_id: await this.generatePartRequestCode(),
          ot_id: workOrder._id,
          part_id: part._id,
          quantity: input.quantity,
          requested_by: operatorObjectId,
          status: PartRequestStatus.PENDING,
          requested_at: new Date(),
        },
      ]);
      await this.notificationService.notifyPartRequestCreated({
        requestId: request._id.toString(),
        otId: workOrder.ot_id,
        workOrderId: workOrder._id.toString(),
      });
      return request;
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          'There is already an active parts request for this part on this work order',
        );
      }
      throw error;
    }
  }

  /**
   * Decides a part request: 'approve' (Pending -> Reserved) puts a
   * transactional hold on Stock via `StockMovementsService.reserve`,
   * 'reject' (Pending -> Cancelled) never touches Stock at all (nothing
   * was ever held), and 'cancel' (Reserved -> Cancelled) releases a
   * reservation that will not be consumed after all. The PartRequest
   * status flip and the Stock movement always happen inside one Mongo
   * transaction, so the ledger and the request's status can never drift
   * apart — either both change or neither does. The atomic status-guarded
   * update on the request itself makes a double-decision (two people
   * deciding, or cancelling, at once) fail safe: whichever call wins the
   * race is the one that gets applied.
   */
  async decidePartRequest(
    input: DecidePartRequestInput,
  ): Promise<PartRequestDocument> {
    if (!Types.ObjectId.isValid(input.requestId)) {
      throw new BadRequestException('Invalid request id');
    }

    const existing = await this.partRequestModel
      .findById(input.requestId)
      .exec();
    if (!existing) {
      throw new NotFoundException('Part request not found');
    }

    const rule = PART_REQUEST_DECISION_RULES[input.decision];
    if (!rule) {
      throw new BadRequestException(`Unknown decision: ${input.decision}`);
    }
    if (existing.status !== rule.from) {
      throw new ConflictException(
        `Cannot ${input.decision} a part request in "${existing.status}" status`,
      );
    }

    let stock: StockDocument | null = null;
    if (input.decision === 'approve' || input.decision === 'cancel') {
      stock = await this.stockModel
        .findOne({ part_id: existing.part_id })
        .exec();
      if (!stock) {
        throw new NotFoundException('No stock record exists for this part');
      }
    }

    const session = await this.partRequestModel.db.startSession();
    let updated: PartRequestDocument | null;
    try {
      updated = await session.withTransaction(async () => {
        const result = await this.partRequestModel
          .findOneAndUpdate(
            { _id: existing._id, status: rule.from },
            { $set: { status: rule.to } },
            { new: true, session },
          )
          .exec();
        if (!result) {
          throw new ConflictException(
            `Cannot ${input.decision} a part request in "${existing.status}" status`,
          );
        }

        if (input.decision === 'approve' && stock) {
          await this.stockMovementsService.reserve(session, {
            stockId: stock._id.toString(),
            partId: existing.part_id.toString(),
            quantity: existing.quantity,
            workOrderId: existing.ot_id.toString(),
            partRequestId: existing._id.toString(),
            actorId: input.deciderId,
          });
        } else if (input.decision === 'cancel' && stock) {
          await this.stockMovementsService.cancelReservation(session, {
            stockId: stock._id.toString(),
            partId: existing.part_id.toString(),
            quantity: existing.quantity,
            workOrderId: existing.ot_id.toString(),
            partRequestId: existing._id.toString(),
            actorId: input.deciderId,
            reason: input.reason,
          });
        }

        return result;
      });
    } finally {
      await session.endSession();
    }

    const finalRequest = updated;

    await this.notificationService.notifyPartRequestDecision({
      requestId: finalRequest._id.toString(),
      decision: input.decision,
      requesterUserId: finalRequest.requested_by.toString(),
      workOrderId: finalRequest.ot_id.toString(),
    });

    return finalRequest;
  }

  private async generatePartRequestCode() {
    const sequence = await this.counterService.getNextSequence('part_request');
    return `PR-${sequence.toString().padStart(6, '0')}`;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === 11000
    );
  }
}
