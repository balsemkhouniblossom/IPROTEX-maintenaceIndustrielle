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
import { OtPiecesService } from './ot-pieces.service';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { CreateOtPieceDto } from './dto/create-ot-piece.dto';
import { UpdateOtPieceDto } from './dto/update-ot-piece.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string; role?: string };
}

@Controller('ot-pieces')
@AuthenticatedRoles()
export class OtPiecesController {
  constructor(private readonly otPiecesService: OtPiecesService) {}

  @Post()
  @AdminOnly()
  create(@Req() req: AuthenticatedRequest, @Body() payload: CreateOtPieceDto) {
    return this.otPiecesService.create(payload, req.user?.userId);
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
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() payload: UpdateOtPieceDto,
  ) {
    return this.otPiecesService.update(id, payload, req.user?.userId);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.otPiecesService.remove(id, req.user?.userId);
  }
}
