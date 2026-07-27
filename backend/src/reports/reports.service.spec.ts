import { BadRequestException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as crypto from 'crypto';
import { ReportsService } from './reports.service';
import { ReportStatus, ReportFormat, ReportType } from '../schemas/generated-report.schema';
import { Role } from '../schemas/user.schema';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('ReportsService', () => {
  const actor = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };

  let generatedReportModel: {
    create: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findById: jest.Mock;
    findByIdAndDelete: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let fileStorageService: {
    save: jest.Mock;
    delete: jest.Mock;
    ownsFile: jest.Mock;
    readProtectedFile: jest.Mock;
  };
  let fakeProvider: { type: ReportType; buildDataset: jest.Mock };
  let fakeRenderer: {
    format: ReportFormat;
    fileExtension: string;
    contentType: string;
    render: jest.Mock;
  };

  function buildService() {
    return new ReportsService(
      generatedReportModel as never,
      [fakeProvider] as never,
      [fakeRenderer] as never,
      fileStorageService as never,
    );
  }

  beforeEach(() => {
    generatedReportModel = {
      create: jest.fn().mockImplementation((doc) =>
        Promise.resolve({ ...doc, _id: new Types.ObjectId(), report_id: doc.report_id }),
      ),
      findByIdAndUpdate: jest.fn().mockReturnValue(execResolves({ _id: new Types.ObjectId() })),
      findById: jest.fn().mockReturnValue(execResolves(null)),
      findByIdAndDelete: jest.fn().mockReturnValue(execResolves(undefined)),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn().mockReturnValue(execResolves(0)),
    };
    fileStorageService = {
      save: jest.fn().mockResolvedValue({ relativePath: '/uploads/x.csv', storageKey: undefined, size: 10 }),
      delete: jest.fn().mockResolvedValue(undefined),
      ownsFile: jest.fn().mockReturnValue(true),
      readProtectedFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('data'),
        contentType: 'text/csv',
        fileName: 'x.csv',
        size: 4,
      }),
    };
    fakeProvider = {
      type: ReportType.MACHINE_HISTORY,
      buildDataset: jest.fn().mockResolvedValue({
        title: 'Test',
        generatedAt: new Date(),
        parameters: {},
        columns: [{ key: 'a', label: 'A' }],
        rows: [{ a: '1' }],
      }),
    };
    fakeRenderer = {
      format: ReportFormat.CSV,
      fileExtension: 'csv',
      contentType: 'text/csv',
      render: jest.fn().mockResolvedValue(Buffer.from('csv-bytes')),
    };
  });

  describe('requestReport', () => {
    it('rejects a role not permitted to request the given report type, without creating a row', async () => {
      const service = buildService();
      await expect(
        service.requestReport(
          { type: ReportType.AUDIT_HISTORY, format: ReportFormat.CSV },
          { userId: actor.userId, role: Role.TECHNICIAN },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(generatedReportModel.create).not.toHaveBeenCalled();
    });

    it('creates a pending row immediately and kicks off generation in the background', async () => {
      const service = buildService();
      const generateSpy = jest.spyOn(service, 'generateReport').mockResolvedValue({} as never);

      const report = await service.requestReport(
        { type: ReportType.MACHINE_HISTORY, format: ReportFormat.CSV, parameters: { machineId: 'm1' } },
        actor,
      );

      expect(report.status).toBe(ReportStatus.PENDING);
      expect(generatedReportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ReportType.MACHINE_HISTORY,
          format: ReportFormat.CSV,
          status: ReportStatus.PENDING,
          requester_role: Role.ADMIN,
        }),
      );
      // Fire-and-forget: give the microtask queue a tick to confirm it was invoked.
      await Promise.resolve();
      expect(generateSpy).toHaveBeenCalled();
    });
  });

  describe('generateReport', () => {
    it('builds the dataset, renders it, stores it, and marks the report completed with a checksum', async () => {
      const service = buildService();

      await service.generateReport(
        'report-id',
        { type: ReportType.MACHINE_HISTORY, format: ReportFormat.CSV, parameters: {} },
        actor,
      );

      expect(fakeProvider.buildDataset).toHaveBeenCalled();
      expect(fakeRenderer.render).toHaveBeenCalled();
      expect(fileStorageService.save).toHaveBeenCalledWith(
        expect.objectContaining({ buffer: Buffer.from('csv-bytes'), folder: 'uploads' }),
      );

      const expectedChecksum = crypto.createHash('sha256').update(Buffer.from('csv-bytes')).digest('hex');
      const completedCall = generatedReportModel.findByIdAndUpdate.mock.calls.find(
        ([, update]) => update.status === ReportStatus.COMPLETED,
      );
      expect(completedCall).toBeDefined();
      expect(completedCall![1]).toEqual(
        expect.objectContaining({
          status: ReportStatus.COMPLETED,
          checksum: expectedChecksum,
          row_count: 1,
        }),
      );
    });

    it('marks the report failed with an error message when no provider is registered for the type', async () => {
      fakeProvider.type = ReportType.AUDIT_HISTORY; // no longer matches MACHINE_HISTORY
      const service = buildService();

      await service.generateReport(
        'report-id',
        { type: ReportType.MACHINE_HISTORY, format: ReportFormat.CSV },
        actor,
      );

      const failedCall = generatedReportModel.findByIdAndUpdate.mock.calls.find(
        ([, update]) => update.status === ReportStatus.FAILED,
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![1].error_message).toMatch(/No data provider registered/);
    });

    it('marks the report failed when the data provider throws', async () => {
      fakeProvider.buildDataset.mockRejectedValue(new Error('boom'));
      const service = buildService();

      await service.generateReport(
        'report-id',
        { type: ReportType.MACHINE_HISTORY, format: ReportFormat.CSV },
        actor,
      );

      const failedCall = generatedReportModel.findByIdAndUpdate.mock.calls.find(
        ([, update]) => update.status === ReportStatus.FAILED,
      );
      expect(failedCall![1].error_message).toBe('boom');
    });
  });

  describe('access control on read/write operations', () => {
    function reportDoc(overrides: Record<string, unknown> = {}) {
      return {
        _id: 'r1',
        requested_by: { toString: () => actor.userId },
        status: ReportStatus.COMPLETED,
        file_path: '/uploads/x.csv',
        checksum: crypto.createHash('sha256').update(Buffer.from('data')).digest('hex'),
        expires_at: new Date(Date.now() + 100000),
        report_id: 'RPT-1',
        ...overrides,
      };
    }

    it('getReport throws NotFoundException for a missing report', async () => {
      generatedReportModel.findById.mockReturnValue(execResolves(null));
      const service = buildService();
      await expect(service.getReport('missing', actor)).rejects.toThrow(NotFoundException);
    });

    it('getReport throws ForbiddenException for a non-owner, non-admin caller', async () => {
      generatedReportModel.findById.mockReturnValue(execResolves(reportDoc()));
      const service = buildService();
      await expect(
        service.getReport('r1', { userId: new Types.ObjectId().toString(), role: Role.TECHNICIAN }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('getReport allows the owner even when not Admin', async () => {
      const ownerId = new Types.ObjectId().toString();
      generatedReportModel.findById.mockReturnValue(
        execResolves(reportDoc({ requested_by: { toString: () => ownerId } })),
      );
      const service = buildService();
      await expect(
        service.getReport('r1', { userId: ownerId, role: Role.TECHNICIAN }),
      ).resolves.toBeDefined();
    });

    it('downloadReport rejects a report that is not yet completed', async () => {
      generatedReportModel.findById.mockReturnValue(execResolves(reportDoc({ status: ReportStatus.PROCESSING })));
      const service = buildService();
      await expect(service.downloadReport('r1', actor)).rejects.toThrow(BadRequestException);
    });

    it('downloadReport rejects an expired report', async () => {
      generatedReportModel.findById.mockReturnValue(
        execResolves(reportDoc({ expires_at: new Date(Date.now() - 1000) })),
      );
      const service = buildService();
      await expect(service.downloadReport('r1', actor)).rejects.toThrow(GoneException);
    });

    it('downloadReport verifies the checksum and rejects a corrupted file', async () => {
      generatedReportModel.findById.mockReturnValue(execResolves(reportDoc({ checksum: 'wrong-checksum' })));
      const service = buildService();
      await expect(service.downloadReport('r1', actor)).rejects.toThrow(/integrity/);
    });

    it('downloadReport succeeds and returns the file for a valid, owned, completed report', async () => {
      generatedReportModel.findById.mockReturnValue(execResolves(reportDoc()));
      const service = buildService();
      const { file, report } = await service.downloadReport('r1', actor);
      expect(file.buffer.toString()).toBe('data');
      expect(report.report_id).toBe('RPT-1');
    });

    it('deleteReport removes the stored file (when owned) and the row', async () => {
      generatedReportModel.findById.mockReturnValue(execResolves(reportDoc()));
      const service = buildService();
      await service.deleteReport('r1', actor);
      expect(fileStorageService.delete).toHaveBeenCalledWith('/uploads/x.csv');
      expect(generatedReportModel.findByIdAndDelete).toHaveBeenCalledWith('r1');
    });
  });

  describe('normalizeParams', () => {
    it('parses ISO date strings into Date objects and passes through other fields', () => {
      const service = buildService();
      const result = service.normalizeParams({
        dateFrom: '2026-01-01T00:00:00.000Z',
        dateTo: '2026-02-01T00:00:00.000Z',
        machineId: 'm1',
        technicianId: 't1',
        limit: 100,
      });

      expect(result.dateFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(result.dateTo).toEqual(new Date('2026-02-01T00:00:00.000Z'));
      expect(result.machineId).toBe('m1');
      expect(result.technicianId).toBe('t1');
      expect(result.limit).toBe(100);
    });

    it('leaves fields undefined when absent', () => {
      const service = buildService();
      expect(service.normalizeParams({})).toEqual({
        dateFrom: undefined,
        dateTo: undefined,
        machineId: undefined,
        technicianId: undefined,
        limit: undefined,
      });
    });
  });

  describe('listOwnReports / listAllReports — server-side pagination and filters', () => {
    it('listOwnReports scopes to the actor and applies type/status/format filters', async () => {
      const service = buildService();

      await service.listOwnReports(actor, {
        type: ReportType.MACHINE_HISTORY,
        status: ReportStatus.COMPLETED,
        format: ReportFormat.CSV,
        page: 2,
        limit: 5,
      });

      expect(generatedReportModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ReportType.MACHINE_HISTORY,
          status: ReportStatus.COMPLETED,
          format: ReportFormat.CSV,
          requested_by: new Types.ObjectId(actor.userId),
        }),
      );
      const chain = generatedReportModel.find.mock.results[0].value as {
        skip: jest.Mock;
        limit: jest.Mock;
      };
      expect(chain.skip).toHaveBeenCalledWith(5); // (page 2 - 1) * limit 5
      expect(chain.limit).toHaveBeenCalledWith(5);
    });

    it('listAllReports is not scoped to any single requester', async () => {
      const service = buildService();

      await service.listAllReports({});

      expect(generatedReportModel.find).toHaveBeenCalledWith({});
    });

    it('returns a real PaginatedResponse shape (items/page/limit/totalItems/totalPages)', async () => {
      const service = buildService();
      generatedReportModel.countDocuments.mockReturnValue(execResolves(37));

      const result = await service.listAllReports({ page: 1, limit: 20 });

      expect(result).toEqual(
        expect.objectContaining({
          items: [],
          page: 1,
          limit: 20,
          totalItems: 37,
          totalPages: 2,
        }),
      );
    });

    it('defaults to newest-first and falls back for a non-allow-listed sort field', async () => {
      const service = buildService();
      const chain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      generatedReportModel.find.mockReturnValue(chain);

      await service.listAllReports({ sort: 'checksum' as never });

      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    });
  });
});
