import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  StockMovement,
  StockMovementDocument,
  StockMovementType,
} from '../../schemas/stock-movement.schema';
import { Catalogue, CatalogueDocument } from '../../schemas/catalogue.schema';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import { buildDateRangeFilter } from '../report-date-filter.util';
import {
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

/**
 * Parts consumed (via `StockMovement` of type `consumption`) multiplied by
 * each part's `Catalogue.unit_cost`, attributed to the machine of the
 * work order the consumption was recorded against, summed per machine.
 * There is no cost/price concept anywhere else in this codebase to reuse
 * or duplicate — `unit_cost` is a new optional `Catalogue` field precisely
 * so this report has real data to work from rather than a fabricated
 * number. A part with no `unit_cost` set contributes 0 to every total
 * (never estimated), and `parts_with_no_cost` in the summary makes that
 * gap visible rather than silently under-reporting.
 */
@Injectable()
export class MaintenanceCostsReportProvider implements ReportDataProvider {
  readonly type = ReportType.MAINTENANCE_COSTS;

  constructor(
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovementDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
  ) {}

  async buildDataset(params: ReportParams): Promise<ReportDataset> {
    const dateFilter = buildDateRangeFilter(params.dateFrom, params.dateTo);

    const movements = await this.stockMovementModel
      .find({
        type: StockMovementType.CONSUMPTION,
        work_order_id: { $exists: true, $ne: null },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      })
      .exec();

    if (movements.length === 0) {
      return {
        title: 'Maintenance Costs Report',
        generatedAt: new Date(),
        parameters: { ...params },
        columns: [
          { key: 'machine', label: 'Machine' },
          { key: 'parts_consumed', label: 'Parts Consumed' },
          { key: 'total_cost', label: 'Total Cost' },
        ],
        rows: [],
        summary: [{ label: 'Total cost', value: 0 }],
      };
    }

    const partIds = [...new Set(movements.map((m) => m.part_id.toString()))];
    const parts = await this.catalogueModel
      .find({ _id: { $in: partIds } })
      .exec();
    const costByPartId = new Map(
      parts.map((p) => [p._id.toString(), p.unit_cost ?? 0]),
    );
    const partsWithNoCost = parts.filter(
      (p) => typeof p.unit_cost !== 'number',
    ).length;

    const workOrderIds = [
      ...new Set(movements.map((m) => m.work_order_id!.toString())),
    ];
    const workOrders = await this.workOrderModel
      .find({
        _id: { $in: workOrderIds },
        ...(params.machineId
          ? { machine_id: new Types.ObjectId(params.machineId) }
          : {}),
      })
      .select({ machine_id: 1 })
      .exec();
    const machineIdByWorkOrderId = new Map(
      workOrders.map((wo) => [wo._id.toString(), wo.machine_id.toString()]),
    );

    const costByMachineId = new Map<
      string,
      { cost: number; partsConsumed: number }
    >();
    for (const movement of movements) {
      const machineId = machineIdByWorkOrderId.get(
        movement.work_order_id!.toString(),
      );
      if (!machineId) continue; // filtered out by machineId scope, or work order not found

      const unitCost = costByPartId.get(movement.part_id.toString()) ?? 0;
      const quantity = Math.abs(movement.quantity_delta);
      const entry = costByMachineId.get(machineId) ?? {
        cost: 0,
        partsConsumed: 0,
      };
      entry.cost += unitCost * quantity;
      entry.partsConsumed += quantity;
      costByMachineId.set(machineId, entry);
    }

    const machines = await this.machineModel
      .find({
        _id: {
          $in: [...costByMachineId.keys()].map((id) => new Types.ObjectId(id)),
        },
      })
      .select({ machine_id: 1, reference: 1 })
      .exec();
    const machineLabelById = new Map(
      machines.map((m) => [
        m._id.toString(),
        m.reference ? `${m.machine_id} (${m.reference})` : m.machine_id,
      ]),
    );

    const rows = [...costByMachineId.entries()]
      .map(([machineId, entry]) => ({
        machine: machineLabelById.get(machineId) ?? machineId,
        parts_consumed: entry.partsConsumed,
        total_cost: Math.round(entry.cost * 100) / 100,
      }))
      .sort((a, b) => b.total_cost - a.total_cost);

    const totalCost = rows.reduce((sum, row) => sum + row.total_cost, 0);

    return {
      title: 'Maintenance Costs Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'machine', label: 'Machine' },
        { key: 'parts_consumed', label: 'Parts Consumed' },
        { key: 'total_cost', label: 'Total Cost' },
      ],
      rows,
      summary: [
        { label: 'Total cost', value: Math.round(totalCost * 100) / 100 },
        { label: 'Machines with consumption', value: rows.length },
        {
          label: 'Parts consumed with no unit_cost set',
          value: partsWithNoCost,
        },
      ],
    };
  }
}
