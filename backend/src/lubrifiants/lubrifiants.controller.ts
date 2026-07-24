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
import { LubrifiantsService } from './lubrifiants.service';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';

@Controller('lubrifiants')
@AuthenticatedRoles()
export class LubrifiantsController {
  constructor(private readonly lubrifiantsService: LubrifiantsService) {}

  @Post()
  @AdminOnly()
  create(@Body() payload: Record<string, unknown>) {
    return this.lubrifiantsService.create(payload);
  }

  @Get()
  @AdminOnly()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);
    return this.lubrifiantsService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.lubrifiantsService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return this.lubrifiantsService.update(id, payload);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.lubrifiantsService.remove(id);
  }
}
