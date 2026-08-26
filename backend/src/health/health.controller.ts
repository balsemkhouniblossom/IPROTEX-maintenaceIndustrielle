import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';
import { Public } from '../auth/decorators/public.decorator';
import { AdminOnly } from '../auth/decorators/roles.decorator';
import { MetricsRegistry } from '../common/metrics/metrics-registry';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly metrics: MetricsRegistry,
  ) {}

  @Get()
  @Public()
  getHealth() {
    return this.healthService.getPublicHealth();
  }

  /**
   * Liveness probe: "is the process up and able to handle a request at
   * all", independent of any dependency (DB, email). A platform that
   * restarts a container on liveness failure should never do so because
   * Atlas is briefly unreachable — that's what `/health` (readiness) is
   * for. Deliberately identical to `/health/api` today (both just confirm
   * the process is serving requests); kept as its own named route so a
   * platform's liveness-probe config always points at something whose
   * contract is "process alive", not "process alive, and this happened to
   * also be the lightest existing check".
   */
  @Get('live')
  @Public()
  getLiveness() {
    return this.healthService.getApiHealth();
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

  /**
   * Basic Prometheus-text-format request counters — admin-gated the same
   * way `/health/db` is, since request volume/latency by route is
   * operational data, not something to expose anonymously.
   */
  @Get('metrics')
  @AdminOnly()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics() {
    return this.metrics.renderPrometheusText();
  }
}
