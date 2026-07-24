import { Types } from 'mongoose';
import { AutomationSchedulerService } from './automation.scheduler.service';

function leanExec<T>(value: T) {
  return { lean: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('AutomationSchedulerService notification persistence', () => {
  const technicianId = new Types.ObjectId();
  const workOrderId = new Types.ObjectId();
  const machineId = new Types.ObjectId();

  let workOrderModel: { find: jest.Mock; updateMany: jest.Mock };
  let stockModel: { find: jest.Mock };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let service: AutomationSchedulerService;

  beforeEach(() => {
    workOrderModel = {
      find: jest.fn().mockReturnValue(leanExec([])),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
    };
    stockModel = {
      find: jest.fn().mockReturnValue(leanExec([])),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };

    service = new AutomationSchedulerService(
      { triggerScheduler: jest.fn() } as never,
      workOrderModel as never,
      {} as never,
      {} as never,
      stockModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notificationCenterService as never,
    );
  });

  describe('jobUpcomingMaintenanceReminders', () => {
    it('persists a PREVENTIVE_DUE notification targeted at the assigned technician', async () => {
      const dueInThreeDays = new Date();
      dueInThreeDays.setDate(dueInThreeDays.getDate() + 3);
      dueInThreeDays.setHours(0, 0, 0, 0);

      workOrderModel.find.mockReturnValue(
        leanExec([
          {
            _id: workOrderId,
            ot_id: 'WO-PREV-000001',
            technician_id: technicianId,
            machine_id: machineId,
            due_date: dueInThreeDays,
          },
        ]),
      );

      const result = await (
        service as unknown as {
          jobUpcomingMaintenanceReminders(): Promise<{ processed: number }>;
        }
      ).jobUpcomingMaintenanceReminders();

      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preventive_due',
          recipientUserId: technicianId.toString(),
          workOrderId: workOrderId.toString(),
          machineId: machineId.toString(),
        }),
      );
      expect(result.processed).toBe(1);
    });

    it('falls back to broadcasting to Admins when no technician is assigned', async () => {
      const dueTomorrow = new Date();
      dueTomorrow.setDate(dueTomorrow.getDate() + 1);
      dueTomorrow.setHours(0, 0, 0, 0);

      workOrderModel.find.mockReturnValue(
        leanExec([
          {
            _id: workOrderId,
            ot_id: 'WO-PREV-000002',
            due_date: dueTomorrow,
          },
        ]),
      );

      await (
        service as unknown as {
          jobUpcomingMaintenanceReminders(): Promise<unknown>;
        }
      ).jobUpcomingMaintenanceReminders();

      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preventive_due', recipientRole: 'admin' }),
      );
    });
  });

  describe('jobMarkOverdueMaintenance', () => {
    it('persists a PREVENTIVE_OVERDUE notification once the work order is flipped to overdue', async () => {
      workOrderModel.find.mockReturnValue(
        leanExec([
          {
            _id: workOrderId,
            ot_id: 'WO-PREV-000003',
            technician_id: technicianId,
            machine_id: machineId,
            due_date: new Date('2020-01-01'),
          },
        ]),
      );
      workOrderModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      });

      const result = await (
        service as unknown as {
          jobMarkOverdueMaintenance(): Promise<{ processed: number }>;
        }
      ).jobMarkOverdueMaintenance();

      expect(workOrderModel.updateMany).toHaveBeenCalled();
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preventive_overdue',
          recipientUserId: technicianId.toString(),
          workOrderId: workOrderId.toString(),
        }),
      );
      expect(result.processed).toBe(1);
    });
  });

  describe('jobStockMonitoring', () => {
    it('broadcasts a STOCK_ALERT to Admins when quantity is at or below threshold', async () => {
      stockModel.find.mockReturnValue(
        leanExec([
          {
            _id: new Types.ObjectId(),
            stock_id: 'STOCK-001',
            part_id: new Types.ObjectId(),
            quantite_en_stock: 2,
            seuil_alerte_stock: 5,
          },
        ]),
      );

      const result = await (
        service as unknown as { jobStockMonitoring(): Promise<{ processed: number }> }
      ).jobStockMonitoring();

      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stock_alert', recipientRole: 'admin' }),
      );
      expect(result.processed).toBe(1);
    });

    it('does not alert when stock is above threshold', async () => {
      stockModel.find.mockReturnValue(
        leanExec([
          {
            _id: new Types.ObjectId(),
            stock_id: 'STOCK-002',
            part_id: new Types.ObjectId(),
            quantite_en_stock: 50,
            seuil_alerte_stock: 5,
          },
        ]),
      );

      const result = await (
        service as unknown as { jobStockMonitoring(): Promise<{ processed: number }> }
      ).jobStockMonitoring();

      expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
    });
  });
});
