import { Types } from 'mongoose';
import { ReportSchedulerService } from './report-scheduler.service';
import {
  ReportStatus,
  ReportFormat,
  ReportType,
} from '../schemas/generated-report.schema';
import { ScheduleFrequency } from '../schemas/scheduled-report.schema';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('ReportSchedulerService', () => {
  let scheduledReportModel: { find: jest.Mock; findByIdAndUpdate: jest.Mock };
  let generatedReportModel: { find: jest.Mock; findByIdAndUpdate: jest.Mock };
  let reportsService: { requestReport: jest.Mock; generateReport: jest.Mock };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let fileStorageService: { ownsFile: jest.Mock; delete: jest.Mock };

  function buildService() {
    return new ReportSchedulerService(
      scheduledReportModel as never,
      generatedReportModel as never,
      reportsService as never,
      notificationCenterService as never,
      fileStorageService as never,
    );
  }

  function schedule(overrides: Record<string, unknown> = {}) {
    return {
      _id: new Types.ObjectId(),
      schedule_id: 'SCH-1',
      type: ReportType.MACHINE_HISTORY,
      format: ReportFormat.CSV,
      parameters: {},
      frequency: ScheduleFrequency.DAILY,
      created_by: new Types.ObjectId(),
      ...overrides,
    };
  }

  beforeEach(() => {
    scheduledReportModel = {
      find: jest.fn().mockReturnValue(execResolves([])),
      findByIdAndUpdate: jest.fn().mockReturnValue(execResolves(undefined)),
    };
    generatedReportModel = {
      find: jest.fn().mockReturnValue(execResolves([])),
      findByIdAndUpdate: jest.fn().mockReturnValue(execResolves(undefined)),
    };
    reportsService = {
      requestReport: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      generateReport: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        status: ReportStatus.COMPLETED,
      }),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };
    fileStorageService = {
      ownsFile: jest.fn().mockReturnValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe('runSweep — firing due schedules', () => {
    it('fires every due schedule through the same request+generate pipeline an on-demand request uses', async () => {
      scheduledReportModel.find.mockReturnValue(execResolves([schedule()]));
      const service = buildService();

      const result = await service.runSweep();

      expect(reportsService.requestReport).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ReportType.MACHINE_HISTORY,
          format: ReportFormat.CSV,
        }),
        expect.objectContaining({ role: 'admin' }),
      );
      expect(reportsService.generateReport).toHaveBeenCalled();
      expect(result.generated).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('updates last_run_at/next_run_at on the schedule after firing', async () => {
      const due = schedule();
      scheduledReportModel.find.mockReturnValue(execResolves([due]));
      const service = buildService();

      await service.runSweep();

      const updateCall = scheduledReportModel.findByIdAndUpdate.mock.calls.find(
        ([id]) => id === due._id,
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1].last_run_at).toBeInstanceOf(Date);
      expect(updateCall![1].next_run_at).toBeInstanceOf(Date);
    });

    it('notifies the schedule creator once the report completes', async () => {
      scheduledReportModel.find.mockReturnValue(execResolves([schedule()]));
      const service = buildService();

      await service.runSweep();

      expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'report_ready' }),
      );
    });

    it('does not notify when generation ends in a failed report', async () => {
      reportsService.generateReport.mockResolvedValue({
        _id: new Types.ObjectId(),
        status: ReportStatus.FAILED,
      });
      scheduledReportModel.find.mockReturnValue(execResolves([schedule()]));
      const service = buildService();

      await service.runSweep();

      expect(
        notificationCenterService.createIfNotExists,
      ).not.toHaveBeenCalled();
    });

    it('recomputes relativeRangeDays into concrete dateFrom/dateTo for this firing', async () => {
      scheduledReportModel.find.mockReturnValue(
        execResolves([schedule({ parameters: { relativeRangeDays: 30 } })]),
      );
      const service = buildService();

      await service.runSweep();

      const [dto] = reportsService.requestReport.mock.calls[0];
      expect(typeof dto.parameters.dateFrom).toBe('string');
      expect(typeof dto.parameters.dateTo).toBe('string');
    });

    it('continues sweeping remaining schedules when one fails', async () => {
      reportsService.requestReport
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ _id: new Types.ObjectId() });
      scheduledReportModel.find.mockReturnValue(
        execResolves([schedule(), schedule({ schedule_id: 'SCH-2' })]),
      );
      const service = buildService();

      const result = await service.runSweep();

      expect(result.failed).toBe(1);
      expect(result.generated).toBe(1);
    });
  });

  describe('runSweep — expired report file cleanup', () => {
    it('deletes the stored file for an expired report and unsets file_path', async () => {
      const expiredId = new Types.ObjectId();
      generatedReportModel.find.mockReturnValue(
        execResolves([
          { _id: expiredId, report_id: 'RPT-1', file_path: '/uploads/a.csv' },
        ]),
      );
      const service = buildService();

      const result = await service.runSweep();

      expect(fileStorageService.delete).toHaveBeenCalledWith('/uploads/a.csv');
      expect(generatedReportModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expiredId,
        {
          $unset: { file_path: 1 },
        },
      );
      expect(result.expiredCleaned).toBe(1);
    });

    it('skips the delete call when the storage provider does not own the reference, but still unsets it', async () => {
      fileStorageService.ownsFile.mockReturnValue(false);
      generatedReportModel.find.mockReturnValue(
        execResolves([
          {
            _id: new Types.ObjectId(),
            report_id: 'RPT-1',
            file_path: '/uploads/a.csv',
          },
        ]),
      );
      const service = buildService();

      await service.runSweep();

      expect(fileStorageService.delete).not.toHaveBeenCalled();
    });
  });
});
