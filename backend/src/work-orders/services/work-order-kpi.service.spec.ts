import { Types } from 'mongoose';
import { COMPLETED_WORK_ORDER_STATUSES } from '../../common/work-order-status';
import { CounterService } from '../../counters/counter.service';
import { MttrSourceService } from '../../kpi/mttr-source.service';
import { WorkOrderKpiService } from './work-order-kpi.service';

function createModelFindQuery<T>(result: T) {
  return {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
    and: jest.fn().mockReturnThis(),
  };
}

describe('WorkOrderKpiService', () => {
  let service: WorkOrderKpiService;
  let workOrderModel: { find: jest.Mock<any, any, any> };
  let kpiModel: {
    findOne: jest.Mock<any, any, any>;
    findByIdAndUpdate: jest.Mock<any, any, any>;
    create: jest.Mock<any, any, any>;
  };
  let counterService: { getNextSequence: jest.Mock<any, any, any> };
  let mttrSource: { calculate: jest.Mock<any, any, any> };

  beforeEach(() => {
    workOrderModel = { find: jest.fn() };
    kpiModel = {
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };
    counterService = { getNextSequence: jest.fn() };
    mttrSource = { calculate: jest.fn() };
    service = new WorkOrderKpiService(
      workOrderModel as any,
      kpiModel as any,
      counterService as any,
      mttrSource as any,
    );
  });

  function makeExistingKpiQuery(result: any) {
    return {
      sort: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  function makeFindByIdAndUpdate(result: any) {
    return { exec: jest.fn().mockResolvedValue(result) };
  }

  describe('updateKpiForMachine', () => {
    it('returns early when machineId is missing', async () => {
      await service.updateKpiForMachine(undefined);
      expect(workOrderModel.find).not.toHaveBeenCalled();
    });

    it('returns early when no orders for machine', async () => {
      workOrderModel.find.mockReturnValue(createModelFindQuery([]));
      await service.updateKpiForMachine(new Types.ObjectId().toString());
      expect(kpiModel.findOne).not.toHaveBeenCalled();
    });

    it('calculates and updates KPI for machine with completed orders', async () => {
      const machineId = new Types.ObjectId().toString();
      const orders = [
        {
          _id: new Types.ObjectId(),
          status: COMPLETED_WORK_ORDER_STATUSES[0],
          type_maintenance: 'corrective',
          date_closed: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          status: COMPLETED_WORK_ORDER_STATUSES[0],
          type_maintenance: 'corrective',
          date_closed: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'preventive',
          date_created: new Date(),
        },
      ] as any;
      workOrderModel.find.mockReturnValue(createModelFindQuery(orders));
      mttrSource.calculate.mockResolvedValue({ summary: { mttrMinutes: 120 } });
      kpiModel.findOne.mockReturnValue(makeExistingKpiQuery(null));
      counterService.getNextSequence.mockResolvedValue(5);

      await service.updateKpiForMachine(machineId);

      expect(kpiModel.create).toHaveBeenCalled();
      const payload = kpiModel.create.mock.calls[0][0][0];
      expect(payload.machine_id).toEqual(new Types.ObjectId(machineId));
      expect(payload.completed_corrective).toBe(2);
      expect(payload.completed_preventive).toBe(1);
    });

    it('updates existing KPI document', async () => {
      const machineId = new Types.ObjectId().toString();
      const orders = [
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'corrective',
          date_closed: new Date(),
        },
      ] as any;
      workOrderModel.find.mockReturnValue(createModelFindQuery(orders));
      mttrSource.calculate.mockResolvedValue({ summary: { mttrMinutes: 60 } });
      kpiModel.findOne.mockReturnValue(
        makeExistingKpiQuery({ _id: new Types.ObjectId(), kpi_id: 'KPI-001' }),
      );
      kpiModel.findByIdAndUpdate.mockReturnValue(makeFindByIdAndUpdate(null));

      await service.updateKpiForMachine(machineId);
      expect(kpiModel.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('generates KPI code when no existing KPI', async () => {
      const machineId = new Types.ObjectId().toString();
      const orders = [
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'corrective',
          date_closed: new Date(),
        },
      ] as any;
      workOrderModel.find.mockReturnValue(createModelFindQuery(orders));
      mttrSource.calculate.mockResolvedValue({ summary: { mttrMinutes: 60 } });
      kpiModel.findOne.mockReturnValue(makeExistingKpiQuery(null));
      counterService.getNextSequence.mockResolvedValue(5);

      await service.updateKpiForMachine(machineId);
      expect(counterService.getNextSequence).toHaveBeenCalledWith('kpi');
    });

    it('handles maintenance type correctly', async () => {
      const machineId = new Types.ObjectId().toString();
      const orders = [
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'corrective',
          date_closed: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'preventive',
          date_closed: new Date(),
        },
      ] as any;
      workOrderModel.find.mockReturnValue(createModelFindQuery(orders));
      mttrSource.calculate.mockResolvedValue({ summary: { mttrMinutes: 120 } });
      kpiModel.findOne.mockReturnValue(makeExistingKpiQuery(null));
      counterService.getNextSequence.mockResolvedValue(5);

      await service.updateKpiForMachine(machineId);
      const payload = kpiModel.create.mock.calls[0][0][0];
      expect(payload.completed_corrective).toBe(1);
      expect(payload.completed_preventive).toBe(1);
    });

    it('handles mttrMinutes null as 0 hours', async () => {
      const machineId = new Types.ObjectId().toString();
      const orders = [
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'corrective',
          date_closed: new Date(),
        },
      ] as any;
      workOrderModel.find.mockReturnValue(createModelFindQuery(orders));
      mttrSource.calculate.mockResolvedValue({
        summary: { mttrMinutes: null },
      });
      kpiModel.findOne.mockReturnValue(makeExistingKpiQuery(null));
      counterService.getNextSequence.mockResolvedValue(5);

      await service.updateKpiForMachine(machineId);
      const payload = kpiModel.create.mock.calls[0][0][0];
      expect(payload.mttr_value).toBe(0);
      expect(payload.availability_rate).toBe(100);
    });

    it('handles no failures for mtbf', async () => {
      const machineId = new Types.ObjectId().toString();
      const orders = [
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'corrective',
          date_closed: new Date(),
        },
      ] as any;
      workOrderModel.find.mockReturnValue(createModelFindQuery(orders));
      mttrSource.calculate.mockResolvedValue({ summary: { mttrMinutes: 60 } });
      kpiModel.findOne.mockReturnValue(makeExistingKpiQuery(null));
      counterService.getNextSequence.mockResolvedValue(5);

      await service.updateKpiForMachine(machineId);
      const payload = kpiModel.create.mock.calls[0][0][0];
      expect(payload.mtbf_value).toBe(0);
    });

    it('updates KPI with existing document found', async () => {
      const machineId = new Types.ObjectId().toString();
      const orders = [
        {
          _id: new Types.ObjectId(),
          status: 'completed',
          type_maintenance: 'corrective',
          date_closed: new Date(),
        },
      ] as any;
      workOrderModel.find.mockReturnValue(createModelFindQuery(orders));
      mttrSource.calculate.mockResolvedValue({ summary: { mttrMinutes: 60 } });
      const existingKpi = { _id: new Types.ObjectId(), kpi_id: 'KPI-001' };
      kpiModel.findOne.mockReturnValue(makeExistingKpiQuery(existingKpi));
      kpiModel.findByIdAndUpdate.mockReturnValue(makeFindByIdAndUpdate(null));

      await service.updateKpiForMachine(machineId);

      expect(kpiModel.findByIdAndUpdate).toHaveBeenCalled();
    });
  });
});
