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
import { OtPiecesService } from './ot-pieces.service';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { CreateOtPieceDto } from './dto/create-ot-piece.dto';
import { UpdateOtPieceDto } from './dto/update-ot-piece.dto';

@Controller('ot-pieces')
@AuthenticatedRoles()
export class OtPiecesController {
  constructor(private readonly otPiecesService: OtPiecesService) {}

  @Post()
  @AdminOnly()
  create(@Body() payload: CreateOtPieceDto) {
    return this.otPiecesService.create(payload);
  }

  @Get()
  @AdminOnly()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);
    return this.otPiecesService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.otPiecesService.findOne(id);
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() payload: UpdateOtPieceDto) {
    return this.otPiecesService.update(id, payload);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.otPiecesService.remove(id);
  }
}
