import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';

import { normalizePagination } from '../common/pagination';
import { ModuleTypesService } from './module-types.service';
import { CreateModuleTypeDto } from './dto/create-module-type.dto';
import { UpdateModuleTypeDto } from './dto/update-module-type.dto';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';

@Controller('module-types')
@AuthenticatedRoles()
export class ModuleTypesController {
  constructor(private readonly moduleTypesService: ModuleTypesService) {}

  @Post()
  @AdminOnly()
  create(@Body() createModuleTypeDto: CreateModuleTypeDto) {
    return this.moduleTypesService.create(createModuleTypeDto);
  }

  @Get()
  @AdminOnly()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);

    return this.moduleTypesService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.moduleTypesService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(
    @Param('id') id: string,
    @Body() updateModuleTypeDto: UpdateModuleTypeDto,
  ) {
    return this.moduleTypesService.update(id, updateModuleTypeDto);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.moduleTypesService.remove(id);
  }
}
