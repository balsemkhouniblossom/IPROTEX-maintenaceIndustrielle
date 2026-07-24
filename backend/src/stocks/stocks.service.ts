import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Stock, StockDocument } from '../schemas/stock.schema';
import {
  StockMovement,
  StockMovementDocument,
} from '../schemas/stock-movement.schema';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { StockMovementsService } from '../stock-movements/stock-movements.service';

@Injectable()
export class StocksService {
  constructor(
    @InjectModel(Stock.name) private readonly stockModel: Model<StockDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovementDocument>,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  async create(dto: CreateStockDto, actorId?: string) {
    // Referential integrity: a Stock record must never point at a part
    // that doesn't exist — that is exactly the "orphan stock record" this
    // lifecycle is meant to prevent.
    const part = await this.catalogueModel.findById(dto.part_id).exec();
    if (!part) {
      throw new BadRequestException('Referenced catalogue part does not exist');
    }

    const session = await this.stockModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const [stock] = await this.stockModel.create(
          [
            {
              stock_id: dto.stock_id,
              part_id: part._id,
              quantite_en_stock: dto.quantite_en_stock,
              quantite_reservee: 0,
              seuil_alerte_stock: dto.seuil_alerte_stock,
              quantite_minimale: dto.quantite_minimale,
              emplacement: dto.emplacement,
              version: 1,
            },
          ],
          { session },
        );

        await this.stockMovementsService.recordCreation(session, {
          stock,
          partId: part._id.toString(),
          actorId,
        });

        return stock;
      });
    } finally {
      await session.endSession();
    }
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<Stock>> {
    const [items, totalItems] = await Promise.all([
      this.stockModel.find().skip(skip).limit(limit).populate('part_id').exec(),
      this.stockModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  findOne(id: string) {
    return this.stockModel.findById(id).populate('part_id').exec();
  }

  getMovements(id: string, page: number, limit: number, skip: number) {
    return this.stockMovementsService.listForStock(id, page, limit, skip);
  }

  update(id: string, dto: UpdateStockDto) {
    return this.stockModel.findByIdAndUpdate(id, dto, { new: true }).exec();
  }

  async adjust(id: string, dto: AdjustStockDto, actorId?: string) {
    const session = await this.stockModel.db.startSession();
    try {
      return await session.withTransaction(() =>
        this.stockMovementsService.adjust(session, {
          stockId: id,
          delta: dto.delta,
          reason: dto.reason,
          actorId,
          expectedVersion: dto.expected_version,
        }),
      );
    } finally {
      await session.endSession();
    }
  }

  async remove(id: string) {
    const stock = await this.stockModel.findById(id).exec();
    if (!stock) {
      throw new NotFoundException('Stock record not found');
    }
    if (stock.quantite_en_stock !== 0 || stock.quantite_reservee !== 0) {
      throw new ConflictException(
        'Stock must be fully adjusted down to zero (and have no active reservations) before it can be deleted',
      );
    }
    const hasHistory = await this.stockMovementModel
      .exists({ stock_id: stock._id })
      .exec();
    if (hasHistory) {
      throw new ConflictException(
        'This stock record has movement history and cannot be deleted, to avoid orphaning its audit trail',
      );
    }

    return this.stockModel.findByIdAndDelete(id).exec();
  }
}
