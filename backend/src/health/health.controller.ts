import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('api')
  getApiHealth() {
    return this.healthService.getApiHealth();
  }

  @Get('db')
  async getDatabaseHealth() {
    return this.healthService.getDatabaseHealth();
  }

  @Get('email')
  async getEmailHealth() {
    return this.healthService.getEmailHealth();
  }
}
