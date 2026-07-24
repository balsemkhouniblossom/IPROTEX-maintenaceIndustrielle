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
import { CreateMesureDto } from './dto/create-mesure.dto';
import { UpdateMesureDto } from './dto/update-mesure.dto';
import { MesuresService } from './mesures.service';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';

@Controller('mesures')
@AuthenticatedRoles()
export class MesuresController {
  constructor(private readonly service: MesuresService) {}
  @Post()
  @AdminOnly()
  create(@Body() dto: CreateMesureDto) {
    return this.service.create(dto);
  }
  @Get()
  @AdminOnly()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('capteurId') capteurId?: string,
    @Query('status') status?: string,
  ) {
    const p = normalizePagination(page, limit);
    return this.service.findAll(p.page, p.limit, p.skip, capteurId, status);
  }
  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() dto: UpdateMesureDto) {
    return this.service.update(id, dto);
  }
  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
