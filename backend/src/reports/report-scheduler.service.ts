import { Injectable, Logger, Optional } from '@nestjs/common';
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
import {
  SchedulerConfigService,
  defaultSchedulerSettings,
} from '../scheduler/scheduler.config';
import { SchedulerLockService } from '../scheduler/scheduler-lock.service';
import { createRunId } from '../scheduler/scheduler-utils';

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
  const dateFrom = new Date(
    now.getTime() - relativeRangeDays * 24 * 60 * 60 * 1000,
  );
  return {
    ...template,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  };
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
    @Optional()
    private readonly schedulerConfigService?: SchedulerConfigService,
    @Optional()
    private readonly schedulerLockService?: SchedulerLockService,
  ) {}

  @Cron('15 * * * *', { name: 'report-schedule-sweep' })
  async sweep(): Promise<JobResult> {
    return this.runSweep();
  }

  async runSweep(): Promise<JobResult> {
    const settings =
      this.schedulerConfigService?.getSettings() ?? defaultSchedulerSettings();
    if (!settings.enabled) {
      this.logger.log('Report scheduler skipped disabled=true');
      return { generated: 0, failed: 0, expiredCleaned: 0 };
    }

    const runId = createRunId();
    const lock = await this.schedulerLockService?.acquire(
      'report-schedule-sweep',
      runId,
      settings.lockTtlMs,
    );
    if (this.schedulerLockService && !lock) {
      this.logger.warn(
        JSON.stringify({
          jobName: 'report-schedule-sweep',
          runId,
          instanceId: this.schedulerLockService.getInstanceId(),
          status: 'skipped',
          lockAcquired: false,
        }),
      );
      return { generated: 0, failed: 0, expiredCleaned: 0 };
    }

    const startedAt = Date.now();
    const deadline = startedAt + settings.jobTimeoutMs;
    const now = new Date();
    const due = await this.scheduledReportModel
      .find({ active: true, next_run_at: { $lte: now } })
      .sort({ next_run_at: 1, _id: 1 })
      .limit(Math.min(settings.batchSize, settings.maxItemsPerRun))
      .exec();

    let generated = 0;
    let failed = 0;
    for (const schedule of due) {
      if (Date.now() >= deadline) break;
      try {
        await this.fireSchedule(schedule, now);
        generated += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Failed to fire scheduled report ${schedule.schedule_id}: ${String(error)}`,
        );
      }
    }

    const expiredCleaned =
      Date.now() < deadline ? await this.cleanupExpiredReports(deadline) : 0;
    const status = Date.now() >= deadline ? 'timed_out' : 'completed';
    this.logger.log(
      JSON.stringify({
        jobName: 'report-schedule-sweep',
        runId,
        instanceId: this.schedulerLockService?.getInstanceId() ?? 'local-test',
        status,
        lockAcquired: Boolean(lock),
        scanned: due.length,
        processed: generated + failed + expiredCleaned,
        succeeded: generated + expiredCleaned,
        failed,
        skipped: 0,
        batches: due.length ? 1 : 0,
        durationMs: Date.now() - startedAt,
      }),
    );
    if (lock) {
      await this.schedulerLockService?.release(lock, status);
    }
    return { generated, failed, expiredCleaned };
  }

  private async fireSchedule(
    schedule: ScheduledReportDocument,
    now: Date,
  ): Promise<void> {
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
          this.logger.warn(
            `Failed to create report-ready notification: ${String(error)}`,
          );
        });
    }
  }

  private async cleanupExpiredReports(deadline: number): Promise<number> {
    const settings =
      this.schedulerConfigService?.getSettings() ?? defaultSchedulerSettings();
    const expired = await this.generatedReportModel
      .find({
        expires_at: { $lte: new Date() },
        file_path: { $exists: true, $ne: null },
      })
      .sort({ expires_at: 1, _id: 1 })
      .limit(Math.min(settings.batchSize, settings.maxItemsPerRun))
      .exec();

    let cleaned = 0;
    for (const report of expired) {
      if (Date.now() >= deadline) break;
      try {
        if (
          report.file_path &&
          this.fileStorageService.ownsFile(report.file_path)
        ) {
          await this.fileStorageService.delete(report.file_path);
        }

        await this.generatedReportModel
          .findByIdAndUpdate(report._id, { $unset: { file_path: 1 } })
          .exec();
        cleaned += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to clean up expired report ${report.report_id}: ${String(error)}`,
        );
      }
    }

    return cleaned;
  }
}
