import { Types } from 'mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { WorkOrderAssignmentService } from './work-order-assignment.service';

describe('WorkOrderAssignmentService', () => {
  let service: WorkOrderAssignmentService;
  let workOrderModel: {
    findOne: jest.Mock<any, any, any>;
    findOneAndUpdate: jest.Mock<any, any, any>;
  };

  beforeEach(() => {
    workOrderModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    service = new WorkOrderAssignmentService(workOrderModel as any);
  });

  describe('claimForTechnician', () => {
    it('returns already assigned work order without throwing', async () => {
      const wo = { _id: new Types.ObjectId() };
      workOrderModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(wo),
      });
      const result = await service.claimForTechnician({
        technicianId: new Types.ObjectId().toString(),
        workOrderId: new Types.ObjectId().toString(),
        accessibleMachineIds: [],
      });
      expect(result).toBe(wo);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws ConflictException when work order is closed', async () => {
      workOrderModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });
      workOrderModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.claimForTechnician({
          technicianId: new Types.ObjectId().toString(),
          workOrderId: new Types.ObjectId().toString(),
          accessibleMachineIds: [],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException for invalid technicianId', async () => {
      await expect(
        service.claimForTechnician({
          technicianId: 'not-a-valid-objectid',
          workOrderId: new Types.ObjectId().toString(),
          accessibleMachineIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid workOrderId', async () => {
      await expect(
        service.claimForTechnician({
          technicianId: new Types.ObjectId().toString(),
          workOrderId: 'not-valid',
          accessibleMachineIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets technician_id and status to assigned on successful claim', async () => {
      workOrderModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });
      const wo = { _id: new Types.ObjectId(), status: 'scheduled' };
      workOrderModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(wo),
      });
      const technicianId = new Types.ObjectId().toString();
      const result = await service.claimForTechnician({
        technicianId,
        workOrderId: new Types.ObjectId().toString(),
        accessibleMachineIds: [],
      });
      expect(result).toBe(wo);
      const updateCall = workOrderModel.findOneAndUpdate.mock.calls[0];
      expect((updateCall[1] as Record<string, unknown>).$set).toMatchObject({
        technician_id: expect.any(Types.ObjectId),
        status: 'assigned',
      });
    });

    it('passes session through to queries when provided', async () => {
      const session = {
        withTransaction: jest.fn(),
        endSession: jest.fn(),
      } as any;
      workOrderModel.findOne.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });
      workOrderModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      });
      const technicianId = new Types.ObjectId().toString();
      await service.claimForTechnician({
        technicianId,
        workOrderId: new Types.ObjectId().toString(),
        accessibleMachineIds: [],
        session,
      });
      expect(
        workOrderModel.findOne.mock.results[0].value.session,
      ).toHaveBeenCalledWith(session);
      expect(workOrderModel.findOneAndUpdate.mock.calls[0][2].session).toBe(
        session,
      );
    });
  });

  describe('claimableUnassignedScope', () => {
    it('keeps unassigned open work globally claimable when machineIds is empty', () => {
      const result = service.claimableUnassignedScope([]);
      expect(result).not.toHaveProperty('machine_id');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('$or');
    });

    it('restricts unassigned work to accessible machines when machineIds provided', () => {
      const ids = [new Types.ObjectId(), new Types.ObjectId()];
      const result = service.claimableUnassignedScope(ids);
      expect(result.machine_id).toEqual({ $in: ids });
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('$or');
    });

    it('excludes closed work order statuses', () => {
      const ids = [new Types.ObjectId()];
      const result = service.claimableUnassignedScope(ids);
      expect(result.status.$nin).toContain('completed');
    });

    it('requires unassigned work orders', () => {
      const ids = [new Types.ObjectId()];
      const result = service.claimableUnassignedScope(ids);
      expect(result.$or).toBeDefined();
    });
  });

  describe('technicianScope', () => {
    it('returns scope with ObjectId and raw technicianId', () => {
      const technicianId = new Types.ObjectId().toString();
      const result = service.technicianScope(technicianId);
      expect(result.$in).toHaveLength(2);
      expect(result.$in[0]).toBeInstanceOf(Types.ObjectId);
      expect(result.$in[1]).toBe(technicianId);
    });
  });
});
