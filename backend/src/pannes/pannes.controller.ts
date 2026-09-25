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
import { PannesService } from './pannes.service';
import { CreatePanneDto } from './dto/create-panne.dto';
import { UpdatePanneDto } from './dto/update-panne.dto';
import { UpsertPannePartDto } from './dto/upsert-panne-part.dto';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';

@Controller('pannes')
@AuthenticatedRoles()
export class PannesController {
  constructor(private readonly pannesService: PannesService) {}

  @Post()
  @AdminOnly()
  create(@Body() createPanneDto: CreatePanneDto) {
    return this.pannesService.create(createPanneDto);
  }

  @Get()
  @AdminOnly()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('machineTypeId') machineTypeId?: string,
    @Query('component') component?: string,
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('partsLinked') partsLinked?: string,
  ) {
    const pagination = normalizePagination(page, limit);

    return this.pannesService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
      { machineTypeId, component, search, active, partsLinked },
    );
  }

  @Get(':id/parts')
  @AdminOnly()
  findParts(@Param('id') id: string) {
    return this.pannesService.findParts(id);
  }

  @Get(':id/compatible-parts')
  @AdminOnly()
  findCompatibleParts(@Param('id') id: string) {
    return this.pannesService.findCompatibleParts(id);
  }

  @Post(':id/parts')
  @AdminOnly()
  upsertPart(@Param('id') id: string, @Body() dto: UpsertPannePartDto) {
    return this.pannesService.upsertPart(id, dto);
  }

  @Delete(':id/parts/:partId')
  @AdminOnly()
  removePart(@Param('id') id: string, @Param('partId') partId: string) {
    return this.pannesService.removePart(id, partId);
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.pannesService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() updatePanneDto: UpdatePanneDto) {
    return this.pannesService.update(id, updatePanneDto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.pannesService.remove(id);
  }
}
