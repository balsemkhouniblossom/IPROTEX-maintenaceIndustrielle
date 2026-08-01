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
} from '@nestjs/common';
import type { Request } from 'express';
import { MaintenancePlansService } from './maintenance-plans.service';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import {
  CreateMaintenancePlanDto,
  TransitionMaintenancePlanDto,
} from './dto/create-maintenance-plan.dto';
import { UpdateMaintenancePlanDto } from './dto/update-maintenance-plan.dto';
import { MaintenancePlansQueryDto } from './dto/maintenance-plans-query.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string; role?: string };
}

@Controller('maintenance-plans')
@AuthenticatedRoles()
export class MaintenancePlansController {
  constructor(
    private readonly maintenancePlansService: MaintenancePlansService,
  ) {}

  @Post()
  @AdminOnly()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMaintenancePlanDto,
  ) {
    return this.maintenancePlansService.create(dto, req.user?.userId);
  }

  @Get()
  @AdminOnly()
  findAll(@Query() query: MaintenancePlansQueryDto) {
    const pagination = normalizePagination(query.page, query.limit);
    return this.maintenancePlansService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
      query,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.maintenancePlansService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateMaintenancePlanDto,
  ) {
    return this.maintenancePlansService.update(id, dto, req.user?.userId);
  }

  @Patch(':id/transition')
  @AdminOnly()
  transition(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: TransitionMaintenancePlanDto,
  ) {
    return this.maintenancePlansService.transition(id, dto, req.user?.userId);
  }

  @Delete(':id')
  @AdminOnly()
  remove(
    @Param('id') id: string,
    @Query('expected_version') expectedVersion?: string,
  ) {
    const parsedVersion =
      expectedVersion !== undefined ? Number(expectedVersion) : undefined;
    return this.maintenancePlansService.remove(id, parsedVersion);
  }
}
