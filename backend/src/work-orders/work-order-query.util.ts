import { FilterQuery, Types } from 'mongoose';
import { WorkOrderDocument } from '../schemas/work-order.schema';
import { WorkOrdersQueryDto } from './dto/work-orders-query.dto';
import {
  buildCaseInsensitiveSearchFilter,
  parseCsvParam,
} from '../common/query-params.util';

export const WORK_ORDERS_SORT_ALLOWED_FIELDS = [
  'date_created',
  'due_date',
  'priorite',
  'status',
] as const;

export const WORK_ORDERS_DEFAULT_SORT: Record<string, 1 | -1> = {
  date_created: -1,
};

export function buildWorkOrdersFilter(
  query: WorkOrdersQueryDto = {},
): FilterQuery<WorkOrderDocument> {
  const filter: FilterQuery<WorkOrderDocument> = {};

  const statuses = parseCsvParam(query.status);
  if (statuses) filter.status = { $in: statuses };

  const priorities = parseCsvParam(query.priority);
  if (priorities) filter.priorite = { $in: priorities };

  if (query.machineId && Types.ObjectId.isValid(query.machineId)) {
    filter.machine_id = new Types.ObjectId(query.machineId);
  }
  if (query.technicianId && Types.ObjectId.isValid(query.technicianId)) {
    filter.technician_id = new Types.ObjectId(query.technicianId);
  }

  if (query.dateFrom || query.dateTo) {
    filter.date_created = {
      ...(query.dateFrom ? { $gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { $lte: new Date(query.dateTo) } : {}),
    };
  }

  if (query.search) {
    const searchRegex = buildCaseInsensitiveSearchFilter(query.search);
    filter.$or = [
      { ot_id: searchRegex },
      { description: searchRegex },
      { code_panne: searchRegex },
    ];
  }

  return filter;
}
