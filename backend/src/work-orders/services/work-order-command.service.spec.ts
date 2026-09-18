import { Types } from 'mongoose';
import { ConflictException } from '@nestjs/common';
import { WorkOrderCommandService } from './work-order-command.service';

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

describe('WorkOrderCommandService', () => {
  let service: WorkOrderCommandService;
  let workOrderModel: {
    db: { startSession: jest.Mock<any, any, any> };
    findByIdAndUpdate: jest.Mock<any, any, any>;
    findByIdAndDelete: jest.Mock<any, any, any>;
  } & jest.Mock<any, any, any>;
  let counterService: { getNextSequence: jest.Mock<any, any, any> };
  let notificationService: { notifyCreated: jest.Mock<any, any, any> };
  let reportService: { ensureAutoInterventionReport: jest.Mock<any, any, any> };
  let preventiveSchedulingService: {
    assertNoDuplicatePreventiveOccurrence: jest.Mock<any, any, any>;
    ensureNextPreventiveWorkOrder: jest.Mock<any, any, any>;
  };
  let kpiService: { updateKpiForMachine: jest.Mock<any, any, any> };

  beforeEach(() => {
    workOrderModel = Object.assign(jest.fn(), {
      db: { startSession: jest.fn() },
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
    });
    counterService = { getNextSequence: jest.fn() };
    notificationService = { notifyCreated: jest.fn() };
    reportService = { ensureAutoInterventionReport: jest.fn() };
    preventiveSchedulingService = {
      assertNoDuplicatePreventiveOccurrence: jest.fn(),
      ensureNextPreventiveWorkOrder: jest.fn(),
    };
    kpiService = { updateKpiForMachine: jest.fn() };
    service = new WorkOrderCommandService(
      workOrderModel as any,
      counterService as any,
      notificationService as any,
      reportService as any,
      preventiveSchedulingService as any,
      kpiService as any,
    );
  });

  describe('create', () => {
    it('generates ot_id when not provided', async () => {
      counterService.getNextSequence.mockResolvedValue(42);
      const dto = { type_maintenance: 'corrective' } as any;
      const session = {
        withTransaction: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId(), status: 'pending' }),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      const savedWO = { _id: new Types.ObjectId(), status: 'pending' };
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(savedWO),
      }));

      await service.create(dto);
      expect(counterService.getNextSequence).toHaveBeenCalledWith('work_order');
    });

    it('uses provided ot_id as-is', async () => {
      const dto = { ot_id: 'WO-001', type_maintenance: 'preventive' } as any;
      const session = {
        withTransaction: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId() }),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      }));

      await service.create(dto);
      expect(counterService.getNextSequence).not.toHaveBeenCalled();
    });

    it('sets date_created when not provided', async () => {
      const dto = { ot_id: 'WO-001' } as any;
      const session = {
        withTransaction: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId() }),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));

      await service.create(dto);
      expect(dto.date_created).toBeDefined();
    });

    it('derives due_date from date_start', async () => {
      const dto = { ot_id: 'WO-001', date_start: '2026-01-15' } as any;
      const session = {
        withTransaction: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId() }),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));

      await service.create(dto);
      expect(dto.due_date).toBe('2026-01-15');
    });

    it('derives scheduled_date from due_date', async () => {
      const dto = { ot_id: 'WO-001', due_date: '2026-02-01' } as any;
      const session = {
        withTransaction: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId() }),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));

      await service.create(dto);
      expect(dto.scheduled_date).toBe('2026-02-01');
    });

    it('calls preventive duplicate check', async () => {
      const dto = {
        ot_id: 'WO-001',
        machine_id: 'm1',
        plan_id: 'p1',
        due_date: '2026-02-01',
      } as any;
      const session = {
        withTransaction: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId(), status: 'pending' }),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));

      await service.create(dto);
      expect(
        preventiveSchedulingService.assertNoDuplicatePreventiveOccurrence,
      ).toHaveBeenCalled();
    });

    it('ends session after create', async () => {
      const dto = { ot_id: 'WO-001' } as any;
      const session = {
        withTransaction: jest
          .fn()
          .mockResolvedValue({ _id: new Types.ObjectId() }),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue({}),
      }));

      await service.create(dto);
      expect(session.endSession).toHaveBeenCalled();
    });

    it('returns WorkOrderResponse', async () => {
      const dto = { ot_id: 'WO-001' } as any;
      const savedWO = {
        _id: new Types.ObjectId(),
        status: 'pending',
        ot_id: 'WO-001',
      };
      const session = {
        withTransaction: jest.fn().mockResolvedValue(savedWO),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(savedWO),
      }));

      const result = await service.create(dto);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('ot_id');
    });
  });

  describe('update', () => {
    it('returns null when work order not found', async () => {
      const session = {
        withTransaction: jest.fn().mockResolvedValue(null),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const result = await service.update('nonexistent', {
        status: 'completed',
      });
      expect(result).toBeNull();
    });

    it('returns updated work order', async () => {
      const updatedWO = { _id: new Types.ObjectId(), status: 'pending' };
      const session = {
        withTransaction: jest.fn().mockResolvedValue(updatedWO),
        endSession: jest.fn(),
      };
      workOrderModel.db.startSession.mockResolvedValue(session);
      workOrderModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedWO),
      });

      const result = await service.update('wo-1', { status: 'pending' });
      expect(result).not.toBeNull();
    });
  });

  describe('remove', () => {
    it('deletes and returns work order', async () => {
      const removed = { _id: new Types.ObjectId(), ot_id: 'WO-001' };
      workOrderModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(removed),
      });
      const result = await service.remove('wo-1');
      expect(result).not.toBeNull();
      expect(result!.ot_id).toBe('WO-001');
    });

    it('returns null when nothing to delete', async () => {
      workOrderModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      const result = await service.remove('nonexistent');
      expect(result).toBeNull();
    });
  });
});
