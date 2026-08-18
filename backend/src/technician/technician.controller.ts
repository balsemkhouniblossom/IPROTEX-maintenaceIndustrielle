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
import { normalizePagination, PaginatedResponse } from '../common/pagination';
import {
  TechnicianDashboardResponse,
  TechnicianService,
  TechnicianWorkOrderView,
} from './technician.service';
import { TechnicianOnly } from '../auth/decorators/roles.decorator';
import { ReviewWorkOrderDto } from './dto/review-work-order.dto';
import { UpdateTechnicianReportDto } from './dto/update-technician-report.dto';
import { SetPartQuantityDto } from './dto/set-part-quantity.dto';
import {
  TechnicianPartResponse,
  TechnicianWorkOrderDetailResponse,
} from './contracts/technician-response.types';
import { InterventionReportResponse } from '../common/response/intervention-report-response';
import { DocumentSummaryResponse } from '../common/response/document-response';
import { StockResponse } from '../common/response/catalogue-response';
import { WorkOrderResponse } from '../work-orders/contracts/work-order-response.types';

interface TechnicianRequest extends Request {
  user?: { userId?: string; role?: string };
}

interface TechnicianWorkOrdersQuery {
  page?: string;
  limit?: string;
  status?: string;
  maintenanceType?: string;
  priority?: string;
  machineId?: string;
  machineTypeId?: string;
  dateFrom?: string;
  dateTo?: string;
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
  dashboard(
    @Req() req: TechnicianRequest,
  ): Promise<TechnicianDashboardResponse> {
    return this.technicianService.dashboard(this.technicianId(req));
  }

  @Get('work-orders')
  workOrders(
    @Req() req: TechnicianRequest,
    @Query() query: TechnicianWorkOrdersQuery,
  ): Promise<PaginatedResponse<TechnicianWorkOrderView>> {
    const {
      page,
      limit,
      status,
      maintenanceType,
      priority,
      machineId,
      machineTypeId,
      dateFrom,
      dateTo,
    } = query;
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
  details(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
  ): Promise<TechnicianWorkOrderDetailResponse> {
    return this.technicianService.details(this.technicianId(req), id);
  }

  @Get('manuals')
  manuals(
    @Req() req: TechnicianRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('machineId') machineId?: string,
  ): Promise<PaginatedResponse<DocumentSummaryResponse>> {
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
  ): Promise<PaginatedResponse<StockResponse>> {
    const pagination = normalizePagination(page, limit, 50);
    return this.technicianService.availableParts(
      this.technicianId(req),
      pagination,
    );
  }

  @Patch('work-orders/:id/claim')
  claim(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
  ): Promise<WorkOrderResponse> {
    return this.technicianService.claim(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/review')
  review(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
    @Body() body: ReviewWorkOrderDto,
  ): Promise<WorkOrderResponse | null> {
    return this.technicianService.review(
      this.technicianId(req),
      id,
      body.action,
    );
  }

  @Patch('work-orders/:id/start')
  start(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
  ): Promise<WorkOrderResponse> {
    return this.technicianService.start(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/waiting-parts')
  waitingParts(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
  ): Promise<WorkOrderResponse> {
    return this.technicianService.waitingParts(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/resume')
  resume(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
  ): Promise<WorkOrderResponse> {
    return this.technicianService.resume(this.technicianId(req), id);
  }

  @Patch('work-orders/:id/report')
  updateReport(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
    @Body()
    body: UpdateTechnicianReportDto,
  ): Promise<InterventionReportResponse> {
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
  ): Promise<TechnicianPartResponse> {
    return this.technicianService.setPartQuantity(
      this.technicianId(req),
      id,
      body.partId,
      body.quantity,
    );
  }

  @Patch('work-orders/:id/close')
  close(
    @Req() req: TechnicianRequest,
    @Param('id') id: string,
  ): Promise<WorkOrderResponse> {
    return this.technicianService.close(this.technicianId(req), id);
  }
}
