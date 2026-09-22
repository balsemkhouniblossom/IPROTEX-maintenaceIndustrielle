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
    it('registers the nightly and hourly maintenance batches', async () => {
      const executeBatch = jest
        .spyOn(
          service as unknown as { executeBatch: jest.Mock },
          'executeBatch',
        )
        .mockResolvedValue(undefined);

      await service.runNightlyJobs();
      await service.runHourlyJobs();

      expect(executeBatch).toHaveBeenNthCalledWith(
        1,
        'nightly',
        expect.arrayContaining([
          expect.arrayContaining(['job_generate_preventive_maintenance']),
          expect.arrayContaining(['job_refresh_kpis']),
        ]),
      );
      expect(executeBatch).toHaveBeenNthCalledWith(
        2,
        'hourly',
        expect.arrayContaining([
          expect.arrayContaining(['job_upcoming_maintenance_reminders']),
          expect.arrayContaining(['job_lubrication_reminders']),
        ]),
      );
    });

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
        owner_id: acquiredOwner,
        run_id: expect.any(String),
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
      expect(query.limit).toHaveBeenCalledWith(250);
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

  describe('remaining scheduled maintenance jobs', () => {
    it('handles empty datasets without fabricating notifications or updates', async () => {
      const empty = () => leanExec([]);
      const workOrdersService = {
        triggerScheduler: jest.fn().mockResolvedValue({
          createdFirstExecution: 1,
          createdNextExecution: 2,
          plansEvaluated: 4,
          failed: 0,
          skippedDuplicates: 1,
          batches: 1,
        }),
        updateKpiForMachine: jest.fn(),
      };
      const workOrders = {
        find: jest.fn().mockImplementation(empty),
        aggregate: jest.fn().mockReturnValue({
          cursor: jest.fn().mockReturnValue({
            [Symbol.asyncIterator]: () => ({
              next: jest.fn().mockResolvedValue({
                done: true,
                value: undefined,
              }),
            }),
          }),
        }),
      };
      const plans = { find: jest.fn().mockImplementation(empty) };
      const lubricationLogs = {
        aggregate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      };
      const sensors = { find: jest.fn().mockImplementation(empty) };
      const measures = {
        aggregate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      };
      const machines = { find: jest.fn().mockImplementation(empty) };
      const modules = { find: jest.fn().mockImplementation(empty) };
      service = new AutomationSchedulerService(
        workOrdersService as never,
        workOrders as never,
        plans as never,
        lubricationLogs as never,
        stockModel as never,
        sensors as never,
        measures as never,
        machines as never,
        modules as never,
        { find: jest.fn().mockImplementation(empty) } as never,
        automationJobLockModel as never,
        notificationCenterService as never,
        kpiService as never,
      );
      const jobs = service as unknown as {
        jobGeneratePreventiveMaintenance(): Promise<{
          processed: number;
          scanned?: number;
        }>;
        jobLubricationReminders(): Promise<{ processed: number }>;
        jobSensorMonitoring(): Promise<{ processed: number }>;
        jobRefreshKpis(): Promise<{ processed: number }>;
        jobDetectDuplicateWorkOrders(): Promise<{ processed: number }>;
        jobCalendarSynchronization(): Promise<{ processed: number }>;
      };

      await expect(
        jobs.jobGeneratePreventiveMaintenance(),
      ).resolves.toMatchObject({ processed: 3, scanned: 4 });
      await expect(jobs.jobLubricationReminders()).resolves.toMatchObject({
        processed: 0,
      });
      await expect(jobs.jobSensorMonitoring()).resolves.toMatchObject({
        processed: 0,
      });
      await expect(jobs.jobRefreshKpis()).resolves.toMatchObject({
        processed: 0,
      });
      await expect(jobs.jobDetectDuplicateWorkOrders()).resolves.toMatchObject({
        processed: 0,
      });
      await expect(jobs.jobCalendarSynchronization()).resolves.toMatchObject({
        processed: 0,
      });
      expect(
        notificationCenterService.createIfNotExists,
      ).not.toHaveBeenCalled();
    });

    it('processes due lubrication, sensor, KPI, duplicate, and calendar records', async () => {
      const moduleId = new Types.ObjectId();
      const sensorId = new Types.ObjectId();
      const completedId = new Types.ObjectId();
      const workOrdersService = {
        triggerScheduler: jest.fn(),
        updateKpiForMachine: jest.fn().mockResolvedValue(undefined),
      };
      const duplicateGroup = {
        _id: { machine_id: machineId, date_key: '2026-09-20' },
        count: 2,
      };
      const duplicateAggregation = {
        cursor: jest.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield duplicateGroup;
          },
        }),
      };
      const findByIdAndUpdate = jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: completedId }),
      });
      const workOrders = {
        find: jest.fn().mockReturnValue(
          leanExec([
            {
              _id: completedId,
              date_end: new Date('2026-09-19T12:00:00.000Z'),
            },
          ]),
        ),
        aggregate: jest.fn().mockReturnValue(duplicateAggregation),
        findByIdAndUpdate,
      };
      const plans = {
        find: jest.fn().mockReturnValue(
          leanExec([
            {
              _id: new Types.ObjectId(),
              module_id: moduleId,
              frequence: 1,
              unite_frequence: 'daily',
            },
          ]),
        ),
      };
      const lubricationLogs = {
        aggregate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: moduleId,
              lastDate: new Date(Date.now() - 20 * 86_400_000),
              lastTechnician: technicianId,
            },
          ]),
        }),
      };
      const sensors = {
        find: jest.fn().mockReturnValue(
          leanExec([
            {
              _id: sensorId,
              capteur_id: 'TEMP-1',
              seuil_avertissement: 50,
              seuil_critique: 80,
              module_id: moduleId,
            },
          ]),
        ),
      };
      const measures = {
        aggregate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: sensorId,
              valeur: 85,
              timestamp: new Date(),
              status: 'critical',
            },
          ]),
        }),
      };
      const machines = {
        find: jest
          .fn()
          .mockReturnValueOnce(leanExec([{ _id: machineId }]))
          .mockReturnValueOnce(leanExec([])),
      };
      const modules = {
        find: jest
          .fn()
          .mockReturnValue(
            leanExec([
              { _id: moduleId, module_id: 'MOD-1', machine_id: machineId },
            ]),
          ),
      };
      service = new AutomationSchedulerService(
        workOrdersService as never,
        workOrders as never,
        plans as never,
        lubricationLogs as never,
        stockModel as never,
        sensors as never,
        measures as never,
        machines as never,
        modules as never,
        { find: jest.fn().mockReturnValue(leanExec([])) } as never,
        automationJobLockModel as never,
        notificationCenterService as never,
        kpiService as never,
      );
      const jobs = service as unknown as {
        jobLubricationReminders(): Promise<{ processed: number }>;
        jobSensorMonitoring(): Promise<{ processed: number }>;
        jobRefreshKpis(): Promise<{ processed: number }>;
        jobDetectDuplicateWorkOrders(): Promise<{ processed: number }>;
        jobCalendarSynchronization(): Promise<{ processed: number }>;
      };

      await expect(jobs.jobLubricationReminders()).resolves.toMatchObject({
        scanned: 1,
      });
      await expect(jobs.jobSensorMonitoring()).resolves.toMatchObject({
        processed: 1,
      });
      await expect(jobs.jobRefreshKpis()).resolves.toMatchObject({
        processed: 1,
      });
      await expect(jobs.jobDetectDuplicateWorkOrders()).resolves.toMatchObject({
        processed: 1,
      });
      await expect(jobs.jobCalendarSynchronization()).resolves.toMatchObject({
        processed: 1,
      });

      expect(workOrdersService.updateKpiForMachine).toHaveBeenCalledWith(
        machineId.toHexString(),
      );
      expect(findByIdAndUpdate).toHaveBeenCalledWith(completedId, {
        date_closed: new Date('2026-09-19T12:00:00.000Z'),
      });
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sensor_alert' }),
      );
      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'duplicate_work_order' }),
      );
    });

    it('classifies scheduler completion and recipient fallbacks deterministically', () => {
      const internals = service as unknown as {
        resolveRecipient(value: string): Record<string, unknown>;
        resolveJobFinalStatus(
          result: { failed?: number; succeeded?: number },
          context: { shouldContinue(): boolean },
        ): string;
        telemetryValueLabel(value: unknown): string;
        sanitizedError(error: unknown): string;
        normalizeFrequencyUnit(value?: string): string;
        computeNextDueDate(from: Date, frequency?: number, unit?: string): Date;
      };
      expect(internals.resolveRecipient(technicianId.toHexString())).toEqual({
        recipientUserId: technicianId.toHexString(),
      });
      expect(internals.resolveRecipient('')).toEqual({
        recipientRole: 'admin',
      });
      expect(
        internals.resolveJobFinalStatus(
          { failed: 1, succeeded: 1 },
          { shouldContinue: () => true },
        ),
      ).toBe('partial');
      expect(
        internals.resolveJobFinalStatus(
          { failed: 1, succeeded: 0 },
          { shouldContinue: () => true },
        ),
      ).toBe('failed');
      expect(
        internals.resolveJobFinalStatus({}, { shouldContinue: () => false }),
      ).toBe('timed_out');
      expect(
        internals.resolveJobFinalStatus({}, { shouldContinue: () => true }),
      ).toBe('completed');
      expect(internals.telemetryValueLabel(Number.NaN)).toBe('NaN');
      expect(internals.telemetryValueLabel(12.34567)).toBe('12.34567');
      expect(internals.telemetryValueLabel('offline')).toBe('offline');
      expect(internals.telemetryValueLabel({ status: 'warning' })).toBe(
        '{"status":"warning"}',
      );
      expect(internals.sanitizedError(new Error('provider failed'))).toBe(
        'provider failed',
      );
      expect(internals.sanitizedError('failure')).toBe('failure');
      expect(
        [
          undefined,
          'day',
          'week',
          '3 months',
          '6 months',
          'year',
          'month',
          'custom',
        ].map((unit) => internals.normalizeFrequencyUnit(unit)),
      ).toEqual([
        'monthly',
        'daily',
        'weekly',
        'quarterly',
        'semiannual',
        'yearly',
        'monthly',
        'monthly',
      ]);
      const start = new Date('2026-01-01T00:00:00.000Z');
      expect(
        ['day', 'week', 'month', '3 months', '6 months', 'year'].map((unit) =>
          internals.computeNextDueDate(start, 1, unit).toISOString(),
        ),
      ).toEqual([
        '2026-01-02T00:00:00.000Z',
        '2026-01-08T00:00:00.000Z',
        '2026-02-01T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z',
        '2026-07-01T00:00:00.000Z',
        '2027-01-01T00:00:00.000Z',
      ]);
    });
  });
});
