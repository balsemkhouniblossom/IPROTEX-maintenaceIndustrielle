import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { normalizePagination } from '../common/pagination';
import { OperatorService } from './operator.service';

type CalendarView = 'day' | 'week' | 'month' | 'year' | 'timeline';

interface AuthenticatedUser {
  userId?: string;
  role?: string;
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Controller('operator')
@UseGuards(JwtAuthGuard)
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
  ) {
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
  ) {
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

  @Get('calendar/my')
  getMyCalendar(
    @Req() req: AuthenticatedRequest,
    @Query('view') view?: CalendarView,
    @Query('date') date?: string,
    @Query('machineId') machineId?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('maintenanceType') maintenanceType?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('month') month?: string,
    @Query('week') week?: string,
    @Query('year') year?: string,
  ) {
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
