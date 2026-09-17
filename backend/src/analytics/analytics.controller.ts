import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { AnalyticsService } from './analytics.service';
import { MttrSourceResult } from '../kpi/mttr-source.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('mttr')
  async getMttr(
    @Req() req: AuthenticatedRequest,
    @Query('year') yearQuery?: string,
    @Query('machineId') machineId?: string,
    @Query('technicianId') technicianId?: string,
  ): Promise<MttrSourceResult> {
    const yearMatch = /^(\d{4})$/.exec(yearQuery ?? '');
    const year = yearMatch ? Number(yearMatch[1]) : Number.NaN;
    if (!Number.isFinite(year)) {
      throw new BadRequestException('year query parameter is required');
    }

    return this.analyticsService.getMttr(year, {
      machineId,
      technicianId,
      actor: {
        userId: req.user!.userId!,
        role: req.user!.role as never,
      },
    });
  }
}
