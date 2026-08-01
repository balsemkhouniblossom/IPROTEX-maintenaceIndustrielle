import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import * as businessTime from '../common/business-time';
import {
  ScheduledReport,
  ScheduledReportDocument,
  ScheduleFrequency,
} from '../schemas/scheduled-report.schema';
import { Role } from '../schemas/user.schema';
import { canRequestReportType } from './report-access';
import { ReportActor } from './report.interfaces';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';
import { UpdateScheduledReportDto } from './dto/update-scheduled-report.dto';

function firstRunAt(frequency: ScheduleFrequency, from: Date): Date {
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

/** CRUD for recurring report definitions — Admin-only, kept separate from `ReportsService` (which owns generation/lifecycle of the reports these schedules produce) for the same reason `PredictiveMaintenanceTrainingService` is split from `PredictiveMaintenanceService`: distinct write-side concern, distinct blast radius. */
@Injectable()
export class ScheduledReportsService {
  constructor(
    @InjectModel(ScheduledReport.name)
    private readonly scheduledReportModel: Model<ScheduledReportDocument>,
  ) {}

  async create(
    dto: CreateScheduledReportDto,
    actor: ReportActor,
  ): Promise<ScheduledReportDocument> {
    if (!canRequestReportType(actor.role, dto.type)) {
      throw new ForbiddenException(
        `Your role may not schedule a ${dto.type} report`,
      );
    }

    const now = new Date();
    return this.scheduledReportModel.create({
      schedule_id: `SCH-${crypto.randomUUID()}`,
      type: dto.type,
      format: dto.format,
      parameters: dto.parameters ?? {},
      frequency: dto.frequency,
      active: true,
      created_by: new Types.ObjectId(actor.userId),
      next_run_at: firstRunAt(dto.frequency, now),
    });
  }

  async listForActor(actor: ReportActor): Promise<ScheduledReportDocument[]> {
    const filter =
      actor.role === Role.ADMIN
        ? {}
        : { created_by: new Types.ObjectId(actor.userId) };
    return this.scheduledReportModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    dto: UpdateScheduledReportDto,
    actor: ReportActor,
  ): Promise<ScheduledReportDocument> {
    const schedule = await this.getOwned(id, actor);

    if (dto.frequency && dto.frequency !== schedule.frequency) {
      schedule.next_run_at = firstRunAt(dto.frequency, new Date());
      schedule.frequency = dto.frequency;
    }
    if (dto.active !== undefined) schedule.active = dto.active;
    if (dto.parameters !== undefined) schedule.parameters = dto.parameters;

    await schedule.save();
    return schedule;
  }

  async remove(id: string, actor: ReportActor): Promise<void> {
    const schedule = await this.getOwned(id, actor);
    await this.scheduledReportModel.findByIdAndDelete(schedule._id).exec();
  }

  private async getOwned(
    id: string,
    actor: ReportActor,
  ): Promise<ScheduledReportDocument> {
    const schedule = await this.scheduledReportModel.findById(id).exec();
    if (!schedule) throw new NotFoundException('Scheduled report not found');
    if (
      actor.role !== Role.ADMIN &&
      schedule.created_by.toString() !== actor.userId
    ) {
      throw new ForbiddenException(
        'You may only manage your own scheduled reports',
      );
    }
    return schedule;
  }
}
