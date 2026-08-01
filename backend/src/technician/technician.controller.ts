import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { normalizePagination } from '../common/pagination';
import { TechnicianService } from './technician.service';
import { TechnicianOnly } from '../auth/decorators/roles.decorator';
import { ReviewWorkOrderDto } from './dto/review-work-order.dto';
import { UpdateTechnicianReportDto } from './dto/update-technician-report.dto';
import { SetPartQuantityDto } from './dto/set-part-quantity.dto';

interface TechnicianRequest extends Request {
  user?: { userId?: string; role?: string };
}

@Controller('technician')
@UseGuards(JwtAuthGuard)
@TechnicianOnly()
export class TechnicianController {
  constructor(private readonly technicianService: TechnicianService) {}

  private technicianId(req: TechnicianRequest): string {
    if (!req.user?.userId || req.user.role?.toLowerCase() !== 'technician') {
      throw new ForbiddenException('Technician scope required');
    }
    return req.user.userId;
  }

  @Get('dashboard')
  dashboard(@Req() req: TechnicianRequest) {
    return this.technicianService.dashboard(this.technicianId(req));
  }

  @Get('work-orders')
  workOrders(
    @Req() req: TechnicianRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('maintenanceType') maintenanceType?: string,
    @Query('priority') priority?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const pagination = normalizePagination(page, limit, 20);
    return this.technicianService.workOrders(
      this.technicianId(req),
      pagination,
      {
        status,
        maintenanceType,
        priority,
        machineId,
        machineTypeId,
        dateFrom,
        dateTo,
      },
    );
  }

  @Get('work-orders/:id')
  details(@Req() req: TechnicianRequest, @Param('id') id: string) {
    return this.technicianService.details(this.technicianId(req), id);
  }

  @Get('manuals')
  manuals(
    @Req() req: TechnicianRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('machineId') machineId?: string,
  ) {
    const pagination = normalizePagination(page, limit, 20);
    return this.technicianService.manuals(
      this.technicianId(req),
      pagination,
      machineId,
    );
  }

  @Get('parts')
  parts(
    @Req() req: TechnicianRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pagination = normalizePagination(page, limit, 50);
    return this.technicianService.availableParts(
      this.technicianId(req),
      pagination,
    );
  }

  @Patch('work-orders/:id/claim')
  claim(@Req() req: TechnicianRequest, @Param('id') id: string) {
    return this.technicianService.claim(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/review')
  review(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
    @Body() body: ReviewWorkOrderDto,
  ) {
    return this.technicianService.review(
      this.technicianId(req),
      id,
      body.action,
    );
  }

  @Patch('work-orders/:id/start')
  start(@Req() req: TechnicianRequest, @Param('id') id: string) {
    return this.technicianService.start(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/waiting-parts')
  waitingParts(@Req() req: TechnicianRequest, @Param('id') id: string) {
    return this.technicianService.waitingParts(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/resume')
  resume(@Req() req: TechnicianRequest, @Param('id') id: string) {
    return this.technicianService.resume(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/report')
  updateReport(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
    @Body()
    body: UpdateTechnicianReportDto,
  ) {
    return this.technicianService.updateReport(
      this.technicianId(req),
      id,
      body,
    );
  }

  @Post('work-orders/:id/parts')
  setPartQuantity(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
    @Body() body: SetPartQuantityDto,
  ) {
    return this.technicianService.setPartQuantity(
      this.technicianId(req),
      id,
      body.partId,
      body.quantity,
    );
  }

  @Patch('work-orders/:id/close')
  close(@Req() req: TechnicianRequest, @Param('id') id: string) {
    return this.technicianService.close(this.technicianId(req), id);
  }
}
