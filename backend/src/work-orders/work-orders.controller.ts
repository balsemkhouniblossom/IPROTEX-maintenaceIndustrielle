import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { WorkOrdersService } from './work-orders.service';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { normalizePagination } from '../common/pagination';

@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Post()
  create(@Body() createWorkOrderDto: CreateWorkOrderDto) {
    return this.workOrdersService.create(createWorkOrderDto);
  }

  @Get()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);
    return this.workOrdersService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get('statistics')
  getStatistics() {
    return this.workOrdersService.getStatistics();
  }

  @Get('calendar/events')
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
  getCalendarWidget(): Promise<any> {
    return this.workOrdersService.getDashboardCalendarWidget();
  }

  @Get('calendar/notifications')
  getNotificationCards(): Promise<any> {
    return this.workOrdersService.getNotificationCards();
  }

  @Get('calendar/corrective-assistant')
  getCorrectiveAssistant(@Query('machineId') machineId?: string): Promise<any> {
    return this.workOrdersService.getCorrectiveAssistant(machineId);
  }

  @Get('calendar/event/:id')
  async getCalendarEventDetails(@Param('id') id: string) {
    const details = await this.workOrdersService.getCalendarEventDetails(id);
    if (!details) {
      throw new NotFoundException('Calendar event not found');
    }
    return details;
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string) {
    const nowIso = new Date().toISOString();
    return this.workOrdersService.update(id, {
      status: 'completed',
      date_end: nowIso,
      date_closed: nowIso,
    });
  }

  @Post(':id/validation')
  async validateWorkOrder(
    @Param('id') id: string,
    @Body()
    payload: {
      action?: 'approve' | 'reject' | 'request_correction';
      technician_id?: string;
    },
  ) {
    const action = payload.action || 'approve';
    return this.workOrdersService.applyValidationAction(
      id,
      action,
      payload.technician_id,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workOrdersService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWorkOrderDto: UpdateWorkOrderDto,
  ) {
    return this.workOrdersService.update(id, updateWorkOrderDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workOrdersService.remove(id);
  }
}
