import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthThrottleService } from '../auth/auth-throttle.service';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';

@Module({
  imports: [ConfigModule],
  controllers: [EmailController],
  providers: [EmailService, AuthThrottleService],
  exports: [EmailService],
})
export class EmailModule {}
