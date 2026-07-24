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
import { CreateModulePieceDto } from './dto/create-module-piece.dto';
import { UpdateModulePieceDto } from './dto/update-module-piece.dto';
import { ModulePiecesService } from './module-pieces.service';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';

@Controller('module-pieces')
@AuthenticatedRoles()
export class ModulePiecesController {
  constructor(private readonly service: ModulePiecesService) {}
  @Post()
  @AdminOnly()
  create(@Body() dto: CreateModulePieceDto) {
    return this.service.create(dto);
  }
  @Get()
  @AdminOnly()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('moduleTypeId') moduleTypeId?: string,
  ) {
    const p = normalizePagination(page, limit);
    return this.service.findAll(p.page, p.limit, p.skip, moduleTypeId);
  }
  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id')
  @AdminOnly()
  update(
    @Param('id') id: string,
    @Body() dto: UpdateModulePieceDto,
  ) {
    return this.service.update(id, dto);
  }
  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
