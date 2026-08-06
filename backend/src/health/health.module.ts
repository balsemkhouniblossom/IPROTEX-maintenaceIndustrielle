import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { EmailModule } from '../email/email.module';
import { MetricsModule } from '../common/metrics/metrics.module';

@Module({
  imports: [EmailModule, MetricsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
