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
import { StocksService } from './stocks.service';
import { normalizePagination } from '../common/pagination';
import {
  AdminOnly,
  AuthenticatedRoles,
} from '../auth/decorators/roles.decorator';
import { CreateStockDto } from './dto/create-stock.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string; role?: string };
}

@Controller('stocks')
@AuthenticatedRoles()
export class StocksController {
  constructor(private readonly stocksService: StocksService) {}

  @Post()
  @AdminOnly()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateStockDto) {
    return this.stocksService.create(dto, req.user?.userId);
  }

  @Get()
  @AdminOnly()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pagination = normalizePagination(page, limit);
    return this.stocksService.findAll(
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Get(':id')
  @AdminOnly()
  findOne(@Param('id') id: string) {
    return this.stocksService.findOne(id);
  }

  @Get(':id/movements')
  @AdminOnly()
  getMovements(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pagination = normalizePagination(page, limit, 20, 100);
    return this.stocksService.getMovements(
      id,
      pagination.page,
      pagination.limit,
      pagination.skip,
    );
  }

  @Patch(':id')
  @AdminOnly()
  update(@Param('id') id: string, @Body() dto: UpdateStockDto) {
    return this.stocksService.update(id, dto);
  }

  @Post(':id/adjustment')
  @AdminOnly()
  adjust(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.stocksService.adjust(id, dto, req.user?.userId);
  }

  @Delete(':id')
  @AdminOnly()
  remove(@Param('id') id: string) {
    return this.stocksService.remove(id);
  }
}
