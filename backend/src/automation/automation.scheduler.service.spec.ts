import { Types } from 'mongoose';
import { AutomationSchedulerService } from './automation.scheduler.service';

function leanExec<T>(value: T) {
  return {
    lean: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('AutomationSchedulerService notification persistence', () => {
  const technicianId = new Types.ObjectId();
  const workOrderId = new Types.ObjectId();
  const machineId = new Types.ObjectId();

  let workOrderModel: { find: jest.Mock; updateMany: jest.Mock };
  let stockModel: { find: jest.Mock };
  let automationJobLockModel: {
    findOneAndUpdate: jest.Mock;
    deleteOne: jest.Mock;
  };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let kpiService: { computeStockAlerts: jest.Mock };
  let service: AutomationSchedulerService;

  beforeEach(() => {
    workOrderModel = {
      find: jest.fn().mockReturnValue(leanExec([])),
      updateMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      }),
    };
    stockModel = {
      find: jest.fn().mockReturnValue(leanExec([])),
    };
    automationJobLockModel = {
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue(leanExec({ owner: 'lock-owner' })),
      deleteOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      }),
    };
    notificationCenterService = {
      createIfNotExists: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    kpiService = {
      computeStockAlerts: jest.fn().mockResolvedValue({ count: 0, items: [] }),
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
      automationJobLockModel as never,
      notificationCenterService as never,
      kpiService as never,
    );
  });

  describe('batch registration and locking', () => {
    it('does not register overdue escalation in the 10-minute batch', async () => {
      const executeBatch = jest
        .spyOn(
          service as unknown as { executeBatch: jest.Mock },
          'executeBatch',
        )
        .mockResolvedValue(undefined);

      await service.runTenMinuteJobs();

      expect(executeBatch).toHaveBeenCalledWith(
        '10min',
        expect.not.arrayContaining([
          expect.arrayContaining(['job_overdue_escalation']),
        ]),
      );
    });

    it('skips a job when another scheduler instance owns the distributed lock', async () => {
      automationJobLockModel.findOneAndUpdate.mockReturnValue(
        leanExec({ owner: 'other-instance' }),
      );
      const job = jest.fn().mockResolvedValue({ processed: 1 });

      await (
        service as unknown as {
          runJob(
            name: string,
            job: () => Promise<{ processed: number }>,
          ): Promise<void>;
        }
      ).runJob('job_overdue_escalation', job);

      expect(job).not.toHaveBeenCalled();
      expect(automationJobLockModel.deleteOne).not.toHaveBeenCalled();
    });

    it('releases a distributed lock only for the owner that acquired it', async () => {
      let acquiredOwner = '';
      automationJobLockModel.findOneAndUpdate.mockImplementation(
        (_filter, update) => {
          acquiredOwner = update.$set.owner;
          return leanExec({ owner: acquiredOwner });
        },
      );
      const job = jest.fn().mockResolvedValue({ processed: 1 });

      await (
        service as unknown as {
          runJob(
            name: string,
            job: () => Promise<{ processed: number }>,
          ): Promise<void>;
        }
      ).runJob('job_overdue_escalation', job);

      expect(job).toHaveBeenCalledTimes(1);
      expect(automationJobLockModel.deleteOne).toHaveBeenCalledWith({
        name: 'job_overdue_escalation',
        owner: acquiredOwner,
      });
    });
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
        expect.objectContaining({
          type: 'preventive_due',
          recipientRole: 'admin',
        }),
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

  describe('jobOverdueEscalation', () => {
    it('queries overdue work orders through non-null due-date windows with a stable batch limit', async () => {
      const userModel = {
        find: jest.fn().mockReturnValue(leanExec([])),
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
        userModel as never,
        automationJobLockModel as never,
        notificationCenterService as never,
        kpiService as never,
      );

      await (
        service as unknown as {
          jobOverdueEscalation(): Promise<{ processed: number }>;
        }
      ).jobOverdueEscalation();

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'overdue',
          $or: expect.arrayContaining([
            { due_date: expect.objectContaining({ $ne: null }) },
            expect.objectContaining({
              due_date: null,
              scheduled_date: expect.objectContaining({ $ne: null }),
            }),
            expect.objectContaining({
              due_date: null,
              scheduled_date: null,
              date_start: expect.objectContaining({ $ne: null }),
            }),
          ]),
        }),
        expect.any(Object),
      );
      const query = workOrderModel.find.mock.results[0].value;
      expect(query.sort).toHaveBeenCalledWith({
        due_date: 1,
        scheduled_date: 1,
        date_start: 1,
        _id: 1,
      });
      expect(query.limit).toHaveBeenCalledWith(1000);
    });
  });

  describe('jobStockMonitoring', () => {
    it('broadcasts a STOCK_ALERT to Admins for every alerting stock KpiService reports', async () => {
      const stockId = new Types.ObjectId().toString();
      const partId = new Types.ObjectId().toString();
      kpiService.computeStockAlerts.mockResolvedValue({
        count: 1,
        items: [
          {
            stockId,
            stockCode: 'STOCK-001',
            partId,
            partLabel: 'Drive belt',
            quantiteEnStock: 2,
            quantiteReservee: 0,
            available: 2,
            threshold: 5,
          },
        ],
      });

      const result = await (
        service as unknown as {
          jobStockMonitoring(): Promise<{ processed: number }>;
        }
      ).jobStockMonitoring();

      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stock_alert',
          recipientRole: 'admin',
          dedupeKey: `stock_alert:${stockId}:2`,
          referenceId: partId,
        }),
      );
      expect(result.processed).toBe(1);
    });

    it('does not alert when KpiService reports no alerting stocks', async () => {
      kpiService.computeStockAlerts.mockResolvedValue({ count: 0, items: [] });

      const result = await (
        service as unknown as {
          jobStockMonitoring(): Promise<{ processed: number }>;
        }
      ).jobStockMonitoring();

      expect(
        notificationCenterService.createIfNotExists,
      ).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
    });
  });
});
