import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { KpiModule } from '../kpi/kpi.module';

@Module({
  imports: [KpiModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
