import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ScheduledReportsService } from './scheduled-reports.service';
import { ReportFormat, ReportType } from '../schemas/generated-report.schema';
import { ScheduleFrequency } from '../schemas/scheduled-report.schema';
import { Role } from '../schemas/user.schema';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('ScheduledReportsService', () => {
  const adminActor = {
    userId: new Types.ObjectId().toString(),
    role: Role.ADMIN,
  };
  const otherActor = {
    userId: new Types.ObjectId().toString(),
    role: Role.TECHNICIAN,
  };

  let scheduledReportModel: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };

  function buildService() {
    return new ScheduledReportsService(scheduledReportModel as never);
  }

  beforeEach(() => {
    scheduledReportModel = {
      create: jest
        .fn()
        .mockImplementation((doc) =>
          Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
        ),
      find: jest
        .fn()
        .mockReturnValue({ sort: jest.fn().mockReturnValue(execResolves([])) }),
      findById: jest.fn().mockReturnValue(execResolves(null)),
      findByIdAndDelete: jest.fn().mockReturnValue(execResolves(undefined)),
    };
  });

  describe('create', () => {
    it('rejects a role not permitted to request the given report type', async () => {
      const service = buildService();
      await expect(
        service.create(
          {
            type: ReportType.AUDIT_HISTORY,
            format: ReportFormat.CSV,
            frequency: ScheduleFrequency.DAILY,
          },
          otherActor,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates an active schedule with a computed next_run_at in the future', async () => {
      const service = buildService();
      const schedule = await service.create(
        {
          type: ReportType.MACHINE_HISTORY,
          format: ReportFormat.PDF,
          frequency: ScheduleFrequency.WEEKLY,
        },
        adminActor,
      );

      expect(schedule.active).toBe(true);
      expect(schedule.next_run_at.getTime()).toBeGreaterThan(Date.now());
      expect(schedule.schedule_id).toMatch(/^SCH-/);
    });
  });

  describe('listForActor', () => {
    it('scopes to own schedules for a non-Admin', async () => {
      const service = buildService();
      await service.listForActor(otherActor);
      expect(scheduledReportModel.find).toHaveBeenCalledWith({
        created_by: new Types.ObjectId(otherActor.userId),
      });
    });

    it('lists every schedule for Admin', async () => {
      const service = buildService();
      await service.listForActor(adminActor);
      expect(scheduledReportModel.find).toHaveBeenCalledWith({});
    });
  });

  describe('update / remove ownership', () => {
    function scheduleDoc(overrides: Record<string, unknown> = {}) {
      return {
        _id: 's1',
        created_by: { toString: () => adminActor.userId },
        frequency: ScheduleFrequency.DAILY,
        active: true,
        parameters: {},
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('throws NotFoundException for a missing schedule', async () => {
      scheduledReportModel.findById.mockReturnValue(execResolves(null));
      const service = buildService();
      await expect(service.update('missing', {}, adminActor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when a non-owner, non-admin tries to update', async () => {
      scheduledReportModel.findById.mockReturnValue(
        execResolves(scheduleDoc()),
      );
      const service = buildService();
      await expect(
        service.update('s1', { active: false }, otherActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('toggles active and persists via save()', async () => {
      const doc = scheduleDoc();
      scheduledReportModel.findById.mockReturnValue(execResolves(doc));
      const service = buildService();

      const updated = await service.update('s1', { active: false }, adminActor);

      expect(updated.active).toBe(false);
      expect(doc.save).toHaveBeenCalled();
    });

    it('recomputes next_run_at when the frequency changes', async () => {
      const doc = scheduleDoc();
      scheduledReportModel.findById.mockReturnValue(execResolves(doc));
      const service = buildService();

      const updated = await service.update(
        's1',
        { frequency: ScheduleFrequency.MONTHLY },
        adminActor,
      );

      expect(updated.frequency).toBe(ScheduleFrequency.MONTHLY);
      expect(updated.next_run_at).toBeInstanceOf(Date);
    });

    it('removes an owned schedule', async () => {
      const doc = scheduleDoc();
      scheduledReportModel.findById.mockReturnValue(execResolves(doc));
      const service = buildService();

      await service.remove('s1', adminActor);
      expect(scheduledReportModel.findByIdAndDelete).toHaveBeenCalledWith('s1');
    });

    it("a non-owner technician cannot remove someone else's schedule", async () => {
      scheduledReportModel.findById.mockReturnValue(
        execResolves(scheduleDoc()),
      );
      const service = buildService();
      await expect(service.remove('s1', otherActor)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
