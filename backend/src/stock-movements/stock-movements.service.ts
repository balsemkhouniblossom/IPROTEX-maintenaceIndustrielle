import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Stock, StockDocument } from '../schemas/stock.schema';
import {
  StockMovement,
  StockMovementDocument,
  StockMovementType,
} from '../schemas/stock-movement.schema';
import {
  PartRequest,
  PartRequestDocument,
  PartRequestStatus,
} from '../schemas/part-request.schema';
import { CounterService } from '../counters/counter.service';

interface ApplyStockChangeInput {
  session: ClientSession;
  stockId: Types.ObjectId;
  stockDelta: number;
  reservedDelta: number;
  requireStock?: number;
  requireReserved?: number;
  requireAvailable?: number;
}

interface MovementContext {
  workOrderId?: string;
  partRequestId?: string;
  actorId?: string;
  reason?: string;
}

@Injectable()
export class StockMovementsService {
  constructor(
    @InjectModel(Stock.name) private readonly stockModel: Model<StockDocument>,
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovementDocument>,
    @InjectModel(PartRequest.name)
    private readonly partRequestModel: Model<PartRequestDocument>,
    private readonly counterService: CounterService,
  ) {}

  /**
   * Puts a hold on stock for an approved-but-not-yet-consumed part request.
   * Guarded so a reservation can never exceed what is actually available
   * (`quantite_en_stock - quantite_reservee`) — this is what stops two
   * approvals from over-committing the same physical stock.
   */
  async reserve(
    session: ClientSession,
    input: {
      stockId: string;
      partId: string;
      quantity: number;
      workOrderId: string;
      partRequestId: string;
      actorId?: string;
    },
  ): Promise<StockMovementDocument> {
    const stock = await this.applyStockChange({
      session,
      stockId: new Types.ObjectId(input.stockId),
      stockDelta: 0,
      reservedDelta: input.quantity,
      requireAvailable: input.quantity,
    });

    return this.recordMovement(session, {
      type: StockMovementType.RESERVATION,
      stock,
      partId: input.partId,
      quantityDelta: 0,
      reservedDelta: input.quantity,
      context: {
        workOrderId: input.workOrderId,
        partRequestId: input.partRequestId,
        actorId: input.actorId,
      },
    });
  }

  /**
   * Releases a reservation that will never be consumed (the Technician
   * decided not to use the part after all). Stock itself is untouched —
   * only the hold is lifted, making the quantity available again.
   */
  async cancelReservation(
    session: ClientSession,
    input: {
      stockId: string;
      partId: string;
      quantity: number;
      workOrderId: string;
      partRequestId: string;
      actorId?: string;
      reason?: string;
    },
  ): Promise<StockMovementDocument> {
    const stock = await this.applyStockChange({
      session,
      stockId: new Types.ObjectId(input.stockId),
      stockDelta: 0,
      reservedDelta: -input.quantity,
      requireReserved: input.quantity,
    });

    return this.recordMovement(session, {
      type: StockMovementType.CANCELLATION,
      stock,
      partId: input.partId,
      quantityDelta: 0,
      reservedDelta: -input.quantity,
      context: {
        workOrderId: input.workOrderId,
        partRequestId: input.partRequestId,
        actorId: input.actorId,
        reason: input.reason,
      },
    });
  }

  /**
   * Applies a change in how much of a part has been used against a work
   * order (the signed delta between the new total and whatever was
   * recorded before) — positive is Consumption, negative is a Return.
   * When a Reserved part request exists for this exact (work order, part)
   * pair, consumption draws down that reservation first (decrementing
   * `quantite_en_stock` and `quantite_reservee` together, so availability
   * for *other* requests is unaffected), marking the request Fulfilled
   * once its full reserved quantity has been consumed; only consumption
   * beyond the reservation (or all of it, if there was none) has to pass
   * the availability guard against stock reserved for anyone else.
   */
  async recordUsageChange(
    session: ClientSession,
    input: {
      stockId: string;
      partId: string;
      delta: number;
      workOrderId: string;
      actorId?: string;
    },
  ): Promise<StockMovementDocument> {
    if (input.delta === 0) {
      throw new ConflictException('Stock usage delta must not be zero');
    }

    if (input.delta < 0) {
      // Returning previously-consumed parts back to stock is always safe —
      // it only ever increases quantite_en_stock.
      const returned = -input.delta;
      const stock = await this.applyStockChange({
        session,
        stockId: new Types.ObjectId(input.stockId),
        stockDelta: returned,
        reservedDelta: 0,
      });
      return this.recordMovement(session, {
        type: StockMovementType.RETURN,
        stock,
        partId: input.partId,
        quantityDelta: returned,
        reservedDelta: 0,
        context: { workOrderId: input.workOrderId, actorId: input.actorId },
      });
    }

    const reservation = await this.partRequestModel
      .findOne({
        ot_id: new Types.ObjectId(input.workOrderId),
        part_id: new Types.ObjectId(input.partId),
        status: PartRequestStatus.RESERVED,
      })
      .session(session)
      .exec();

    const covered = reservation ? Math.min(reservation.quantity, input.delta) : 0;
    const extra = input.delta - covered;

    let stock: StockDocument | null = null;

    if (covered > 0) {
      stock = await this.applyStockChange({
        session,
        stockId: new Types.ObjectId(input.stockId),
        stockDelta: -covered,
        reservedDelta: -covered,
        requireStock: covered,
        requireReserved: covered,
      });
    }

    if (extra > 0) {
      stock = await this.applyStockChange({
        session,
        stockId: new Types.ObjectId(input.stockId),
        stockDelta: -extra,
        reservedDelta: 0,
        requireAvailable: extra,
      });
    }

    if (reservation && covered >= reservation.quantity) {
      await this.partRequestModel
        .findOneAndUpdate(
          { _id: reservation._id, status: PartRequestStatus.RESERVED },
          { $set: { status: PartRequestStatus.FULFILLED } },
          { session },
        )
        .exec();
    }

    // stock is guaranteed to be set here: input.delta > 0 forces at least
    // one of covered/extra to be positive.
    return this.recordMovement(session, {
      type: StockMovementType.CONSUMPTION,
      stock: stock as StockDocument,
      partId: input.partId,
      quantityDelta: -input.delta,
      reservedDelta: covered > 0 ? -covered : 0,
      context: {
        workOrderId: input.workOrderId,
        partRequestId: reservation?._id?.toString(),
        actorId: input.actorId,
      },
    });
  }

  /**
   * A manual Admin correction to `quantite_en_stock` (stocktake, damaged
   * goods, etc.) — the only stock mutation with no originating work order.
   * `expectedVersion` is required whenever the stock record already has a
   * version (i.e. it has been touched by this lifecycle before), giving
   * the same optimistic-concurrency guarantee `MaintenancePlansService`
   * uses: a stale edit is rejected with a conflict rather than silently
   * overwriting someone else's more recent change.
   */
  async adjust(
    session: ClientSession,
    input: {
      stockId: string;
      delta: number;
      reason: string;
      actorId?: string;
      expectedVersion?: number;
    },
  ): Promise<StockMovementDocument> {
    if (input.delta === 0) {
      throw new ConflictException('Adjustment delta must not be zero');
    }

    const current = await this.stockModel
      .findById(input.stockId)
      .session(session)
      .exec();
    if (!current) {
      throw new NotFoundException('Stock record not found');
    }
    if (current.version !== undefined) {
      if (input.expectedVersion === undefined) {
        throw new ConflictException(
          'expected_version is required to adjust this stock record',
        );
      }
      if (input.expectedVersion !== current.version) {
        throw new ConflictException(
          'This stock record has changed since you last loaded it; reload and retry',
        );
      }
    }

    const stock = await this.applyStockChange({
      session,
      stockId: current._id,
      stockDelta: input.delta,
      reservedDelta: 0,
      requireAvailable: input.delta < 0 ? -input.delta : undefined,
    });

    return this.recordMovement(session, {
      type: StockMovementType.ADJUSTMENT,
      stock,
      partId: current.part_id.toString(),
      quantityDelta: input.delta,
      reservedDelta: 0,
      context: { actorId: input.actorId, reason: input.reason },
    });
  }

  /**
   * Records the audit entry for a brand-new stock record's starting
   * quantity. The mutation itself already happened via `.create()` (there
   * is no prior version to guard against), so this only ever writes the
   * ledger entry — it never touches the Stock document.
   */
  async recordCreation(
    session: ClientSession,
    input: { stock: StockDocument; partId: string; actorId?: string },
  ): Promise<StockMovementDocument | null> {
    if (input.stock.quantite_en_stock === 0) {
      return null;
    }
    return this.recordMovement(session, {
      type: StockMovementType.ADJUSTMENT,
      stock: input.stock,
      partId: input.partId,
      quantityDelta: input.stock.quantite_en_stock,
      reservedDelta: 0,
      context: { actorId: input.actorId, reason: 'Initial stock on record creation' },
    });
  }

  async listForStock(stockId: string, page: number, limit: number, skip: number) {
    const query = { stock_id: new Types.ObjectId(stockId) };
    const [items, totalItems] = await Promise.all([
      this.stockMovementModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.stockMovementModel.countDocuments(query).exec(),
    ]);
    return { items, totalItems, page, limit };
  }

  private async applyStockChange(
    input: ApplyStockChangeInput,
  ): Promise<StockDocument> {
    const incUpdate: Record<string, number> = { version: 1 };
    if (input.stockDelta !== 0) incUpdate.quantite_en_stock = input.stockDelta;
    if (input.reservedDelta !== 0) incUpdate.quantite_reservee = input.reservedDelta;

    const filter: Record<string, unknown> = { _id: input.stockId };
    if (input.requireStock !== undefined) {
      filter.quantite_en_stock = { $gte: input.requireStock };
    }
    if (input.requireReserved !== undefined) {
      filter.quantite_reservee = { $gte: input.requireReserved };
    }
    if (input.requireAvailable !== undefined) {
      filter.$expr = {
        $gte: [
          { $subtract: ['$quantite_en_stock', '$quantite_reservee'] },
          input.requireAvailable,
        ],
      };
    }

    const updated = await this.stockModel
      .findOneAndUpdate(filter, { $inc: incUpdate }, { new: true, session: input.session })
      .exec();
    if (!updated) {
      throw new ConflictException(
        'Insufficient available stock or reservation for this operation',
      );
    }
    return updated;
  }

  private async recordMovement(
    session: ClientSession,
    input: {
      type: StockMovementType;
      stock: StockDocument;
      partId: string;
      quantityDelta: number;
      reservedDelta: number;
      context: MovementContext;
    },
  ): Promise<StockMovementDocument> {
    const movementId = await this.generateMovementCode();
    const [movement] = await this.stockMovementModel.create(
      [
        {
          movement_id: movementId,
          type: input.type,
          stock_id: input.stock._id,
          part_id: new Types.ObjectId(input.partId),
          quantity_delta: input.quantityDelta,
          reserved_delta: input.reservedDelta,
          quantite_en_stock_after: input.stock.quantite_en_stock,
          quantite_reservee_after: input.stock.quantite_reservee,
          work_order_id: input.context.workOrderId
            ? new Types.ObjectId(input.context.workOrderId)
            : undefined,
          part_request_id: input.context.partRequestId
            ? new Types.ObjectId(input.context.partRequestId)
            : undefined,
          actor_user_id:
            input.context.actorId && Types.ObjectId.isValid(input.context.actorId)
              ? new Types.ObjectId(input.context.actorId)
              : undefined,
          reason: input.context.reason,
        },
      ],
      { session },
    );
    return movement;
  }

  private async generateMovementCode(): Promise<string> {
    const sequence = await this.counterService.getNextSequence('stock_movement');
    return `MOV-${sequence.toString().padStart(6, '0')}`;
  }
}
