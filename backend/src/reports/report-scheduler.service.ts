import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as businessTime from '../common/business-time';
import {
  GeneratedReport,
  GeneratedReportDocument,
  ReportStatus,
} from '../schemas/generated-report.schema';
import {
  ScheduledReport,
  ScheduledReportDocument,
  ScheduleFrequency,
} from '../schemas/scheduled-report.schema';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import { FileStorageService } from '../storage/file-storage.service';
import { ReportsService } from './reports.service';

type JobResult = { generated: number; failed: number; expiredCleaned: number };

function computeNextRun(frequency: ScheduleFrequency, from: Date): Date {
  switch (frequency) {
    case ScheduleFrequency.DAILY:
      return businessTime.addBusinessDays(from, 1);
    case ScheduleFrequency.WEEKLY:
      return businessTime.addBusinessDays(from, 7);
    case ScheduleFrequency.MONTHLY:
      return businessTime.addBusinessMonths(from, 1);
    default:
      return businessTime.addBusinessDays(from, 1);
  }
}

/**
 * Resolves a scheduled report's template parameters into concrete ones for
 * *this* firing. `relativeRangeDays` (when present) is recomputed every
 * run as "now minus N days" through "now" — a fixed `dateFrom`/`dateTo`
 * baked into the schedule would only ever cover the same frozen window,
 * which defeats the point of a recurring report. Every other key passes
 * through unchanged.
 */
function resolveScheduledParameters(
  template: Record<string, unknown>,
  now: Date,
): Record<string, unknown> {
  const relativeRangeDays = template.relativeRangeDays;
  if (typeof relativeRangeDays !== 'number' || relativeRangeDays <= 0) {
    return template;
  }

  const dateTo = now;
  const dateFrom = new Date(now.getTime() - relativeRangeDays * 24 * 60 * 60 * 1000);
  return { ...template, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() };
}

/**
 * Two independent jobs on one hourly tick: fire every due `ScheduledReport`
 * (generating a normal `GeneratedReport` through the exact same
 * `ReportsService.generateReport` pipeline an on-demand request uses — no
 * separate scheduled-generation code path to drift out of sync), and clean
 * up the stored *file* behind any `GeneratedReport` whose `expires_at` has
 * passed (the TTL index on that schema only ever removes the database row,
 * never the external file it points at).
 */
@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    @InjectModel(ScheduledReport.name)
    private readonly scheduledReportModel: Model<ScheduledReportDocument>,
    @InjectModel(GeneratedReport.name)
    private readonly generatedReportModel: Model<GeneratedReportDocument>,
    private readonly reportsService: ReportsService,
    private readonly notificationCenterService: NotificationCenterService,
    private readonly fileStorageService: FileStorageService,
  ) {}

  @Cron('15 * * * *', { name: 'report-schedule-sweep' })
  async sweep(): Promise<JobResult> {
    return this.runSweep();
  }

  async runSweep(): Promise<JobResult> {
    const now = new Date();
    const due = await this.scheduledReportModel
      .find({ active: true, next_run_at: { $lte: now } })
      .exec();

    let generated = 0;
    let failed = 0;
    for (const schedule of due) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.fireSchedule(schedule, now);
        generated += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Failed to fire scheduled report ${schedule.schedule_id}: ${String(error)}`);
      }
    }

    const expiredCleaned = await this.cleanupExpiredReports();
    return { generated, failed, expiredCleaned };
  }

  private async fireSchedule(schedule: ScheduledReportDocument, now: Date): Promise<void> {
    const actor = { userId: schedule.created_by.toString(), role: 'admin' };
    const parameters = resolveScheduledParameters(schedule.parameters, now);

    const report = await this.reportsService.requestReport(
      { type: schedule.type, format: schedule.format, parameters },
      actor,
    );
    await this.generatedReportModel
      .findByIdAndUpdate(report._id, { scheduled_report_id: schedule._id })
      .exec();
    // Scheduled firings can afford to wait for generation — unlike an HTTP
    // request, there's no client blocked on this call.
    const completed = await this.reportsService.generateReport(
      report._id.toString(),
      { type: schedule.type, format: schedule.format, parameters },
      actor,
    );

    await this.scheduledReportModel
      .findByIdAndUpdate(schedule._id, {
        last_run_at: now,
        next_run_at: computeNextRun(schedule.frequency, now),
      })
      .exec();

    if (completed.status === ReportStatus.COMPLETED) {
      await this.notificationCenterService
        .createIfNotExists({
          dedupeKey: `report_ready:${completed._id.toString()}`,
          type: NotificationType.REPORT_READY,
          title: `Scheduled report ready: ${schedule.type}`,
          recipientUserId: schedule.created_by.toString(),
          referenceId: completed._id.toString(),
        })
        .catch((error) => {
          this.logger.warn(`Failed to create report-ready notification: ${String(error)}`);
        });
    }
  }

  private async cleanupExpiredReports(): Promise<number> {
    const expired = await this.generatedReportModel
      .find({ expires_at: { $lte: new Date() }, file_path: { $exists: true, $ne: null } })
      .exec();

    for (const report of expired) {
      try {
        if (report.file_path && this.fileStorageService.ownsFile(report.file_path)) {
          // eslint-disable-next-line no-await-in-loop
          await this.fileStorageService.delete(report.file_path);
        }
        // eslint-disable-next-line no-await-in-loop
        await this.generatedReportModel
          .findByIdAndUpdate(report._id, { $unset: { file_path: 1 } })
          .exec();
      } catch (error) {
        this.logger.warn(`Failed to clean up expired report ${report.report_id}: ${String(error)}`);
      }
    }

    return expired.length;
  }
}
