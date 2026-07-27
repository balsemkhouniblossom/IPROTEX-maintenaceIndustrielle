import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  StockMovement,
  StockMovementDocument,
} from '../../schemas/stock-movement.schema';
import { buildDateRangeFilter } from '../report-date-filter.util';
import {
  ReportActor,
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

const DEFAULT_LIMIT = 2000;

/** Every stock movement in the requested date range, joined to its part/actor/work order — the same ledger `StockMovementsService.listForStock` reads per-stock, here date-ranged across the whole inventory (Admin-only, matching this report type's role scoping). */
@Injectable()
export class StockMovementsReportProvider implements ReportDataProvider {
  readonly type = ReportType.STOCK_MOVEMENTS;

  constructor(
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovementDocument>,
  ) {}

  async buildDataset(params: ReportParams): Promise<ReportDataset> {
    const dateFilter = buildDateRangeFilter(params.dateFrom, params.dateTo);
    const filter: FilterQuery<StockMovementDocument> = dateFilter ? { createdAt: dateFilter } : {};

    const movements = await this.stockMovementModel
      .find(filter)
      .populate('stock_id', 'stock_id')
      .populate('part_id', 'nom_piece ref_constructeur')
      .populate('actor_user_id', 'nom_complet')
      .populate('work_order_id', 'ot_id')
      .sort({ createdAt: -1 })
      .limit(params.limit ?? DEFAULT_LIMIT)
      .exec();

    const rows = movements.map((movement) => {
      const stock = movement.stock_id as unknown as { stock_id?: string };
      const part = movement.part_id as unknown as { nom_piece?: string; ref_constructeur?: string };
      const actor = movement.actor_user_id as unknown as { nom_complet?: string } | undefined;
      const workOrder = movement.work_order_id as unknown as { ot_id?: string } | undefined;
      const doc = movement as unknown as { createdAt?: Date };

      return {
        date: doc.createdAt ? doc.createdAt.toISOString() : '',
        movement: movement.movement_id,
        type: movement.type,
        stock: stock?.stock_id ?? '',
        part: part?.nom_piece ?? part?.ref_constructeur ?? '',
        quantity_delta: movement.quantity_delta,
        reserved_delta: movement.reserved_delta,
        quantity_after: movement.quantite_en_stock_after,
        work_order: workOrder?.ot_id ?? '',
        actor: actor?.nom_complet ?? '',
        reason: movement.reason ?? '',
      };
    });

    return {
      title: 'Stock Movements Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'movement', label: 'Movement ID' },
        { key: 'type', label: 'Type' },
        { key: 'stock', label: 'Stock' },
        { key: 'part', label: 'Part' },
        { key: 'quantity_delta', label: 'Quantity Delta' },
        { key: 'reserved_delta', label: 'Reserved Delta' },
        { key: 'quantity_after', label: 'Quantity After' },
        { key: 'work_order', label: 'Work Order' },
        { key: 'actor', label: 'Actor' },
        { key: 'reason', label: 'Reason' },
      ],
      rows,
      summary: [{ label: 'Total movements', value: rows.length }],
    };
  }
}
