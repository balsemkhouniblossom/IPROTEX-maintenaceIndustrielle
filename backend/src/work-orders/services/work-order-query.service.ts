import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SAFE_USER_PROJECTION } from '../../users/safe-user-projection';
import {
  PaginatedResponse,
  toPaginatedResponse,
} from '../../common/pagination';
import { parseSortParam } from '../../common/query-params.util';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { WorkOrdersQueryDto } from '../dto/work-orders-query.dto';
import {
  WORK_ORDERS_DEFAULT_SORT,
  WORK_ORDERS_SORT_ALLOWED_FIELDS,
  buildWorkOrdersFilter,
} from '../work-order-query.util';

@Injectable()
export class WorkOrderQueryService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
  ) {}

  async findAll(
    page: number,
    limit: number,
    skip: number,
    query: WorkOrdersQueryDto = {},
  ): Promise<PaginatedResponse<WorkOrder>> {
    const filter = buildWorkOrdersFilter(query);
    const sort = parseSortParam(
      query.sort,
      WORK_ORDERS_SORT_ALLOWED_FIELDS,
      WORK_ORDERS_DEFAULT_SORT,
    );

    try {
      const [items, totalItems] = await Promise.all([
        this.workOrderModel
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .populate('machine_id')
          .populate('module_id')
          .populate('technician_id', SAFE_USER_PROJECTION)
          .exec(),
        this.workOrderModel.countDocuments(filter).exec(),
      ]);

      return toPaginatedResponse(items, totalItems, page, limit);
    } catch (error) {
      console.warn('Failed to populate work order references:', error);
      const [items, totalItems] = await Promise.all([
        this.workOrderModel
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .exec(),
        this.workOrderModel.countDocuments(filter).exec(),
      ]);

      return toPaginatedResponse(items, totalItems, page, limit);
    }
  }

  async findOne(id: string): Promise<any> {
    try {
      return await this.workOrderModel
        .findById(id)
        .populate('machine_id')
        .populate('module_id')
        .populate('technician_id', SAFE_USER_PROJECTION)
        .exec();
    } catch (error) {
      console.warn(
        'Failed to populate work order references for id:',
        id,
        error,
      );
      return this.workOrderModel.findById(id).exec();
    }
  }
}
