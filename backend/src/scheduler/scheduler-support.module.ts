import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AutomationJobLock,
  AutomationJobLockSchema,
} from '../schemas/automation-job-lock.schema';
import { SchedulerConfigService } from './scheduler.config';
import { SchedulerLockService } from './scheduler-lock.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: AutomationJobLock.name, schema: AutomationJobLockSchema },
    ]),
  ],
  providers: [SchedulerConfigService, SchedulerLockService],
  exports: [SchedulerConfigService, SchedulerLockService],
})
export class SchedulerSupportModule {}
