import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { normalizePagination } from '../common/pagination';
import { CreatePreventiveTaskDto } from './dto/create-preventive-task.dto';
import { UpdatePreventiveTaskDto } from './dto/update-preventive-task.dto';
import { PreventiveTasksService } from './preventive-tasks.service';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';

@Controller('preventive-tasks')
@AuthenticatedRoles()
export class PreventiveTasksController {
  constructor(private readonly service: PreventiveTasksService) {}
  @Post()
  @AdminOnly()
  create(@Body() dto: CreatePreventiveTaskDto) {
    return this.service.create(dto);
  }
  @Post('sync-plans')
  @AdminOnly()
  syncPlans() {
    return this.service.syncPlans();
  }
  @Get()
  @AdminOnly()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const p = normalizePagination(page, limit, 10, 1000);
    return this.service.findAll(p.page, p.limit, p.skip, status);
  }
  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() dto: UpdatePreventiveTaskDto) {
    return this.service.update(id, dto);
  }
  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
