import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  DeviceAuthGuard,
  DeviceAuthenticatedRequest,
} from './device-auth.guard';
import { DeviceThrottlerGuard } from '../common/throttler/device-throttler.guard';
import { TelemetryIngestionService } from './telemetry-ingestion.service';
import { LiveMonitoringGateway } from './live-monitoring.gateway';
import { TelemetryIngestDto } from './dto/telemetry-ingest.dto';
import { FaultIngestDto } from './dto/fault-ingest.dto';
import { DeviceConnectionStatus } from '../schemas/device.schema';
import { Public } from '../auth/decorators/public.decorator';

/**
 * The device-facing REST ingestion surface — reachable only with valid
 * device credentials via `DeviceAuthGuard`, never with a user JWT. Kept
 * entirely separate from `DevicesController` (Admin registration, JWT
 * auth) and from every other `@UseGuards(JwtAuthGuard)` controller, so a
 * device credential is never sufficient to reach a normal user API and a
 * user session is never sufficient to push telemetry.
 *
 * `@Public()` opts this controller out of the app's global `JwtAuthGuard`/
 * `RolesGuard` (registered as `APP_GUARD`s, so they otherwise apply to
 * every route) — this controller has its own, independent authentication
 * (`DeviceAuthGuard`) and must never additionally require a user JWT that a
 * device, by design, does not have.
 *
 * `@SkipThrottle({ default: true })` plus `DeviceThrottlerGuard`'s own tier
 * filtering (see that guard's doc comment) both exist for the same reason:
 * the globally-registered `AppThrottlerGuard` runs before any local guard
 * regardless of decorator order, so without an explicit opt-out it would
 * evaluate the `'default'` tier against device traffic too. `DeviceAuthGuard`
 * must run before `DeviceThrottlerGuard` in the `@UseGuards` list so
 * `request.device` exists before the throttle guard's tracker reads it.
 */
@Controller('device-gateway')
@Public()
@SkipThrottle({ default: true })
@UseGuards(DeviceAuthGuard, DeviceThrottlerGuard)
export class DeviceGatewayController {
  constructor(
    private readonly telemetryIngestionService: TelemetryIngestionService,
    private readonly liveMonitoringGateway: LiveMonitoringGateway,
  ) {}

  @Post('heartbeat')
  async heartbeat(@Req() req: DeviceAuthenticatedRequest) {
    const device = req.device!;
    const { cameOnline } =
      await this.telemetryIngestionService.recordHeartbeat(device);
    if (cameOnline) {
      this.liveMonitoringGateway.emitStatusChange(String(device.machine_id), {
        deviceId: device.device_id,
        status: DeviceConnectionStatus.ONLINE,
        lastSeenAt: new Date().toISOString(),
      });
    }
    return { ok: true, serverTime: new Date().toISOString() };
  }

  @Post('telemetry')
  async telemetry(
    @Body() dto: TelemetryIngestDto,
    @Req() req: DeviceAuthenticatedRequest,
  ) {
    const device = req.device!;
    const { record, cameOnline } =
      await this.telemetryIngestionService.recordTelemetry(device, {
        metrics: dto.metrics,
        recordedAt: dto.recorded_at ? new Date(dto.recorded_at) : undefined,
      });

    this.liveMonitoringGateway.emitTelemetry(String(device.machine_id), {
      deviceId: device.device_id,
      metrics: record.metrics,
      recordedAt: record.recorded_at.toISOString(),
    });
    if (cameOnline) {
      this.liveMonitoringGateway.emitStatusChange(String(device.machine_id), {
        deviceId: device.device_id,
        status: DeviceConnectionStatus.ONLINE,
        lastSeenAt: new Date().toISOString(),
      });
    }

    return { ok: true, id: String(record._id) };
  }

  @Post('fault')
  async fault(
    @Body() dto: FaultIngestDto,
    @Req() req: DeviceAuthenticatedRequest,
  ) {
    const device = req.device!;
    const { record, cameOnline } =
      await this.telemetryIngestionService.recordFault(device, {
        codePanne: dto.code_panne,
        severity: dto.severity,
        message: dto.message,
        raisedAt: dto.raised_at ? new Date(dto.raised_at) : undefined,
      });

    this.liveMonitoringGateway.emitFault(String(device.machine_id), {
      id: String(record._id),
      deviceId: device.device_id,
      codePanne: record.code_panne,
      severity: record.severity,
      message: record.message,
      raisedAt: record.raised_at.toISOString(),
    });
    if (cameOnline) {
      this.liveMonitoringGateway.emitStatusChange(String(device.machine_id), {
        deviceId: device.device_id,
        status: DeviceConnectionStatus.ONLINE,
        lastSeenAt: new Date().toISOString(),
      });
    }

    return { ok: true, id: String(record._id) };
  }
}
