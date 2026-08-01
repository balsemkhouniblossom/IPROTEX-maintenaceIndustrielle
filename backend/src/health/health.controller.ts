import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';
import { Public } from '../auth/decorators/public.decorator';
import { AdminOnly } from '../auth/decorators/roles.decorator';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  getHealth() {
    return this.healthService.getPublicHealth();
  }

  @Get('api')
  @Public()
  getApiHealth() {
    return this.healthService.getApiHealth();
  }

  @Get('db')
  @AdminOnly()
  async getDatabaseHealth() {
    return this.healthService.getDatabaseHealth();
  }

  @Get('email')
  @AdminOnly()
  async getEmailHealth() {
    return this.healthService.getEmailHealth();
  }
}
