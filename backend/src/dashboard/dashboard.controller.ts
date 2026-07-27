import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnly } from '../auth/decorators/roles.decorator';
import { KpiService } from '../kpi/kpi.service';

/**
 * The Admin dashboard's single canonical data source — every KPI card,
 * counter, and chart the Admin dashboard renders comes from this one
 * endpoint, computed by the shared `KpiService`. Nothing here is derived
 * client-side from paginated list endpoints.
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly kpiService: KpiService) {}

  @Get('admin')
  @AdminOnly()
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  getAdminDashboard() {
    return this.kpiService.getAdminDashboard();
  }
}
