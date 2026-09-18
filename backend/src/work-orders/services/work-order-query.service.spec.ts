import { Types } from 'mongoose';
import { WorkOrderQueryService } from './work-order-query.service';

function createQuery<T>(result: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
    and: jest.fn().mockReturnThis(),
  };
}

describe('WorkOrderQueryService', () => {
  let service: WorkOrderQueryService;
  let workOrderModel: {
    find: jest.Mock<any, any, any>;
    countDocuments: jest.Mock<any, any, any>;
    findById: jest.Mock<any, any, any>;
  };

  beforeEach(() => {
    workOrderModel = {
      find: jest.fn(),
      countDocuments: jest.fn(),
      findById: jest.fn(),
    };
    service = new WorkOrderQueryService(workOrderModel as any);
  });

  describe('findAll', () => {
    it('returns paginated work orders', async () => {
      const mockWO = { _id: new Types.ObjectId(), ot_id: 'WO-001' };
      const queryBuilder = createQuery([mockWO]);
      const countQuery = createQuery(1);
      workOrderModel.find.mockReturnValue(queryBuilder);
      workOrderModel.countDocuments.mockReturnValue(countQuery);

      const result = await service.findAll(1, 10, 0, {});

      expect(result.items).toHaveLength(1);
      expect(result.totalItems).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('handles empty results', async () => {
      const queryBuilder = createQuery([]);
      const countQuery = createQuery(0);
      workOrderModel.find.mockReturnValue(queryBuilder);
      workOrderModel.countDocuments.mockReturnValue(countQuery);

      const result = await service.findAll(1, 10, 0, {});

      expect(result.items).toHaveLength(0);
      expect(result.totalItems).toBe(0);
    });

    it('falls back without populate on error', async () => {
      const mockWO = { _id: new Types.ObjectId() };
      const rejectedQuery = {
        ...createQuery([mockWO]),
        exec: jest.fn().mockRejectedValue(new Error('populate error')),
      };
      workOrderModel.find.mockReturnValueOnce(rejectedQuery);
      workOrderModel.find.mockReturnValue(createQuery([mockWO]));
      workOrderModel.countDocuments.mockReturnValue(createQuery(1));

      const result = await service.findAll(1, 10, 0, {});
      expect(result.items).toHaveLength(1);
    });

    it('passes page, limit, skip to query', async () => {
      const queryBuilder = createQuery([]);
      const countQuery = createQuery(0);
      workOrderModel.find.mockReturnValue(queryBuilder);
      workOrderModel.countDocuments.mockReturnValue(countQuery);

      await service.findAll(2, 25, 50, {});
      expect(queryBuilder.skip).toHaveBeenCalledWith(50);
      expect(queryBuilder.limit).toHaveBeenCalledWith(25);
    });
  });

  describe('findOne', () => {
    it('returns a work order by id with populate', async () => {
      const mockWO = { _id: new Types.ObjectId(), ot_id: 'WO-001' };
      workOrderModel.findById.mockResolvedValue(mockWO);

      const result = await service.findOne(mockWO._id.toString());
      expect(result).not.toBeNull();
    });

    it('returns null when work order not found', async () => {
      workOrderModel.findById.mockResolvedValue(null);
      const result = await service.findOne('non-existent-id');
      expect(result).toBeNull();
    });

    it('falls back without populate on error', async () => {
      const rejected = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('populate error')),
      };
      const resolved = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      };
      workOrderModel.findById.mockReturnValueOnce(rejected);
      workOrderModel.findById.mockReturnValue(resolved);
      const result = await service.findOne('some-id');
      expect(result).not.toBeNull();
    });

    it('logs warning on error', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const rejected = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('test error')),
      };
      const resolved = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      };
      workOrderModel.findById.mockReturnValueOnce(rejected);
      workOrderModel.findById.mockReturnValue(resolved);
      await service.findOne('test-id');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
