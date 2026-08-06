import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { OTPieces, OTPiecesDocument } from '../schemas/ot-pieces.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { CreateOtPieceDto } from './dto/create-ot-piece.dto';
import { UpdateOtPieceDto } from './dto/update-ot-piece.dto';

/**
 * Every write here goes through `StockMovementsService` inside a session so
 * `Stock`/`quantite_reservee` and the `OTPieces` ledger can never desync —
 * this mirrors the exact pattern `TechnicianService.setPartQuantity` already
 * uses for the technician-facing equivalent of this same write. Before this,
 * `update`/`remove` mutated `OTPieces` directly with no stock adjustment and
 * no audit trail (see `DUPLICATE_MODELS_MIGRATION_PLAN.md`); `create` had
 * the same gap even though it wasn't separately called out there.
 */
@Injectable()
export class OtPiecesService {
  constructor(
    @InjectModel(OTPieces.name)
    private readonly otPiecesModel: Model<OTPiecesDocument>,
    @InjectModel(Stock.name)
    private readonly stockModel: Model<StockDocument>,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  async create(
    payload: CreateOtPieceDto,
    actorId?: string,
  ): Promise<OTPiecesDocument> {
    const session = await this.otPiecesModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const partId = new Types.ObjectId(payload.part_id);

        if (payload.quantite > 0) {
          const stock = await this.resolveStockOrThrow(session, partId);
          await this.stockMovementsService.recordUsageChange(session, {
            stockId: stock._id.toString(),
            partId: payload.part_id,
            delta: payload.quantite,
            workOrderId: payload.ot_id,
            actorId,
          });
        }

        const [created] = await this.otPiecesModel.create(
          [
            {
              ot_id: new Types.ObjectId(payload.ot_id),
              part_id: partId,
              quantite: payload.quantite,
            },
          ],
          { session },
        );
        return created;
      });
    } finally {
      await session.endSession();
    }
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<OTPieces>> {
    const [items, totalItems] = await Promise.all([
      this.otPiecesModel
        .find()
        .skip(skip)
        .limit(limit)
        .populate('ot_id')
        .populate('part_id')
        .exec(),
      this.otPiecesModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string) {
    return this.otPiecesModel
      .findById(id)
      .populate('ot_id')
      .populate('part_id')
      .exec();
  }

  async update(
    id: string,
    payload: UpdateOtPieceDto,
    actorId?: string,
  ): Promise<OTPiecesDocument | null> {
    const session = await this.otPiecesModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const existing = await this.otPiecesModel
          .findById(id)
          .session(session)
          .exec();
        if (!existing) {
          return null;
        }

        const nextPartId = payload.part_id
          ? new Types.ObjectId(payload.part_id)
          : existing.part_id;
        const nextQuantite = payload.quantite ?? existing.quantite;
        const partChanged = !nextPartId.equals(existing.part_id);

        if (partChanged) {
          // Reassigning which part this line refers to spans two Stock
          // documents, so it can't be expressed as a single delta: reverse
          // the old part's full contribution, then apply the new part's.
          if (existing.quantite > 0) {
            await this.applyStockDelta(
              session,
              existing.part_id,
              -existing.quantite,
              existing.ot_id.toString(),
              actorId,
            );
          }
          if (nextQuantite > 0) {
            await this.applyStockDelta(
              session,
              nextPartId,
              nextQuantite,
              existing.ot_id.toString(),
              actorId,
            );
          }
        } else if (nextQuantite !== existing.quantite) {
          await this.applyStockDelta(
            session,
            nextPartId,
            nextQuantite - existing.quantite,
            existing.ot_id.toString(),
            actorId,
          );
        }

        existing.part_id = nextPartId;
        existing.quantite = nextQuantite;
        return existing.save({ session });
      });
    } finally {
      await session.endSession();
    }
  }

  async remove(id: string, actorId?: string): Promise<OTPiecesDocument | null> {
    const session = await this.otPiecesModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const existing = await this.otPiecesModel
          .findById(id)
          .session(session)
          .exec();
        if (!existing) {
          return null;
        }

        if (existing.quantite > 0) {
          // Deleting a consumption line returns what it consumed — the same
          // "removal reverses the recorded usage" semantics as reassigning
          // a line away from a part in `update` above.
          await this.applyStockDelta(
            session,
            existing.part_id,
            -existing.quantite,
            existing.ot_id.toString(),
            actorId,
          );
        }

        return this.otPiecesModel.findByIdAndDelete(id).session(session).exec();
      });
    } finally {
      await session.endSession();
    }
  }

  private async applyStockDelta(
    session: ClientSession,
    partId: Types.ObjectId,
    delta: number,
    workOrderId: string,
    actorId?: string,
  ): Promise<void> {
    const stock = await this.resolveStockOrThrow(session, partId);
    await this.stockMovementsService.recordUsageChange(session, {
      stockId: stock._id.toString(),
      partId: partId.toString(),
      delta,
      workOrderId,
      actorId,
    });
  }

  private async resolveStockOrThrow(
    session: ClientSession,
    partId: Types.ObjectId,
  ): Promise<StockDocument> {
    const stock = await this.stockModel
      .findOne({ part_id: partId })
      .session(session)
      .exec();
    if (!stock) {
      throw new NotFoundException('No stock record exists for this part');
    }
    return stock;
  }
}
