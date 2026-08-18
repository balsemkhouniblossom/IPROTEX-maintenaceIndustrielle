import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { ReportsService } from './reports.service';
import { ScheduledReportsService } from './scheduled-reports.service';
import { RequestReportDto } from './dto/request-report.dto';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';
import { UpdateScheduledReportDto } from './dto/update-scheduled-report.dto';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { REPORT_TYPE_ROLES } from './report-access';
import type { ReportActor } from './report.interfaces';
import { Role } from '../schemas/user.schema';

function actorFrom(req: AuthenticatedRequest): ReportActor {
  return { userId: req.user!.userId!, role: req.user!.role as Role };
}

function sanitizeDownloadFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_') || 'report';
}

/**
 * Every GET here (besides `/download`, which streams a file rather than
 * JSON) is read-only. `POST /reports` and `POST /reports/schedules` are
 * the only writes that create new work; nothing in this controller ever
 * mutates a WorkOrder, Stock, Document, or Machine record — every report
 * is an export of data those modules already own.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly scheduledReportsService: ScheduledReportsService,
  ) {}

  @Get('types')
  @AuthenticatedRoles()
  getAvailableTypes(@Req() req: AuthenticatedRequest) {
    const role = req.user!.role!;
    return Object.entries(REPORT_TYPE_ROLES)
      .filter(([, roles]) => roles.includes(role as never))
      .map(([type]) => type);
  }

  @Get('all')
  @AdminOnly()
  listAllReports(@Query() query: ReportsQueryDto) {
    return this.reportsService.listAllReports(query);
  }

  @Get('schedules')
  @AuthenticatedRoles()
  listSchedules(@Req() req: AuthenticatedRequest) {
    return this.scheduledReportsService.listForActor(actorFrom(req));
  }

  @Post('schedules')
  @AuthenticatedRoles()
  createSchedule(
    @Body() dto: CreateScheduledReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scheduledReportsService.create(dto, actorFrom(req));
  }

  @Patch('schedules/:id')
  @AuthenticatedRoles()
  updateSchedule(
    @Param('id') id: string,
    @Body() dto: UpdateScheduledReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.scheduledReportsService.update(id, dto, actorFrom(req));
  }

  @Delete('schedules/:id')
  @AuthenticatedRoles()
  removeSchedule(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.scheduledReportsService.remove(id, actorFrom(req));
  }

  @Post()
  @AuthenticatedRoles()
  requestReport(
    @Body() dto: RequestReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.requestReport(dto, actorFrom(req));
  }

  @Get()
  @AuthenticatedRoles()
  listOwnReports(
    @Req() req: AuthenticatedRequest,
    @Query() query: ReportsQueryDto,
  ) {
    return this.reportsService.listOwnReports(actorFrom(req), query);
  }

  @Get(':id')
  @AuthenticatedRoles()
  getReport(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getReport(id, actorFrom(req));
  }

  @Delete(':id')
  @AuthenticatedRoles()
  async deleteReport(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.reportsService.deleteReport(id, actorFrom(req));
    return { deleted: true };
  }

  @Get(':id/download')
  @AuthenticatedRoles()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async download(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const { file, report } = await this.reportsService.downloadReport(
      id,
      actorFrom(req),
    );

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.size));
    const fileExtension = file.fileName.split('.').pop();
    const downloadFileName = sanitizeDownloadFileName(
      `${report.report_id}.${fileExtension}`,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${downloadFileName}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.buffer);
  }
}
