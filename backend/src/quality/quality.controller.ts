import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { AdminOnly } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { UpsertProductQualityMonthDto } from './dto/upsert-product-quality-month.dto';
import { QualityProductMttrService } from './quality-product-mttr.service';
import { QualityQueryService } from './quality-query.service';
import { SaveManualProductMttrDto } from './dto/save-manual-product-mttr.dto';
import { QualityManualProductMttrService } from './quality-manual-product-mttr.service';

@Controller('quality')
@AdminOnly()
export class QualityController {
  constructor(
    private readonly query: QualityQueryService,
    private readonly productMttr: QualityProductMttrService,
    private readonly manualProductMttr: QualityManualProductMttrService,
  ) {}

  @Get('product-mttr/manual')
  manualProductMttrSummary(@Query('year') year?: string) {
    return this.manualProductMttr.getYear(year);
  }

  @Put('product-mttr/manual')
  saveManualProductMttr(
    @Body() body: SaveManualProductMttrDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.manualProductMttr.save(body, req.user?.userId ?? '');
  }

  @Get('product-mttr') productMttrSummary(@Query('year') year?: string) {
    return this.productMttr.getYear(year);
  }

  @Put('product-mttr/:year/:month') upsertProductMttrMonth(
    @Param('year') year: string,
    @Param('month') month: string,
    @Body() body: UpsertProductQualityMonthDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.productMttr.upsertMonth(
      year,
      month,
      body,
      req.user?.userId ?? '',
    );
  }

  @Get('defect-catalogue') catalogue(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('process') process?: string,
  ) {
    return this.query.catalogue(page, limit, process);
  }
  @Get('defect-catalogue/:code') catalogueCode(@Param('code') code: string) {
    return this.query.catalogueCode(code);
  }
  @Get('defects') defects(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('process') process?: string,
    @Query('defectCode') defectCode?: string,
    @Query('source') source?: string,
  ) {
    return this.query.defects({
      page,
      limit,
      year,
      month,
      process,
      defectCode,
      source,
    });
  }
  @Get('defects/:id') defect(@Param('id') id: string) {
    return this.query.defect(id);
  }
}
