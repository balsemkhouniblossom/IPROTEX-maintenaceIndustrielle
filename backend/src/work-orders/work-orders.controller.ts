/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { WorkOrdersService } from './work-orders.service';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { WorkOrdersQueryDto } from './dto/work-orders-query.dto';
import { normalizePagination } from '../common/pagination';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AdminOnly,
  AuthenticatedRoles,
  Roles,
} from '../auth/decorators/roles.decorator';
import { Role } from '../schemas/user.schema';
import { DecidePartRequestDto } from './dto/decide-part-request.dto';
import { ValidateWorkOrderDto } from './dto/validate-work-order.dto';
import { RescheduleWorkOrderDto } from './dto/reschedule-work-order.dto';

interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
    role?: string;
  };
}

@Controller('work-orders')
@AuthenticatedRoles()
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Post()
  @AdminOnly()
  create(@Body() createWorkOrderDto: CreateWorkOrderDto) {
    return this.workOrdersService.create(createWorkOrderDto);
  }

  @Get()
  @AdminOnly()
  findAll(@Query() query: WorkOrdersQueryDto) {
    const pagination = normalizePagination(query.page, query.limit);
    return this.workOrdersService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
      query,
    );
  }

  @Get('statistics')
  @AdminOnly()
  getStatistics() {
    return this.workOrdersService.getStatistics();
  }

  @Patch('part-requests/:id/decision')
  @Roles(Role.TECHNICIAN, Role.ADMIN)
  decidePartRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: DecidePartRequestDto,
  ) {
    const deciderId = req.user?.userId;
    if (!deciderId) {
      throw new ForbiddenException('Missing authenticated user');
    }
    return this.workOrdersService.decidePartRequest({
      requestId: id,
      decision: dto.action,
      deciderId,
      reason: dto.reason,
    });
  }

  @Get('calendar/events')
  @AdminOnly()
  getCalendarEvents(
    @Query('view') view?: 'day' | 'week' | 'month' | 'year' | 'timeline',
    @Query('date') date?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('operatorId') operatorId?: string,
    @Query('technicianId') technicianId?: string,
    @Query('maintenanceType') maintenanceType?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('month') month?: string,
    @Query('week') week?: string,
    @Query('year') year?: string,
  ): Promise<any> {
    return this.workOrdersService.getCalendarEvents(
      view || 'month',
      date ? new Date(date) : new Date(),
      {
        machineId,
        machineTypeId,
        operatorId,
        technicianId,
        maintenanceType,
        status,
        priority,
        month: month ? Number(month) : undefined,
        week: week ? Number(week) : undefined,
        year: year ? Number(year) : undefined,
      },
    );
  }

  @Get('calendar/timeline')
  @AdminOnly()
  getTimeline(
    @Query('date') date?: string,
    @Query('machineId') machineId?: string,
  ): Promise<any> {
    return this.workOrdersService.getTimeline(
      date ? new Date(date) : new Date(),
      machineId,
    );
  }

  @Get('calendar/widget')
  @AdminOnly()
  getCalendarWidget(): Promise<any> {
    return this.workOrdersService.getDashboardCalendarWidget();
  }

  @Get('calendar/notifications')
  @AdminOnly()
  getNotificationCards(): Promise<any> {
    return this.workOrdersService.getNotificationCards();
  }

  @Get('calendar/corrective-assistant')
  @AdminOnly()
  getCorrectiveAssistant(@Query('machineId') machineId?: string): Promise<any> {
    return this.workOrdersService.getCorrectiveAssistant(machineId);
  }

  @Get('calendar/event/:id')
  @AdminOnly()
  async getCalendarEventDetails(@Param('id') id: string) {
    const details = await this.workOrdersService.getCalendarEventDetails(id);
    if (!details) {
      throw new NotFoundException('Calendar event not found');
    }
    return details;
  }

  @Post(':id/complete')
  @AdminOnly()
  async complete(@Param('id') id: string) {
    const nowIso = new Date().toISOString();
    return this.workOrdersService.update(id, {
      status: 'completed',
      date_end: nowIso,
      date_closed: nowIso,
    });
  }

  @Post(':id/validation')
  @AdminOnly()
  async validateWorkOrder(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    payload: ValidateWorkOrderDto,
  ) {
    const action = payload.action || 'approve';
    return this.workOrdersService.applyValidationAction(
      id,
      action,
      req.user?.userId,
    );
  }

  @Patch(':id/reschedule')
  @UseGuards(JwtAuthGuard)
  @AdminOnly()
  async reschedule(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    payload: RescheduleWorkOrderDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Missing authenticated user');
    }
    return this.workOrdersService.reschedulePreventiveOccurrence({
      workOrderId: id,
      newDueDate: payload.new_due_date,
      reason: payload.reason,
      userId,
      role: req.user?.role,
    });
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.workOrdersService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @Param('id') id: string,
    @Body() updateWorkOrderDto: UpdateWorkOrderDto,
  ) {
    return this.workOrdersService.update(id, updateWorkOrderDto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.workOrdersService.remove(id);
  }
}
