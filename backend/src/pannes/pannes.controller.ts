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
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);

    return this.pannesService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
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
