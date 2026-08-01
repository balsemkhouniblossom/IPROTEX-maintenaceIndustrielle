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
import { LubrificationLogsService } from './lubrification-logs.service';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { CreateLubrificationLogDto } from './dto/create-lubrification-log.dto';
import { UpdateLubrificationLogDto } from './dto/update-lubrification-log.dto';

@Controller('lubrification-logs')
@AuthenticatedRoles()
export class LubrificationLogsController {
  constructor(
    private readonly lubrificationLogsService: LubrificationLogsService,
  ) {}

  @Post()
  @AdminOnly()
  create(@Body() payload: CreateLubrificationLogDto) {
    return this.lubrificationLogsService.create(payload);
  }

  @Get()
  @AdminOnly()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);
    return this.lubrificationLogsService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.lubrificationLogsService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() payload: UpdateLubrificationLogDto) {
    return this.lubrificationLogsService.update(id, payload);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.lubrificationLogsService.remove(id);
  }
}
