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
import { KpisService } from './kpis.service';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { CreateKpiDto } from './dto/create-kpi.dto';
import { UpdateKpiDto } from './dto/update-kpi.dto';

@Controller('kpis')
@AuthenticatedRoles()
export class KpisController {
  constructor(private readonly kpisService: KpisService) {}

  @Post()
  @AdminOnly()
  create(@Body() payload: CreateKpiDto) {
    return this.kpisService.create(payload);
  }

  @Get()
  @AdminOnly()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);
    return this.kpisService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.kpisService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() payload: UpdateKpiDto) {
    return this.kpisService.update(id, payload);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.kpisService.remove(id);
  }
}
