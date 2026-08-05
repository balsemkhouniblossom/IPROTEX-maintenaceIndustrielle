import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRoles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { DocumentAccessService } from '../documents/document-access.service';
import { MachineTimelineService } from './machine-timeline.service';
import { MachineTimelineQueryDto } from './dto/machine-timeline-query.dto';
import { PaginatedResponse } from '../common/pagination';
import {
  MachineTimelineEvent,
  MachineTimelineSummary,
} from './machine-timeline.types';

/**
 * Scoped to admin/technician/operator alike (unlike `MachinesController`,
 * which stays admin-only) — access to a given machine's timeline is
 * enforced per-request via `DocumentAccessService.assertCanAccessMachine`,
 * the same machine-scoping authority `documents` and `reports` already
 * rely on, so operators/technicians only ever see machines they're
 * actually allowed to see.
 */
@Controller('machines/:machineId/timeline')
@UseGuards(JwtAuthGuard)
@AuthenticatedRoles()
export class MachineTimelineController {
  constructor(
    private readonly machineTimelineService: MachineTimelineService,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

  @Get('summary')
  async getSummary(
    @Param('machineId') machineId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MachineTimelineSummary> {
    await this.documentAccessService.assertCanAccessMachine(
      req.user ?? {},
      machineId,
    );
    return this.machineTimelineService.getSummary(machineId);
  }

  @Get()
  async getTimeline(
    @Param('machineId') machineId: string,
    @Query() query: MachineTimelineQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PaginatedResponse<MachineTimelineEvent>> {
    await this.documentAccessService.assertCanAccessMachine(
      req.user ?? {},
      machineId,
    );
    return this.machineTimelineService.getTimeline(machineId, query);
  }
}
