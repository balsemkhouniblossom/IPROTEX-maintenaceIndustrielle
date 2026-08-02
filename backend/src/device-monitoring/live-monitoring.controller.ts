import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { DocumentAccessService } from '../documents/document-access.service';
import { LiveStatusService } from './live-status.service';
import { TelemetryIngestionService } from './telemetry-ingestion.service';
import { ResolveFaultDto } from './dto/resolve-fault.dto';
import { LiveMonitoringGateway } from './live-monitoring.gateway';

/**
 * Read-only, role-scoped live-monitoring endpoints for Admin/Technician/
 * Operator (never for devices — devices never hold a JWT and this
 * controller only accepts one). Machine access is scoped through the same
 * `DocumentAccessService` already used to scope Documents, so an Operator
 * or Technician sees live status for exactly the machines they can already
 * see documents for — no separate, potentially-divergent scoping rule.
 */
@Controller('live-monitoring')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
export class LiveMonitoringController {
  constructor(
    private readonly liveStatusService: LiveStatusService,
    private readonly documentAccessService: DocumentAccessService,
    private readonly telemetryIngestionService: TelemetryIngestionService,
    private readonly liveMonitoringGateway: LiveMonitoringGateway,
  ) {}

  @Get('machines')
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  async listMachinesLiveStatus(@Req() req: AuthenticatedRequest) {
    const machineIds =
      await this.documentAccessService.listAccessibleMachineIds(req.user ?? {});
    return this.liveStatusService.getMachinesLiveSummary(machineIds);
  }

  @Get('machines/:machineId')
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  async getMachineLiveStatus(
    @Param('machineId') machineId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.documentAccessService.assertCanAccessMachine(
      req.user ?? {},
      machineId,
    );
    return this.liveStatusService.getMachineLiveStatus(machineId);
  }

  @Patch('faults/:id/resolve')
  async resolveFault(
    @Param('id') id: string,
    @Body() dto: ResolveFaultDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const fault = await this.telemetryIngestionService.resolveFault(
      id,
      req.user ?? {},
      dto,
    );
    this.liveMonitoringGateway.emitFaultResolved(String(fault.machine_id), {
      id: String(fault._id),
      resolvedAt: fault.resolved_at?.toISOString(),
    });
    return fault;
  }
}
