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
import { OperatorService } from './operator.service';
import { OperatorOnly } from '../auth/decorators/roles.decorator';
import { CreateCorrectiveReportDto } from './dto/create-corrective-report.dto';
import { SubmitPreventiveMaintenanceDto } from './dto/submit-preventive-maintenance.dto';
import { CreatePartRequestDto } from './dto/create-part-request.dto';
import { RescheduleCalendarEventDto } from './dto/reschedule-calendar-event.dto';
import { SchedulePreventiveDto } from './dto/schedule-preventive.dto';
import { UpdatePreventiveTaskChecklistDto } from './dto/update-preventive-task-checklist.dto';
import { WorkOrderResponse } from '../work-orders/contracts/work-order-response.types';
import { CalendarEventsResponse } from '../work-orders/services/work-order-calendar-query.service';
import { InterventionReportResponse } from '../common/response/intervention-report-response';

type CalendarView = 'day' | 'week' | 'month' | 'year' | 'timeline';

interface OperatorCalendarQuery {
  view?: CalendarView;
  date?: string;
  machineId?: string;
  machineTypeId?: string;
  maintenanceType?: string;
  status?: string;
  priority?: string;
  month?: string;
  week?: string;
  year?: string;
}

interface AuthenticatedUser {
  userId?: string;
  role?: string;
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Controller('operator')
@UseGuards(JwtAuthGuard)
@OperatorOnly()
export class OperatorController {
  constructor(private readonly operatorService: OperatorService) {}

  private ensureOperator(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;
    const role = (req.user?.role || '').toLowerCase();

    if (!userId) {
      throw new ForbiddenException('Missing authenticated user');
    }

    if (role !== 'operator') {
      throw new ForbiddenException('Operator scope required');
    }

    return userId;
  }

  @Get('work-orders/my')
  getMyWorkOrders(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedResponse<WorkOrderResponse>> {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getMyWorkOrders(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('reports/my')
  getMyReports(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedResponse<InterventionReportResponse>> {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getMyReports(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('machines/my')
  getMyMachines(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('machineTypeId') machineTypeId?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getMyMachines(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
      machineTypeId,
    );
  }

  @Get('machine-types')
  getMachineTypes(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getMachineTypes(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('modules')
  getModules(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getModules(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('maintenance-plans')
  getMaintenancePlans(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit, 10, 1000);
    return this.operatorService.getMaintenancePlans(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('preventive-tasks')
  getPreventiveTaskChecklist(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('status') status?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit, 10, 1000);
    return this.operatorService.getPreventiveTaskChecklist(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
      { machineId, machineTypeId, status },
    );
  }

  @Patch('preventive-tasks/:id')
  updatePreventiveTaskChecklist(
    @Req() req: AuthenticatedRequest,
    @Param('id') taskId: string,
    @Body() dto: UpdatePreventiveTaskChecklistDto,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.updatePreventiveTaskChecklist(
      userId,
      taskId,
      dto,
    );
  }

  @Get('lubrifiants')
  getLubrifiants(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit, 10, 1000);
    return this.operatorService.getLubrifiants(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('kpis')
  getKpis(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit, 10, 1000);
    return this.operatorService.getKpis(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('catalogues')
  getCatalogues(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getCatalogues(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('stocks')
  getStocks(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getStocks(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('calendar/my')
  getMyCalendar(
    @Req() req: AuthenticatedRequest,
    @Query() query: OperatorCalendarQuery,
  ): Promise<CalendarEventsResponse> {
    const {
      view,
      date,
      machineId,
      machineTypeId,
      maintenanceType,
      status,
      priority,
      month,
      week,
      year,
    } = query;
    const userId = this.ensureOperator(req);
    return this.operatorService.getMyCalendar(userId, {
      view: view || 'month',
      date: date ? new Date(date) : new Date(),
      machineId,
      machineTypeId,
      maintenanceType,
      status,
      priority,
      month: month ? Number(month) : undefined,
      week: week ? Number(week) : undefined,
      year: year ? Number(year) : undefined,
    });
  }

  @Get('dashboard')
  getDashboard(@Req() req: AuthenticatedRequest) {
    const userId = this.ensureOperator(req);
    return this.operatorService.getDashboard(userId);
  }

  @Get('calendar/widget')
  getCalendarWidget(@Req() req: AuthenticatedRequest) {
    const userId = this.ensureOperator(req);
    return this.operatorService.getCalendarWidget(userId);
  }

  @Get('calendar/notifications')
  getCalendarNotifications(@Req() req: AuthenticatedRequest) {
    const userId = this.ensureOperator(req);
    return this.operatorService.getCalendarNotifications(userId);
  }

  @Get('calendar/timeline')
  getCalendarTimeline(
    @Req() req: AuthenticatedRequest,
    @Query('date') date?: string,
    @Query('machineId') machineId?: string,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.getCalendarTimeline(userId, {
      date: date ? new Date(date) : new Date(),
      machineId,
    });
  }

  @Get('calendar/events/:id')
  getCalendarEventDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id') workOrderId: string,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.getCalendarEventDetails(userId, workOrderId);
  }

  @Post('calendar/events/:id/start')
  startCalendarEvent(
    @Req() req: AuthenticatedRequest,
    @Param('id') workOrderId: string,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.startCalendarEvent(userId, workOrderId);
  }

  @Post('calendar/events/:id/complete')
  completeCalendarEvent(
    @Req() req: AuthenticatedRequest,
    @Param('id') workOrderId: string,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.completeCalendarEvent(userId, workOrderId);
  }

  @Patch('calendar/events/:id/reschedule')
  rescheduleCalendarEvent(
    @Req() req: AuthenticatedRequest,
    @Param('id') workOrderId: string,
    @Body() dto: RescheduleCalendarEventDto,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.rescheduleCalendarEvent(userId, workOrderId, {
      newDueDate: dto.new_due_date,
      reason: dto.reason,
    });
  }

  @Get('preventive/states')
  getPreventiveStates(
    @Req() req: AuthenticatedRequest,
    @Query('machineId') machineId?: string,
  ) {
    const userId = this.ensureOperator(req);
    if (!machineId) {
      throw new ForbiddenException('Machine is required');
    }
    return this.operatorService.getPreventiveStates(userId, machineId);
  }

  @Post('preventive/schedule')
  schedulePreventive(
    @Req() req: AuthenticatedRequest,
    @Body()
    payload: SchedulePreventiveDto,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.schedulePreventive(userId, {
      machineId: payload.machine_id,
      planId: payload.plan_id,
      scheduledDate: payload.scheduled_date,
    });
  }

  @Post('report-problem')
  createCorrectiveReport(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCorrectiveReportDto,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.createCorrectiveReport(userId, {
      machineId: dto.machine_id,
      codePanne: dto.code_panne,
      faultDescription: dto.fault_description,
      actions: dto.actions,
      priority: dto.priority,
    });
  }

  @Post('preventive/submit')
  submitPreventiveMaintenance(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitPreventiveMaintenanceDto,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.submitPreventiveMaintenance(userId, {
      workOrderId: dto.work_order_id,
      tasksCompleted: dto.tasks_completed,
      condition: dto.condition,
      comments: dto.comments,
      lubrication: dto.lubrication
        ? {
            lubrifiantId: dto.lubrication.lubrifiant_id,
            quantity: dto.lubrication.quantity,
          }
        : undefined,
    });
  }

  @Post('work-orders/:id/parts-request')
  requestParts(
    @Req() req: AuthenticatedRequest,
    @Param('id') workOrderId: string,
    @Body() dto: CreatePartRequestDto,
  ) {
    const userId = this.ensureOperator(req);
    return this.operatorService.requestParts(userId, {
      workOrderId,
      partId: dto.part_id,
      quantity: dto.quantity,
    });
  }

  @Get('manuals')
  getManuals(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getOperatorManuals(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
      machineId,
      machineTypeId,
    );
  }

  @Get('faults')
  getFaults(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('search') search?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getFaultsForOperator(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
      {
        machineId,
        machineTypeId,
        search,
      },
    );
  }

  @Get('fault-solutions')
  getFaultSolutions(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('panneId') panneId?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('search') search?: string,
  ) {
    const userId = this.ensureOperator(req);
    const pagination = normalizePagination(page, limit);
    return this.operatorService.getFaultSolutionsForOperator(
      userId,
      pagination.page,
      pagination.limit,
      pagination.skip,
      {
        panneId,
        machineId,
        machineTypeId,
        search,
      },
    );
  }
}
